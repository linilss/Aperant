import { ipcMain } from 'electron';
import { readdirSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { readFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult, FileNode, ClaudeAgent, ClaudeAgentsResult, ClaudeSkill, ClaudeSkillsResult } from '../../shared/types';

// Maximum file size to read (1MB)
const MAX_FILE_SIZE = 1024 * 1024;

/**
 * Validates and normalizes a file path for safe reading.
 * Returns the normalized path if valid, or an error message.
 */
function validatePath(filePath: string): { valid: true; path: string } | { valid: false; error: string } {
  // Resolve to absolute path (handles .., ., etc.)
  const resolvedPath = path.resolve(filePath);

  // Must be absolute after resolution
  if (!path.isAbsolute(resolvedPath)) {
    return { valid: false, error: 'Path must be absolute' };
  }

  // After resolution, path should not contain .. segments
  // This catches edge cases where resolve might not fully normalize
  const segments = resolvedPath.split(path.sep);
  if (segments.includes('..')) {
    return { valid: false, error: 'Invalid path: contains parent directory references' };
  }

  return { valid: true, path: resolvedPath };
}

// Directories to ignore when listing
const IGNORED_DIRS = new Set([
  'node_modules', '.git', '__pycache__', 'dist', 'build',
  '.next', '.nuxt', 'coverage', '.cache', '.venv', 'venv',
  'out', '.turbo', '.worktrees',
  'vendor', 'target', '.gradle', '.maven'
]);

function parseFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const yaml = match[1];
  const name = yaml.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = yaml.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  return { name, description };
}

function readSkillsDir(dir: string): ClaudeSkill[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((filename) => {
        const filePath = path.join(dir, filename);
        const content = readFileSync(filePath, 'utf-8');
        const { name, description } = parseFrontmatter(content);
        return {
          filename,
          path: filePath,
          name: name ?? filename.replace(/\.md$/, ''),
          description,
          content
        };
      });
  } catch {
    return [];
  }
}

function readAgentsDir(dir: string): ClaudeAgent[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((filename) => {
        const filePath = path.join(dir, filename);
        const content = readFileSync(filePath, 'utf-8');
        const { name, description } = parseFrontmatter(content);
        return {
          filename,
          path: filePath,
          name: name ?? filename.replace(/\.md$/, ''),
          description,
          content
        };
      });
  } catch {
    return [];
  }
}

/**
 * Register all file-related IPC handlers
 */
export function registerFileHandlers(): void {
  // ============================================
  // File Explorer Operations
  // ============================================

  ipcMain.handle(
    IPC_CHANNELS.FILE_EXPLORER_LIST,
    async (_, dirPath: string): Promise<IPCResult<FileNode[]>> => {
      try {
        // Validate and normalize path to prevent directory traversal
        const validation = validatePath(dirPath);
        if (!validation.valid) {
          return { success: false, error: validation.error };
        }
        const entries = readdirSync(validation.path, { withFileTypes: true });

        // Filter and map entries
        const nodes: FileNode[] = [];
        for (const entry of entries) {
          // Skip hidden files (not directories) except useful ones like .env, .gitignore
          if (!entry.isDirectory() && entry.name.startsWith('.') &&
              !['.env', '.gitignore', '.env.example', '.env.local'].includes(entry.name)) {
            continue;
          }
          // Skip ignored directories
          if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;

          nodes.push({
            path: path.join(validation.path, entry.name),
            name: entry.name,
            isDirectory: entry.isDirectory()
          });
        }

        // Sort: directories first, then alphabetically
        nodes.sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });

        return { success: true, data: nodes };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list directory'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.FILE_EXPLORER_READ,
    async (_, filePath: string): Promise<IPCResult<string>> => {
      try {
        // Validate and normalize path
        const validation = validatePath(filePath);
        if (!validation.valid) {
          return { success: false, error: validation.error };
        }
        const safePath = validation.path;

        // Use async file read to avoid blocking; check size after reading to avoid TOCTOU
        const content = await readFile(safePath, 'utf-8');
        if (Buffer.byteLength(content, 'utf-8') > MAX_FILE_SIZE) {
          return { success: false, error: 'File too large (max 1MB)' };
        }
        return { success: true, data: content };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to read file'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CLAUDE_AGENT_SAVE,
    async (_, filePath: string, content: string): Promise<IPCResult<void>> => {
      try {
        const resolved = path.resolve(filePath);
        // Only allow writing inside a .claude/agents directory
        const normalized = resolved.split(path.sep).join('/');
        if (!normalized.includes('/.claude/agents/')) {
          return { success: false, error: 'Path must be within a .claude/agents directory' };
        }
        mkdirSync(path.dirname(resolved), { recursive: true });
        writeFileSync(resolved, content, 'utf-8');
        return { success: true, data: undefined };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to save agent'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CLAUDE_AGENTS_LIST,
    async (_, projectPath?: string): Promise<IPCResult<ClaudeAgentsResult>> => {
      const globalDir = path.join(os.homedir(), '.claude', 'agents');
      const projectDir = projectPath ? path.join(projectPath, '.claude', 'agents') : null;
      return {
        success: true,
        data: {
          global: readAgentsDir(globalDir),
          project: projectDir ? readAgentsDir(projectDir) : []
        }
      };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CLAUDE_SKILLS_LIST,
    async (_, projectPath?: string): Promise<IPCResult<ClaudeSkillsResult>> => {
      const globalDir = path.join(os.homedir(), '.claude', 'skills');
      const projectDir = projectPath ? path.join(projectPath, '.claude', 'skills') : null;
      return {
        success: true,
        data: {
          global: readSkillsDir(globalDir),
          project: projectDir ? readSkillsDir(projectDir) : []
        }
      };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CLAUDE_SKILL_SAVE,
    async (_, filePath: string, content: string): Promise<IPCResult<void>> => {
      try {
        const resolved = path.resolve(filePath);
        const normalized = resolved.split(path.sep).join('/');
        if (!normalized.includes('/.claude/skills/')) {
          return { success: false, error: 'Path must be within a .claude/skills directory' };
        }
        mkdirSync(path.dirname(resolved), { recursive: true });
        writeFileSync(resolved, content, 'utf-8');
        return { success: true, data: undefined };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to save skill'
        };
      }
    }
  );
}
