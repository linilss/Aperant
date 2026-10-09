/**
 * Agent memory glue (main process only).
 *
 * The memory database can't be opened from agent worker threads, so:
 * - Read path: before a task's worker starts, build the PROJECT MEMORY text here and
 *   pass it in the serializable session config (`memoryContext`).
 * - Write path: after a build / QA run succeeds, distill insights from the task's
 *   changes and store them as reviewable memories.
 *
 * Every step is best-effort: failures are logged and never block the task.
 */

import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { getToolPath } from '../cli-tool-manager';
import { readSettingsFile } from '../settings-utils';
import { parseEnvFile } from '../ipc-handlers/utils';
import { getMemoryService } from '../ipc-handlers/context/memory-service-factory';
import { getMemoryClient } from '../ai/memory/db';
import { searchBM25 } from '../ai/memory/retrieval/bm25-search';
import type { Memory } from '../ai/memory/types';
import { PROJECT_MEMORY_ENV_KEY, resolveMemoryEnabled } from '../ai/memory/memory-enabled';
import { buildTaskMemoryContext } from '../ai/memory/injection/task-memory-context';
import { specTag, storeTaskLearnings } from '../ai/memory/task-learning';
import { extractSessionInsights } from '../ai/runners/insight-extractor';
import { detectBaseBranch } from '../ai/prompts/prompt-loader';

const execFileAsync = promisify(execFile);

/** Upper bound for building the memory context so task start is never held up */
const MEMORY_CONTEXT_TIMEOUT_MS = 8000;
const MAX_QUERY_CHARS = 2000;
const MAX_KEYWORD_TERMS = 12;

function log(message: string): void {
  console.warn(`[AgentMemory] ${message}`);
}

/**
 * Whether built-in memory is on for a project: the project's Memory setting
 * (.malvy/.env) overrides the app-wide onboarding setting.
 */
export function isAgentMemoryEnabled(projectPath: string, autoBuildPath?: string): boolean {
  const settings = readSettingsFile();
  let projectValue: string | undefined;
  if (autoBuildPath) {
    const envPath = path.join(projectPath, autoBuildPath, '.env');
    try {
      if (existsSync(envPath)) {
        projectValue = parseEnvFile(readFileSync(envPath, 'utf-8'))[PROJECT_MEMORY_ENV_KEY];
      }
    } catch {
      // Unreadable .env → fall back to the app setting
    }
  }
  return resolveMemoryEnabled(settings?.memoryEnabled as boolean | undefined, projectValue);
}

/**
 * Build the memory search query for a task from its spec directory:
 * spec.md (title + opening section) or requirements.json task_description.
 */
export function buildTaskMemoryQuery(specDir: string, taskDescription?: string): string {
  const parts: string[] = [];
  if (taskDescription) parts.push(taskDescription);
  try {
    const specPath = path.join(specDir, 'spec.md');
    if (existsSync(specPath)) {
      parts.push(readFileSync(specPath, 'utf-8').slice(0, 1200));
    } else {
      const reqPath = path.join(specDir, 'requirements.json');
      if (existsSync(reqPath)) {
        const req = JSON.parse(readFileSync(reqPath, 'utf-8')) as { task_description?: string };
        if (req.task_description) parts.push(req.task_description);
      }
    }
  } catch {
    // Spec files are optional input for the query
  }
  return parts.join('\n').slice(0, MAX_QUERY_CHARS);
}

/** BM25/FTS-only search with OR-ed keywords (works without embeddings) */
async function keywordSearch(query: string, projectId: string, limit: number): Promise<Memory[]> {
  const terms = [...new Set(query.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? [])].slice(0, MAX_KEYWORD_TERMS);
  if (terms.length === 0) return [];
  const db = await getMemoryClient();
  const hits = await searchBM25(db, terms.map((t) => `"${t}"`).join(' OR '), projectId, limit);
  const service = await getMemoryService();
  const memories = await Promise.all(hits.map((h) => service.getMemory(h.memoryId)));
  return memories.filter((m): m is Memory => m !== null);
}

/**
 * Build the PROJECT MEMORY text for a task, or undefined when memory is off,
 * nothing relevant exists, or the memory system is unavailable.
 */
export async function buildMemoryContextForTask(options: {
  projectId?: string;
  projectPath: string;
  autoBuildPath?: string;
  query: string;
}): Promise<string | undefined> {
  const { projectId, projectPath, autoBuildPath, query } = options;
  if (!projectId || !isAgentMemoryEnabled(projectPath, autoBuildPath)) return undefined;

  const build = async (): Promise<string> => {
    let search: Parameters<typeof buildTaskMemoryContext>[0]['search'];
    try {
      const service = await getMemoryService();
      search = (filters) => service.search(filters);
    } catch (error) {
      log(`Memory service unavailable, using keyword search only: ${error instanceof Error ? error.message : String(error)}`);
      search = async () => {
        throw new Error('memory service unavailable');
      };
    }
    return buildTaskMemoryContext({ search, keywordSearch }, { projectId, query, onLog: log });
  };

  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<string>((resolve) => {
      timer = setTimeout(() => {
        log('Memory context timed out, starting without it');
        resolve('');
      }, MEMORY_CONTEXT_TIMEOUT_MS);
    });
    const context = await Promise.race([build(), timeout]);
    if (timer) clearTimeout(timer);
    return context || undefined;
  } catch (error) {
    log(`Skipping memory context: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync(getToolPath('git'), args, {
    cwd,
    encoding: 'utf-8',
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout;
}

/**
 * After a successful build / QA run: distill insights from the task's changes and
 * store them as reviewable memories. Runs once per spec (skipped if this spec
 * already produced memories).
 */
export async function learnFromCompletedTask(options: {
  projectId?: string;
  projectPath: string;
  autoBuildPath?: string;
  specId: string;
  /** Worktree (or project root) the task ran in */
  workDir: string;
  /** Spec dir inside workDir */
  specDir: string;
}): Promise<void> {
  const { projectId, projectPath, autoBuildPath, specId, workDir, specDir } = options;
  if (!projectId || !isAgentMemoryEnabled(projectPath, autoBuildPath)) return;

  try {
    const service = await getMemoryService();
    const tag = specTag(specId);
    const existing = await service.search({ projectId, excludeDeprecated: false, limit: 1000 });
    if (existing.some((m) => m.tags.includes(tag))) return;

    const baseBranch = detectBaseBranch(specDir, workDir);
    const mergeBase = (await git(['merge-base', 'HEAD', baseBranch], workDir)).trim();
    const changedFiles = (await git(['diff', '--name-only', `${mergeBase}..HEAD`], workDir))
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => f && !f.startsWith('.malvy/'));
    if (changedFiles.length === 0) return;

    const [diff, commitMessages] = await Promise.all([
      git(['diff', `${mergeBase}..HEAD`, '--', '.', ':(exclude).malvy'], workDir),
      git(['log', '--format=%s', `${mergeBase}..HEAD`], workDir),
    ]);

    const insights = await extractSessionInsights({
      subtaskId: specId,
      subtaskDescription: buildTaskMemoryQuery(specDir).slice(0, 500) || specId,
      sessionNum: 1,
      success: true,
      diff,
      changedFiles,
      commitMessages,
      attemptHistory: [],
    });

    const { stored, skipped } = await storeTaskLearnings(service, { projectId, specId, changedFiles, insights });
    if (stored > 0 || skipped > 0) {
      log(`Learned ${stored} memories from ${specId} (${skipped} duplicates skipped)`);
    }
  } catch (error) {
    log(`Task learning skipped for ${specId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
