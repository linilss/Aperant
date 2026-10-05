import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { IPC_CHANNELS, AUTO_BUILD_PATHS } from '../../../shared/constants';
import type {
  IPCResult,
  ProjectContextData,
  ProjectIndex,
  RendererMemory,
  MemoryType,
  ClaudeDocsListing,
  DocProposal,
  ApplyDocProposalsResult,
  CodeBranch,
  DocsOptimizeOptions,
  DocsOptimizerResult,
  ProjectSummary,
} from '../../../shared/types';
import { projectStore } from '../../project-store';
import { buildMemoryStatus } from './memory-status-handlers';
import { getMemoryService } from './memory-service-factory';
import { runProjectIndexer } from '../../ai/project/project-indexer';
import type { Memory } from '../../ai/memory/types';
import { runClaudeDocsOptimizer } from '../../ai/runners/claude-docs-optimizer';
import {
  applyDocProposals,
  findClaudeDocs,
  readClaudeDoc,
  readDocsMeta,
  readProjectSummary,
  recordDocsOptimized,
  resolveMalvyDocTarget,
} from '../../claude-docs';
import { findCodeBranches } from '../../code-branches';
import { ensureClaudeLocalImports } from '../../claude-local';
import { listPointers, markPointersApplied, syncPointers } from './pointer-sync';
import { safeSendToRenderer } from '../utils';
import { getActiveProviderFeatureSettings } from '../feature-settings-helper';
import type { ThinkingLevel } from '../../../shared/types/settings';

// ============================================================
// MODULE-LEVEL STATE
// ============================================================

/** Active docs optimizer abort controllers keyed by projectId */
const optimizerAbortControllers = new Map<string, AbortController>();

// ============================================================
// HELPERS
// ============================================================

function toRendererMemory(m: Memory): RendererMemory {
  return {
    id: m.id,
    type: m.type as MemoryType,
    content: m.content,
    confidence: m.confidence,
    tags: m.tags,
    relatedFiles: m.relatedFiles,
    relatedModules: m.relatedModules,
    createdAt: m.createdAt,
    lastAccessedAt: m.lastAccessedAt,
    accessCount: m.accessCount,
    scope: m.scope as RendererMemory['scope'],
    source: m.source as RendererMemory['source'],
    needsReview: m.needsReview,
    userVerified: m.userVerified,
    citationText: m.citationText,
    pinned: m.pinned,
    methodology: m.methodology,
    deprecated: m.deprecated,
  };
}

/**
 * Load project index from file
 */
function loadProjectIndex(projectPath: string): ProjectIndex | null {
  const indexPath = path.join(projectPath, AUTO_BUILD_PATHS.PROJECT_INDEX);
  if (!existsSync(indexPath)) {
    return null;
  }

  try {
    const content = readFileSync(indexPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Load recent memories from the MemoryService with graceful degradation.
 */
async function loadRecentMemories(projectId: string): Promise<RendererMemory[]> {
  try {
    const service = await getMemoryService();
    const memories = await service.search({
      projectId,
      limit: 20,
      sort: 'recency',
      excludeDeprecated: true,
    });
    return memories.map(toRendererMemory);
  } catch {
    // Memory service unavailable — return empty list
    return [];
  }
}

// ============================================================
// REGISTER HANDLERS
// ============================================================

/**
 * Register project context handlers
 */
export function registerProjectContextHandlers(
  getMainWindow: () => BrowserWindow | null
): void {
  // Get full project context
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_GET,
    async (_, projectId: string): Promise<IPCResult<ProjectContextData>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      try {
        // Load project index
        const projectIndex = loadProjectIndex(project.path);

        // Build memory status (libSQL-based)
        const memoryStatus = await buildMemoryStatus();

        // Load recent memories from memory service
        const recentMemories = await loadRecentMemories(projectId);

        return {
          success: true,
          data: {
            projectIndex,
            memoryStatus,
            memoryState: null,
            recentMemories,
            isLoading: false
          }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to load project context'
        };
      }
    }
  );

  // Refresh project index
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_REFRESH_INDEX,
    async (_, projectId: string): Promise<IPCResult<ProjectIndex>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      try {
        const indexOutputPath = path.join(project.path, AUTO_BUILD_PATHS.PROJECT_INDEX);

        // Run the TypeScript project indexer (replaces Python subprocess)
        const projectIndex = runProjectIndexer(project.path, indexOutputPath);

        return { success: true, data: projectIndex };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to refresh project index'
        };
      }
    }
  );

  // ============================================================
  // CLAUDE.md docs tree (team + .malvy/docs layers)
  // ============================================================

  // List doc files in both layers + last optimization time
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_DOCS_LIST,
    async (_, projectId: string): Promise<IPCResult<ClaudeDocsListing>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }
      try {
        const docs = await findClaudeDocs(project.path);
        return { success: true, data: { docs, lastOptimizedAt: readDocsMeta(project.path).lastOptimizedAt } };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Failed to list docs' };
      }
    }
  );

  // Read a single doc file (project-relative path)
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_DOCS_READ,
    async (_, projectId: string, relativePath: string): Promise<IPCResult<string>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }
      try {
        return { success: true, data: await readClaudeDoc(project.path, relativePath) };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Failed to read doc' };
      }
    }
  );

  // List code branches with their documentation status
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_DOCS_BRANCHES,
    async (_, projectId: string): Promise<IPCResult<CodeBranch[]>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }
      try {
        return { success: true, data: await findCodeBranches(project.path, loadProjectIndex(project.path)) };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Failed to list code branches' };
      }
    }
  );

  // Read .malvy/docs/project_summary.json (null when not generated yet)
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_DOCS_SUMMARY,
    async (_, projectId: string): Promise<IPCResult<ProjectSummary | null>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }
      return { success: true, data: readProjectSummary(project.path) };
    }
  );

  // Start the docs optimizer (fire-and-forget; streams events to renderer)
  ipcMain.on(IPC_CHANNELS.CONTEXT_DOCS_OPTIMIZE, (_, projectId: string, options?: DocsOptimizeOptions) => {
    const project = projectStore.getProject(projectId);
    if (!project) {
      safeSendToRenderer(getMainWindow, IPC_CHANNELS.CONTEXT_DOCS_ERROR, projectId, 'Project not found');
      return;
    }
    void startDocsOptimizer(projectId, project.path, sanitizeOptimizeOptions(options), getMainWindow);
  });

  // Stop an in-progress optimizer run
  ipcMain.on(IPC_CHANNELS.CONTEXT_DOCS_STOP, (_, projectId: string) => {
    const controller = optimizerAbortControllers.get(projectId);
    if (controller) {
      controller.abort();
      optimizerAbortControllers.delete(projectId);
    }
  });

  // Apply approved proposals — writes ONLY under .malvy/docs/
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_DOCS_APPLY,
    async (_, projectId: string, proposals: DocProposal[]): Promise<IPCResult<ApplyDocProposalsResult>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }
      if (!Array.isArray(proposals)) {
        return { success: false, error: 'Invalid proposals' };
      }

      const result = applyDocProposals(project.path, proposals);

      for (const proposal of result.applied) {
        if (proposal.action !== 'delete' && proposal.appliedPointerIds?.length) {
          await markPointersApplied(proposal.appliedPointerIds, proposal.path).catch(() => undefined);
        }
      }
      await syncPointers(projectId).catch(() => undefined);
      try {
        ensureClaudeLocalImports(project.path);
      } catch {
        // Non-fatal: the docs were written; CLI wiring is retried on the next change
      }

      return {
        success: true,
        data: { applied: result.applied.map((p) => p.path), errors: result.errors },
      };
    }
  );
}

// ============================================================
// DOCS OPTIMIZER HELPER
// ============================================================

function sanitizeOptimizeOptions(options: unknown): DocsOptimizeOptions {
  if (!options || typeof options !== 'object') return {};
  const raw = options as Record<string, unknown>;
  return {
    branches: Array.isArray(raw.branches)
      ? raw.branches.filter((b): b is string => typeof b === 'string')
      : undefined,
    includeRoot: typeof raw.includeRoot === 'boolean' ? raw.includeRoot : undefined,
  };
}

/** Display label for a branch in the streamed log */
function branchLabel(branch: string): string {
  return branch || '(root)';
}

/**
 * Start an async optimizer run for a project. Branch passes run in parallel,
 * so streamed text is buffered per branch and sent as whole lines prefixed with
 * the branch path; tool calls are sent as `[branch] [Tool: Name] input` lines.
 * Branches reviewed without changes are recorded in `.meta.json` right away.
 */
async function startDocsOptimizer(
  projectId: string,
  projectPath: string,
  options: DocsOptimizeOptions,
  getMainWindow: () => BrowserWindow | null
): Promise<void> {
  optimizerAbortControllers.get(projectId)?.abort();
  const controller = new AbortController();
  optimizerAbortControllers.set(projectId, controller);

  const release = () => {
    if (optimizerAbortControllers.get(projectId) === controller) {
      optimizerAbortControllers.delete(projectId);
    }
  };
  const sendError = (error: string) => {
    // A user-initiated stop is not an error
    if (controller.signal.aborted) return;
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.CONTEXT_DOCS_ERROR, projectId, error);
    release();
  };
  const sendChunk = (chunk: string) =>
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.CONTEXT_DOCS_CHUNK, projectId, chunk);

  // Per-branch partial lines of streamed text
  const partial = new Map<string, string>();
  const flush = (branch: string) => {
    const rest = partial.get(branch);
    if (rest?.trim()) sendChunk(`[${branchLabel(branch)}] ${rest}\n`);
    partial.delete(branch);
  };

  const pointers = await listPointers(projectId).catch(() => []);
  const { model, thinkingLevel } = getActiveProviderFeatureSettings('insights');

  runClaudeDocsOptimizer(
    {
      projectDir: projectPath,
      pointers,
      branches: options.branches,
      includeRoot: options.includeRoot,
      modelShorthand: model as Parameters<typeof runClaudeDocsOptimizer>[0]['modelShorthand'],
      thinkingLevel: thinkingLevel as ThinkingLevel,
      abortSignal: controller.signal,
    },
    (event) => {
      switch (event.type) {
        case 'branch-progress': {
          if (event.status !== 'queued' && event.status !== 'running') flush(event.branch);
          const { type: _type, ...progress } = event;
          safeSendToRenderer(getMainWindow, IPC_CHANNELS.CONTEXT_DOCS_BRANCH_PROGRESS, projectId, progress);
          break;
        }
        case 'text-delta': {
          const lines = `${partial.get(event.branch) ?? ''}${event.delta}`.split('\n');
          partial.set(event.branch, lines.pop() ?? '');
          const label = branchLabel(event.branch);
          const complete = lines.filter((line) => line.trim() !== '');
          if (complete.length > 0) sendChunk(`${complete.map((line) => `[${label}] ${line}`).join('\n')}\n`);
          break;
        }
        case 'tool-use':
          sendChunk(`[${branchLabel(event.branch)}] [Tool: ${event.toolName}] ${event.input}\n`);
          break;
        case 'complete': {
          if (event.skippedBranches.length > 0) {
            try {
              recordDocsOptimized(projectPath, event.skippedBranches);
            } catch {
              // Non-fatal: the branch just keeps its previous status
            }
          }
          const proposals = event.proposals.filter((p) => {
            try {
              resolveMalvyDocTarget(projectPath, p.path);
              return true;
            } catch {
              return false;
            }
          });
          const result: DocsOptimizerResult = { proposals, projectSummary: event.projectSummary };
          safeSendToRenderer(getMainWindow, IPC_CHANNELS.CONTEXT_DOCS_COMPLETE, projectId, result);
          release();
          break;
        }
        case 'error':
          sendError(event.error);
          break;
      }
    }
  ).catch((err) => sendError(err instanceof Error ? err.message : String(err)));
}
