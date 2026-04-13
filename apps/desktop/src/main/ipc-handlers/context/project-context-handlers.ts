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
} from '../../../shared/types';
import { projectStore } from '../../project-store';
import { buildMemoryStatus } from './memory-status-handlers';
import { getMemoryService } from './memory-service-factory';
import { runProjectIndexer } from '../../ai/project/project-indexer';
import type { Memory } from '../../ai/memory/types';
import { runProjectDocumentation } from '../../ai/runners/project-documentation';
import type { ProjectDocumentation } from '../../ai/runners/project-documentation';
import { safeSendToRenderer } from '../utils';
import { getActiveProviderFeatureSettings } from '../feature-settings-helper';
import type { ThinkingLevel } from '../../../shared/types/settings';

// ============================================================
// MODULE-LEVEL STATE
// ============================================================

/** Active documentation generation abort controllers keyed by projectId */
const documentationAbortControllers = new Map<string, AbortController>();

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
  // Project Documentation Handlers
  // ============================================================

  // Get cached documentation (returns null if not yet generated)
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_GET_DOCUMENTATION,
    async (_, projectId: string): Promise<IPCResult<ProjectDocumentation | null>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const docPath = path.join(project.path, AUTO_BUILD_PATHS.DOCUMENTATION_FILE);
      if (!existsSync(docPath)) {
        return { success: true, data: null };
      }

      try {
        const content = readFileSync(docPath, 'utf-8');
        const data = JSON.parse(content) as ProjectDocumentation;
        return { success: true, data };
      } catch {
        return { success: true, data: null };
      }
    }
  );

  // Start documentation generation (fire-and-forget; streams events to renderer)
  ipcMain.on(
    IPC_CHANNELS.CONTEXT_GENERATE_DOCUMENTATION,
    (_, projectId: string) => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        safeSendToRenderer(
          getMainWindow,
          IPC_CHANNELS.CONTEXT_DOCUMENTATION_ERROR,
          projectId,
          'Project not found'
        );
        return;
      }

      startDocumentationGeneration(projectId, project.path, getMainWindow);
    }
  );

  // Stop in-progress documentation generation
  ipcMain.on(
    IPC_CHANNELS.CONTEXT_DOCUMENTATION_STOP,
    (_, projectId: string) => {
      const controller = documentationAbortControllers.get(projectId);
      if (controller) {
        controller.abort();
        documentationAbortControllers.delete(projectId);
      }
    }
  );
}

// ============================================================
// DOCUMENTATION GENERATION HELPER
// ============================================================

/**
 * Start an async documentation generation run for a project.
 * Streams events back to the renderer via IPC. Fire-and-forget — does not await.
 */
function startDocumentationGeneration(
  projectId: string,
  projectPath: string,
  getMainWindow: () => BrowserWindow | null
): void {
  // Abort any in-progress run for the same project
  const existing = documentationAbortControllers.get(projectId);
  if (existing) {
    existing.abort();
  }

  const controller = new AbortController();
  documentationAbortControllers.set(projectId, controller);

  const { model, thinkingLevel } = getActiveProviderFeatureSettings('insights');

  runProjectDocumentation(
    {
      projectDir: projectPath,
      modelShorthand: model as Parameters<typeof runProjectDocumentation>[0]['modelShorthand'],
      thinkingLevel: thinkingLevel as ThinkingLevel,
      abortSignal: controller.signal,
    },
    (event) => {
      switch (event.type) {
        case 'text-delta':
          safeSendToRenderer(
            getMainWindow,
            IPC_CHANNELS.CONTEXT_DOCUMENTATION_CHUNK,
            projectId,
            event.delta
          );
          break;
        case 'tool-use':
          safeSendToRenderer(
            getMainWindow,
            IPC_CHANNELS.CONTEXT_DOCUMENTATION_TOOL_USE,
            projectId,
            event.toolName
          );
          break;
        case 'complete':
          safeSendToRenderer(
            getMainWindow,
            IPC_CHANNELS.CONTEXT_DOCUMENTATION_COMPLETE,
            projectId,
            event.documentation
          );
          documentationAbortControllers.delete(projectId);
          break;
        case 'error':
          safeSendToRenderer(
            getMainWindow,
            IPC_CHANNELS.CONTEXT_DOCUMENTATION_ERROR,
            projectId,
            event.error
          );
          documentationAbortControllers.delete(projectId);
          break;
      }
    }
  ).catch((err) => {
    const errorMsg = err instanceof Error ? err.message : String(err);
    safeSendToRenderer(
      getMainWindow,
      IPC_CHANNELS.CONTEXT_DOCUMENTATION_ERROR,
      projectId,
      errorMsg
    );
    documentationAbortControllers.delete(projectId);
  });
}
