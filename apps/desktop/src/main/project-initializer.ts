import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { getToolPath } from './cli-tool-manager';
import { ensureGitExcludeEntries, MALVY_GIT_EXCLUDE_ENTRIES } from './git-exclude';

export { ensureGitExcludeEntries } from './git-exclude';

/**
 * Debug logging - only logs when DEBUG=true or in development mode
 */
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

function debug(message: string, data?: Record<string, unknown>): void {
  if (DEBUG) {
    if (data) {
      console.warn(`[ProjectInitializer] ${message}`, JSON.stringify(data, null, 2));
    } else {
      console.warn(`[ProjectInitializer] ${message}`);
    }
  }
}

/**
 * Git status information for a project
 */
export interface GitStatus {
  isGitRepo: boolean;
  hasCommits: boolean;
  currentBranch: string | null;
  error?: string;
}

/**
 * Check if a directory is a git repository and has at least one commit
 */
export function checkGitStatus(projectPath: string): GitStatus {
  const git = getToolPath('git');

  try {
    // Check if it's a git repository
    execFileSync(git, ['rev-parse', '--git-dir'], {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch {
    return {
      isGitRepo: false,
      hasCommits: false,
      currentBranch: null,
      error: 'Not a git repository. Please run "git init" to initialize git.'
    };
  }

  // Check if there are any commits
  let hasCommits = false;
  try {
    execFileSync(git, ['rev-parse', 'HEAD'], {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    hasCommits = true;
  } catch {
    // No commits yet
    hasCommits = false;
  }

  // Get current branch
  let currentBranch: string | null = null;
  try {
    currentBranch = execFileSync(git, ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch {
    // Branch detection failed
  }

  if (!hasCommits) {
    return {
      isGitRepo: true,
      hasCommits: false,
      currentBranch,
      error: 'Git repository has no commits. Please make an initial commit first.'
    };
  }

  return {
    isGitRepo: true,
    hasCommits: true,
    currentBranch
  };
}

/**
 * Initialize git in a project directory and create an initial commit.
 * This is a user-friendly way to set up git for non-technical users.
 */
export function initializeGit(projectPath: string): InitializationResult {
  debug('initializeGit called', { projectPath });

  // Check current git status
  const status = checkGitStatus(projectPath);
  const git = getToolPath('git');

  try {
    // Step 1: Initialize git if needed
    if (!status.isGitRepo) {
      debug('Initializing git repository');
      execFileSync(git, ['init'], {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
    }

    // Step 2: Check if there are files to commit
    const statusOutput = execFileSync(git, ['status', '--porcelain'], {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    // Step 3: If there are untracked/modified files, add and commit them
    if (statusOutput || !status.hasCommits) {
      debug('Adding files and creating initial commit');

      // Add all files
      execFileSync(git, ['add', '-A'], {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Create initial commit
      execFileSync(git, ['commit', '-m', 'Initial commit', '--allow-empty'], {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
    }

    debug('Git initialization complete');
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error during git initialization';
    debug('Git initialization failed', { error: errorMessage });
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Data directories created in .malvy for each project
 */
const DATA_DIRECTORIES = [
  'specs',
  'ideation',
  'insights',
  'roadmap'
];

/**
 * Result of initialization operation
 */
export interface InitializationResult {
  success: boolean;
  error?: string;
}

/**
 * Check if the project has a local backend source directory
 * This indicates it's the development project itself
 */
export function hasLocalSource(projectPath: string): boolean {
  const desktopPath = path.join(projectPath, 'apps', 'desktop');
  // Use session/runner.ts as marker — ensures valid TypeScript AI layer
  const markerFile = path.join(desktopPath, 'src', 'main', 'ai', 'session', 'runner.ts');
  return existsSync(desktopPath) && existsSync(markerFile);
}

/**
 * Get the local source path for a project (if it exists)
 */
export function getLocalSourcePath(projectPath: string): string | null {
  const desktopPath = path.join(projectPath, 'apps', 'desktop');
  if (hasLocalSource(projectPath)) {
    return desktopPath;
  }
  return null;
}

/**
 * Check if project is initialized (has .malvy directory)
 */
export function isInitialized(projectPath: string): boolean {
  const dotAutoBuildPath = path.join(projectPath, '.malvy');
  return existsSync(dotAutoBuildPath);
}

/**
 * Initialize malvy data directory in a project.
 *
 * Creates .malvy/ with data directories (specs, ideation, insights, roadmap).
 * The framework code runs from the source repo - only data is stored here.
 *
 * Requires:
 * - Project directory must exist
 * - Project must be a git repository with at least one commit
 */
export function initializeProject(projectPath: string): InitializationResult {
  debug('initializeProject called', { projectPath });

  // Validate project path exists
  if (!existsSync(projectPath)) {
    debug('Project path does not exist', { projectPath });
    return {
      success: false,
      error: `Project directory not found: ${projectPath}`
    };
  }

  // Check git status - malvy requires git for worktree-based builds
  const gitStatus = checkGitStatus(projectPath);
  if (!gitStatus.isGitRepo || !gitStatus.hasCommits) {
    debug('Git check failed', { gitStatus });
    return {
      success: false,
      error: gitStatus.error || 'Git repository required. malvy uses git worktrees for isolated builds.'
    };
  }

  // Check if already initialized
  const dotAutoBuildPath = path.join(projectPath, '.malvy');

  if (existsSync(dotAutoBuildPath)) {
    debug('Already initialized - .malvy exists');
    return {
      success: false,
      error: 'Project already has malvy initialized (.malvy exists)'
    };
  }

  try {
    debug('Creating .malvy data directory', { dotAutoBuildPath });

    // Create the .malvy directory
    mkdirSync(dotAutoBuildPath, { recursive: true });

    // Create data directories
    for (const dataDir of DATA_DIRECTORIES) {
      const dirPath = path.join(dotAutoBuildPath, dataDir);
      debug('Creating data directory', { dataDir, dirPath });
      mkdirSync(dirPath, { recursive: true });
      writeFileSync(path.join(dirPath, '.gitkeep'), '', 'utf-8');
    }

    // Exclude Malvy files via the untracked <git-dir>/info/exclude so no
    // tracked file (e.g. .gitignore) is ever modified.
    const added = ensureGitExcludeEntries(projectPath, MALVY_GIT_EXCLUDE_ENTRIES);
    if (added.length > 0) {
      debug('Added entries to git info/exclude', { entries: added });
    }

    debug('Initialization complete');
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error during initialization';
    debug('Initialization failed', { error: errorMessage });
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Ensure all data directories exist in .malvy.
 * Useful if new directories are added in future versions.
 */
export function ensureDataDirectories(projectPath: string): InitializationResult {
  const dotAutoBuildPath = path.join(projectPath, '.malvy');

  if (!existsSync(dotAutoBuildPath)) {
    return {
      success: false,
      error: 'Project not initialized. Run initialize first.'
    };
  }

  try {
    for (const dataDir of DATA_DIRECTORIES) {
      const dirPath = path.join(dotAutoBuildPath, dataDir);
      if (!existsSync(dirPath)) {
        debug('Creating missing data directory', { dataDir, dirPath });
        mkdirSync(dirPath, { recursive: true });
        writeFileSync(path.join(dirPath, '.gitkeep'), '', 'utf-8');
      }
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Get the malvy folder path for a project.
 *
 * IMPORTANT: Only .malvy/ is considered a valid "installed" malvy.
 * The malvy/ folder (if it exists) is the SOURCE CODE being developed,
 * not an installation. This allows malvy to be used to develop itself.
 */
export function getAutoBuildPath(projectPath: string): string | null {
  const dotAutoBuildPath = path.join(projectPath, '.malvy');

  debug('getAutoBuildPath called', { projectPath, dotAutoBuildPath });

  if (existsSync(dotAutoBuildPath)) {
    debug('Returning .malvy (installed version)');
    return '.malvy';
  }

  // Migration: auto-rename legacy .auto-claude/ folder to .malvy/
  const legacyPath = path.join(projectPath, '.auto-claude');
  if (existsSync(legacyPath)) {
    try {
      const { renameSync } = require('node:fs');
      renameSync(legacyPath, dotAutoBuildPath);
      debug('Migrated .auto-claude → .malvy');
      return '.malvy';
    } catch (err) {
      debug('Failed to migrate .auto-claude → .malvy', { error: String(err) });
    }
  }

  debug('No .malvy folder found - project not initialized');
  return null;
}
