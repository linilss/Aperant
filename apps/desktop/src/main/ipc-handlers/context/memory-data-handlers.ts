import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants';
import type {
  IPCResult,
  RendererMemory,
  ContextSearchResult,
  MemoryType,
  DocPointer,
  CreatePointerInput,
} from '../../../shared/types';
import { projectStore } from '../../project-store';
import { getMemoryService } from './memory-service-factory';
import { listPointers, POINTER_TAG, syncPointers, toDocPointer } from './pointer-sync';
import type { Memory } from '../../ai/memory/types';

// ============================================================
// MAPPING HELPER
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
 * After a memory is deprecated/deleted, refresh the pointers mirror if it was
 * a pointer (user_taught) so .malvy/pointers.md never goes stale.
 */
async function resyncIfPointer(memory: Memory | null): Promise<void> {
  if (memory?.source === 'user_taught' && memory.projectId) {
    await syncPointers(memory.projectId).catch(() => undefined);
  }
}

// ============================================================
// REGISTER HANDLERS
// ============================================================

/**
 * Register memory data handlers
 */
export function registerMemoryDataHandlers(
  _getMainWindow: () => BrowserWindow | null
): void {
  // Get all memories (sorted by recency)
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_GET_MEMORIES,
    async (_, projectId: string, limit: number = 20): Promise<IPCResult<RendererMemory[]>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      try {
        const service = await getMemoryService();
        const memories = await service.search({
          projectId,
          limit,
          sort: 'recency',
          excludeDeprecated: true,
        });
        return { success: true, data: memories.map(toRendererMemory) };
      } catch {
        // Graceful degradation: return empty list if memory service is unavailable
        return { success: true, data: [] };
      }
    }
  );

  // Verify a memory (mark as user-verified)
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_MEMORY_VERIFY,
    async (_, memoryId: string): Promise<IPCResult<void>> => {
      try {
        const service = await getMemoryService();
        await service.verifyMemory(memoryId);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Failed to verify memory' };
      }
    }
  );

  // Pin/unpin a memory
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_MEMORY_PIN,
    async (_, memoryId: string, pinned: boolean): Promise<IPCResult<void>> => {
      try {
        const service = await getMemoryService();
        await service.pinMemory(memoryId, pinned);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Failed to pin memory' };
      }
    }
  );

  // Deprecate a memory (soft delete)
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_MEMORY_DEPRECATE,
    async (_, memoryId: string): Promise<IPCResult<void>> => {
      try {
        const service = await getMemoryService();
        const memory = await service.getMemory(memoryId);
        await service.deprecateMemory(memoryId);
        await resyncIfPointer(memory);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Failed to deprecate memory' };
      }
    }
  );

  // Delete a memory permanently
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_MEMORY_DELETE,
    async (_, memoryId: string): Promise<IPCResult<void>> => {
      try {
        const service = await getMemoryService();
        const memory = await service.getMemory(memoryId);
        await service.deleteMemory(memoryId);
        await resyncIfPointer(memory);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Failed to delete memory' };
      }
    }
  );

  // Search memories
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_SEARCH_MEMORIES,
    async (_, projectId: string, query: string): Promise<IPCResult<ContextSearchResult[]>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      try {
        const service = await getMemoryService();
        const memories = await service.search({
          query,
          projectId,
          limit: 20,
          excludeDeprecated: true,
        });
        return {
          success: true,
          data: memories.map((m) => ({
            content: m.content,
            score: m.confidence,
            type: m.type,
          })),
        };
      } catch {
        // Graceful degradation: return empty list if memory service is unavailable
        return { success: true, data: [] };
      }
    }
  );
  // ============================================================
  // Developer pointers (user_taught memories)
  // ============================================================

  // List pointers for a project
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_POINTERS_LIST,
    async (_, projectId: string): Promise<IPCResult<DocPointer[]>> => {
      try {
        return { success: true, data: await listPointers(projectId) };
      } catch {
        // Graceful degradation: memory service unavailable
        return { success: true, data: [] };
      }
    }
  );

  // Create a pointer (optionally anchored to a doc file + heading)
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_MEMORY_CREATE,
    async (_, projectId: string, input: CreatePointerInput): Promise<IPCResult<DocPointer>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }
      const content = input?.content?.trim();
      if (!content) {
        return { success: false, error: 'Pointer content is empty' };
      }

      try {
        const service = await getMemoryService();
        const id = await service.store({
          type: 'preference',
          content,
          projectId,
          source: 'user_taught',
          confidence: 1.0,
          scope: 'global',
          pinned: true,
          tags: [POINTER_TAG],
          relatedFiles: input.docPath ? [input.docPath] : [],
          citationText: input.heading || undefined,
        });
        await syncPointers(projectId);
        const memory = await service.getMemory(id);
        if (!memory) {
          return { success: false, error: 'Pointer was not saved' };
        }
        return { success: true, data: toDocPointer(memory) };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Failed to create pointer' };
      }
    }
  );

  // Update a pointer's text
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_MEMORY_UPDATE,
    async (_, projectId: string, memoryId: string, content: string): Promise<IPCResult<void>> => {
      const trimmed = content?.trim();
      if (!trimmed) {
        return { success: false, error: 'Pointer content is empty' };
      }
      try {
        const service = await getMemoryService();
        await service.updateMemory(memoryId, { content: trimmed });
        await syncPointers(projectId);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Failed to update pointer' };
      }
    }
  );

  // Delete a pointer permanently
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_POINTERS_DELETE,
    async (_, projectId: string, memoryId: string): Promise<IPCResult<void>> => {
      try {
        const service = await getMemoryService();
        await service.deleteMemory(memoryId);
        await syncPointers(projectId);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Failed to delete pointer' };
      }
    }
  );
}
