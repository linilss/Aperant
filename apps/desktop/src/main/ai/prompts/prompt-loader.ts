/**
 * Prompt Loader
 * =============
 *
 * Loads .md prompt files from the bundled prompts directory and performs
 * dynamic context injection.
 *
 * Path resolution:
 * - Dev:        apps/desktop/prompts/ (relative to project root via __dirname traversal)
 * - Production: process.resourcesPath/prompts/ (bundled into Electron resources)
 */

import { readFileSync, existsSync, readFile as readFileAsync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

import type { ProjectCapabilities, PromptContext } from './types';
import {
  findClaudeDocs,
  MALVY_DOCS_DIR,
  MALVY_POINTERS_FILE,
  resolveMalvyRoot,
  stripPointersTitle,
} from '../../claude-docs';
import { CORE_VALUES_FILE, formatCoreValuesSection } from '../../core-values';

// =============================================================================
// Path Resolution
// =============================================================================

let _resolvedPromptsDir: string | null = null;

/**
 * Resolve the prompts directory path.
 *
 * In production (app.isPackaged), prompts are bundled into process.resourcesPath.
 * In dev, they live in apps/desktop/prompts/ relative to the frontend root.
 *
 * The worker thread's __dirname is in out/main/ (or src/main/ in dev),
 * so we traverse upward to find the frontend root.
 */
export function resolvePromptsDir(): string {
  if (_resolvedPromptsDir) return _resolvedPromptsDir;

  // Production: Electron bundles prompts into resources
  try {
    // Dynamically import electron to avoid issues in worker threads
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron');
    if (app?.isPackaged) {
      const prodPath = join(process.resourcesPath, 'prompts');
      _resolvedPromptsDir = prodPath;
      return prodPath;
    }
  } catch {
    // Not in Electron main process (e.g., worker thread or test environment)
  }

  // Dev: traverse from __dirname up to find apps/desktop/prompts/
  const candidateBases = [
    // Worker thread: __dirname = out/main/ai/agent/ → traverse up to frontend root
    join(__dirname, '..', '..', '..', '..', 'prompts'),
    // Worker thread in dev: __dirname = src/main/ai/agent/
    join(__dirname, '..', '..', '..', 'prompts'),
    // Direct: 2 levels up from src/main/ai/prompts/
    join(__dirname, '..', '..', 'prompts'),
    // From out/main/ → ../../prompts
    join(__dirname, '..', 'prompts'),
    // Local prompts dir
    join(__dirname, 'prompts'),
    // Repo root traversal: up to repo root, then apps/desktop/prompts/
    join(__dirname, '..', '..', '..', '..', '..', 'apps', 'desktop', 'prompts'),
    join(__dirname, '..', '..', '..', '..', 'apps', 'desktop', 'prompts'),
  ];

  for (const candidate of candidateBases) {
    if (existsSync(join(candidate, 'planner.md'))) {
      _resolvedPromptsDir = candidate;
      return candidate;
    }
  }

  // Fallback to first candidate even if not found — errors will surface on use
  const fallback = candidateBases[0];
  _resolvedPromptsDir = fallback;
  return fallback;
}

// =============================================================================
// Core Loader
// =============================================================================

/**
 * Load a prompt .md file from the bundled prompts directory.
 *
 * @param promptName - Relative path without extension (e.g., "planner", "mcp_tools/electron_validation")
 * @returns Prompt file content
 * @throws Error if the file does not exist
 */
export function loadPrompt(promptName: string): string {
  const promptsDir = resolvePromptsDir();
  const promptPath = join(promptsDir, `${promptName}.md`);

  if (!existsSync(promptPath)) {
    throw new Error(
      `Prompt file not found: ${promptPath}\n` +
      `Prompts directory resolved to: ${promptsDir}\n` +
      `Make sure apps/desktop/prompts/${promptName}.md exists.`
    );
  }

  return readFileSync(promptPath, 'utf-8');
}

/**
 * Load a prompt file, returning null if it doesn't exist.
 */
export function tryLoadPrompt(promptName: string): string | null {
  try {
    return loadPrompt(promptName);
  } catch {
    return null;
  }
}

// =============================================================================
// Project Instructions Loading
// =============================================================================

/**
 * Try to read a file asynchronously, returning trimmed content or null.
 */
async function tryReadFile(filePath: string): Promise<string | null> {
  try {
    const content = await new Promise<string>((resolve, reject) => {
      readFileAsync(filePath, 'utf-8', (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });
    return content.trim() || null;
  } catch {
    return null;
  }
}

/** Result of loading project instructions, includes the source filename(s) */
export interface ProjectInstructionsResult {
  content: string;
  /** Which files were loaded, comma-separated (e.g., "CLAUDE.md, .malvy/docs/CLAUDE.md, .malvy/pointers.md") */
  source: string;
  /**
   * The project's core values (`.malvy/core-values.md`), kept apart from `content`
   * so injectContext() can put them first, above PROJECT INSTRUCTIONS. Absent when not set.
   */
  coreValues?: string;
}

/**
 * Load project instructions for agent prompts.
 *
 * Sections, in order (each only if present):
 * 1. Team root doc — AGENTS.md (preferred) or CLAUDE.md, upper or lower case.
 * 2. `## DOCUMENTATION MAP` — every team doc and `.malvy/docs` file with its first line,
 *    so the agent knows where to read before touching a directory.
 * 3. `## MALVY DOCS` — the root `.malvy/docs/CLAUDE.md` (Malvy's complementary layer).
 * 4. `## DEVELOPER POINTERS (override docs where they conflict)` — from `.malvy/pointers.md`.
 *
 * Core values (`.malvy/core-values.md`) are returned separately as `coreValues`.
 *
 * File reads only (no database) so it is safe to call from the agent worker thread.
 * When `projectDir` is a task worktree, the Malvy layer is read from the owning project.
 *
 * @param projectDir - Project root (or task worktree) directory
 * @param options.includeTeamDocs - When false (ProjectSettings.useClaudeMd off), the team's
 *   AGENTS.md/CLAUDE.md is skipped and left out of the documentation map. Malvy's own layer
 *   is always included.
 * @returns Assembled instructions, or null if nothing was found
 */
export async function loadProjectInstructions(
  projectDir: string,
  options: { includeTeamDocs?: boolean } = {},
): Promise<ProjectInstructionsResult | null> {
  const includeTeamDocs = options.includeTeamDocs !== false;
  const sections: string[] = [];
  const sources: string[] = [];

  const candidates = includeTeamDocs ? ['AGENTS.md', 'agents.md', 'CLAUDE.md', 'claude.md'] : [];
  let teamRoot: string | null = null;
  for (const name of candidates) {
    const content = await tryReadFile(join(projectDir, name));
    if (content) {
      teamRoot = name;
      sections.push(content);
      sources.push(name);
      break;
    }
  }

  const malvyRoot = resolveMalvyRoot(projectDir);
  const sameRoot = malvyRoot === projectDir;
  const teamDocs = includeTeamDocs ? (await findClaudeDocs(projectDir)).filter((d) => d.layer === 'team') : [];
  const malvyDocs = (await findClaudeDocs(malvyRoot)).filter((d) => d.layer === 'malvy');

  const mapLines: string[] = [];
  let hasUnincludedDoc = false;
  for (const doc of [...teamDocs, ...malvyDocs]) {
    // Malvy docs live in the owning project when running inside a worktree
    const displayPath = doc.layer === 'malvy' && !sameRoot ? join(malvyRoot, doc.relativePath) : doc.relativePath;
    let note = '';
    if (doc.layer === 'team' && doc.relativePath === teamRoot) note = ' (included above)';
    else if (doc.layer === 'malvy' && doc.layerPath === 'CLAUDE.md') note = ' (included below)';
    else hasUnincludedDoc = true;
    const layer = doc.layer === 'malvy' ? ' [malvy]' : '';
    mapLines.push(`- \`${displayPath}\`${layer}${note}${doc.firstLine ? ` — ${doc.firstLine}` : ''}`);
  }
  if (hasUnincludedDoc) {
    sections.push(
      `## DOCUMENTATION MAP\n\n` +
      `Read the doc for a directory before changing files in it. ` +
      `[malvy] docs complement the team docs for the same directory.\n\n` +
      mapLines.join('\n')
    );
  }

  const malvyRootDoc = await tryReadFile(join(malvyRoot, MALVY_DOCS_DIR, 'CLAUDE.md'));
  if (malvyRootDoc) {
    sections.push(`## MALVY DOCS\n\n${malvyRootDoc}`);
    sources.push(`${MALVY_DOCS_DIR}/CLAUDE.md`);
  }

  const pointers = await tryReadFile(join(malvyRoot, MALVY_POINTERS_FILE));
  const pointersBody = pointers ? stripPointersTitle(pointers) : '';
  if (pointersBody) {
    sections.push(`## DEVELOPER POINTERS (override docs where they conflict)\n\n${pointersBody}`);
    sources.push(MALVY_POINTERS_FILE);
  }

  const coreValues = await tryReadFile(join(malvyRoot, CORE_VALUES_FILE));
  if (coreValues) sources.unshift(CORE_VALUES_FILE);

  if (sources.length === 0) return null;
  return { content: sections.join('\n\n'), source: sources.join(', '), ...(coreValues ? { coreValues } : {}) };
}

/** @deprecated Use loadProjectInstructions() instead */
export async function loadClaudeMd(projectDir: string): Promise<string | null> {
  return tryReadFile(join(projectDir, 'CLAUDE.md'));
}

/** @deprecated Use loadProjectInstructions() instead */
export async function loadAgentsMd(projectDir: string): Promise<string | null> {
  return tryReadFile(join(projectDir, 'agents.md'));
}

// =============================================================================
// Context Injection
// =============================================================================

export const PROJECT_MEMORY_HEADING = '## PROJECT MEMORY (from previous work — verify before relying on it)';

/**
 * Injected into every task agent prompt. Enforced separately by the release guard
 * (security/release-guard.ts) on both the CLI and SDK paths.
 */
export const RELEASE_POLICY_SECTION =
  `## RELEASE POLICY\n\n` +
  `Never deploy, publish or release anything. Do not upload builds (TestFlight, App Store, Play Store), ` +
  `do not run deploy*/release*/publish* scripts, \`az webapp\`, \`az acr build\`, \`kubectl apply\`, ` +
  `\`terraform apply\`, \`fly deploy\`, \`vercel --prod\`, \`npm publish\`, \`dotnet nuget push\` or ` +
  `\`xcrun altool\`, and never \`git push\` to any remote. The user releases from Malvy's Deploy button after merging. ` +
  `Planners: never add deploy/release/push subtasks; if the docs describe a release process, at most note in the ` +
  `plan summary that the user deploys from Malvy.\n\n---\n\n`;

/**
 * Inject dynamic sections into a prompt template.
 *
 * Handles:
 * - CORE VALUES first (highest priority, overrides everything below)
 * - RELEASE POLICY (always): agents never deploy/publish/push
 * - SPEC LOCATION header with file paths
 * - CLAUDE.md injection if provided
 * - Project memory (built-in memory system) if provided
 * - Human input (HUMAN_INPUT.md) injection
 *
 * @param promptTemplate - Base prompt content from .md file
 * @param context - Dynamic context to inject
 * @returns Assembled prompt with all context prepended
 */
export function injectContext(promptTemplate: string, context: PromptContext): string {
  const sections: string[] = [];

  // 0. Core values — first, they override every other instruction
  const coreValues = formatCoreValuesSection(context.coreValues ?? '');
  if (coreValues) {
    sections.push(`${coreValues}---\n\n`);
  }

  // 0b. Release policy — agents never deploy/publish/push; the user does via Deploy
  sections.push(RELEASE_POLICY_SECTION);

  // 1. Spec location header
  const specContext = buildSpecLocationHeader(context);
  if (specContext) {
    sections.push(specContext);
  }

  // 2. Human input
  if (context.humanInput) {
    sections.push(
      `## HUMAN INPUT (READ THIS FIRST!)\n\n` +
      `The human has left you instructions. READ AND FOLLOW THESE CAREFULLY:\n\n` +
      `${context.humanInput}\n\n` +
      `After addressing this input, you may delete or clear the HUMAN_INPUT.md file.\n\n` +
      `---\n\n`
    );
  }

  // 3. Project instructions (AGENTS.md or CLAUDE.md fallback)
  if (context.projectInstructions) {
    sections.push(
      `## PROJECT INSTRUCTIONS\n\n` +
      `${context.projectInstructions}\n\n` +
      `---\n\n`
    );
  }

  // 4. Project memory (learned from previous tasks)
  if (context.memoryContext) {
    sections.push(
      `${PROJECT_MEMORY_HEADING}\n\n` +
      `Notes learned from earlier work in this project. They may be outdated: check them against ` +
      `the current code before relying on them. Items marked [unverified] have not been reviewed by a developer.\n\n` +
      `${context.memoryContext}\n\n` +
      `---\n\n`
    );
  }

  // 5. Base prompt
  sections.push(promptTemplate);

  return sections.join('');
}

/**
 * Build the SPEC LOCATION header section.
 */
function buildSpecLocationHeader(context: PromptContext): string {
  if (!context.specDir) return '';

  return (
    `## SPEC LOCATION\n\n` +
    `Your spec and progress files are located at:\n` +
    `- Spec: \`${context.specDir}/spec.md\`\n` +
    `- Implementation plan: \`${context.specDir}/implementation_plan.json\`\n` +
    `- Progress notes: \`${context.specDir}/build-progress.txt\`\n` +
    `- QA report output: \`${context.specDir}/qa_report.md\`\n` +
    `- Fix request output: \`${context.specDir}/QA_FIX_REQUEST.md\`\n\n` +
    `The project root is: \`${context.projectDir}\`\n\n` +
    `---\n\n`
  );
}

// =============================================================================
// QA Tools Section
// =============================================================================

/**
 * Generate the QA tools section based on project capabilities.
 * Mirrors get_mcp_tools_for_project() + tool injection in Python.
 *
 * @param capabilities - Detected project capabilities
 * @returns Assembled MCP tools documentation string, or empty string
 */
export function getQaToolsSection(capabilities: ProjectCapabilities): string {
  const toolFiles = getMcpToolFilesForCapabilities(capabilities);
  if (toolFiles.length === 0) return '';

  const sections: string[] = [
    '## PROJECT-SPECIFIC VALIDATION TOOLS\n\n' +
    'The following validation tools are available based on your project type:\n\n'
  ];

  for (const toolFile of toolFiles) {
    const content = tryLoadPrompt(toolFile.replace(/\.md$/, ''));
    if (content) {
      sections.push(content);
    }
  }

  if (sections.length <= 1) return '';

  return sections.join('\n\n---\n\n') + '\n\n---\n';
}

/**
 * Get MCP tool documentation file names for the given capabilities.
 * Mirrors get_mcp_tools_for_project() from Python.
 */
function getMcpToolFilesForCapabilities(capabilities: ProjectCapabilities): string[] {
  const tools: string[] = [];

  if (capabilities.is_electron) {
    tools.push('mcp_tools/electron_validation.md');
  }
  if (capabilities.is_tauri) {
    tools.push('mcp_tools/tauri_validation.md');
  }
  if (capabilities.is_web_frontend && !capabilities.is_electron) {
    tools.push('mcp_tools/puppeteer_browser.md');
  }
  if (capabilities.has_database) {
    tools.push('mcp_tools/database_validation.md');
  }
  if (capabilities.has_api) {
    tools.push('mcp_tools/api_validation.md');
  }

  return tools;
}

// =============================================================================
// Base Branch Detection
// =============================================================================

/**
 * Detect the base branch for a project.
 *
 * Priority:
 * 1. task_metadata.json baseBranch field
 * 2. DEFAULT_BRANCH environment variable
 * 3. Auto-detect: main / master / develop
 * 4. Fall back to "main"
 */
export function detectBaseBranch(specDir: string, projectDir: string): string {
  // 1. Check task_metadata.json
  const metadataPath = join(specDir, 'task_metadata.json');
  if (existsSync(metadataPath)) {
    try {
      const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8')) as { baseBranch?: string };
      const branch = validateBranchName(metadata.baseBranch);
      if (branch) return branch;
    } catch {
      // Continue
    }
  }

  // 2. Check DEFAULT_BRANCH env var
  const envBranch = validateBranchName(process.env.DEFAULT_BRANCH);
  if (envBranch) {
    try {
      execSync(`git rev-parse --verify ${envBranch}`, {
        cwd: projectDir,
        stdio: 'pipe',
        timeout: 3000,
      });
      return envBranch;
    } catch {
      // Branch doesn't exist
    }
  }

  // 3. Auto-detect
  for (const branch of ['main', 'master', 'develop']) {
    try {
      execSync(`git rev-parse --verify ${branch}`, {
        cwd: projectDir,
        stdio: 'pipe',
        timeout: 3000,
      });
      return branch;
    } catch {
      // Try next
    }
  }

  // 4. Fallback
  return 'main';
}

/**
 * Validate a git branch name for safety (mirrors Python _validate_branch_name).
 */
function validateBranchName(branch: string | null | undefined): string | null {
  if (!branch || typeof branch !== 'string') return null;
  const trimmed = branch.trim();
  if (!trimmed || trimmed.length > 255) return null;
  if (!/[a-zA-Z0-9]/.test(trimmed)) return null;
  if (!/^[A-Za-z0-9._/-]+$/.test(trimmed)) return null;
  return trimmed;
}

// =============================================================================
// Project Capabilities Detection
// =============================================================================

/**
 * Load project_index.json from the project's .malvy directory.
 */
export function loadProjectIndex(projectDir: string): Record<string, unknown> {
  const indexPath = join(projectDir, '.malvy', 'project_index.json');
  if (!existsSync(indexPath)) return {};
  try {
    return JSON.parse(readFileSync(indexPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Detect project capabilities from project_index.json.
 * Mirrors detect_project_capabilities() from Python.
 */
export function detectProjectCapabilities(projectIndex: Record<string, unknown>): ProjectCapabilities {
  const capabilities: ProjectCapabilities = {
    is_electron: false,
    is_tauri: false,
    is_expo: false,
    is_react_native: false,
    is_web_frontend: false,
    is_nextjs: false,
    is_nuxt: false,
    has_api: false,
    has_database: false,
  };

  const services = projectIndex.services;
  let serviceList: unknown[] = [];

  if (typeof services === 'object' && services !== null) {
    if (Array.isArray(services)) {
      serviceList = services;
    } else {
      serviceList = Object.values(services as Record<string, unknown>);
    }
  }

  for (const svc of serviceList) {
    if (!svc || typeof svc !== 'object') continue;
    const service = svc as Record<string, unknown>;

    // Collect all dependencies
    const deps = new Set<string>();
    for (const dep of ((service.dependencies as string[]) ?? [])) {
      if (typeof dep === 'string') deps.add(dep.toLowerCase());
    }
    for (const dep of ((service.dev_dependencies as string[]) ?? [])) {
      if (typeof dep === 'string') deps.add(dep.toLowerCase());
    }

    const framework = String(service.framework ?? '').toLowerCase();

    // Desktop
    if (deps.has('electron') || [...deps].some((d) => d.startsWith('@electron'))) {
      capabilities.is_electron = true;
    }
    if (deps.has('@tauri-apps/api') || deps.has('tauri')) {
      capabilities.is_tauri = true;
    }

    // Mobile
    if (deps.has('expo')) capabilities.is_expo = true;
    if (deps.has('react-native')) capabilities.is_react_native = true;

    // Web frontend
    const webFrameworks = new Set(['react', 'vue', 'svelte', 'angular', 'solid']);
    if (webFrameworks.has(framework)) capabilities.is_web_frontend = true;

    if (['nextjs', 'next.js', 'next'].includes(framework) || deps.has('next')) {
      capabilities.is_nextjs = true;
      capabilities.is_web_frontend = true;
    }
    if (['nuxt', 'nuxt.js'].includes(framework) || deps.has('nuxt')) {
      capabilities.is_nuxt = true;
      capabilities.is_web_frontend = true;
    }
    if (deps.has('vite') && !capabilities.is_electron) {
      capabilities.is_web_frontend = true;
    }

    // API
    const apiInfo = service.api as { routes?: unknown } | null | undefined;
    if (apiInfo && typeof apiInfo === 'object' && apiInfo.routes) {
      capabilities.has_api = true;
    }

    // Database
    if (service.database) capabilities.has_database = true;
    const dbDeps = new Set([
      'prisma', 'drizzle-orm', 'typeorm', 'sequelize', 'mongoose',
      'sqlalchemy', 'alembic', 'django', 'peewee',
    ]);
    for (const dep of deps) {
      if (dbDeps.has(dep)) {
        capabilities.has_database = true;
        break;
      }
    }
  }

  return capabilities;
}
