import { create } from 'zustand';
import type {
  ProjectIndex,
  MemorySystemStatus,
  MemorySystemState,
  RendererMemory,
  ContextSearchResult
} from '../../shared/types';

export interface ProjectDocumentation {
  generatedAt: string;
  projectName: string;
  overview: string;
  architecture: string;
  modules: Array<{
    name: string;
    path: string;
    description: string;
    responsibilities: string[];
    keyFiles: string[];
  }>;
  apiSurface: string;
  dataModels: string;
  developerGuide: string;
  techStack: string;
}

interface ContextState {
  // Project Index
  projectIndex: ProjectIndex | null;
  indexLoading: boolean;
  indexError: string | null;

  // Memory Status
  memoryStatus: MemorySystemStatus | null;
  memoryState: MemorySystemState | null;
  memoryLoading: boolean;
  memoryError: string | null;

  // Recent Memories
  recentMemories: RendererMemory[];
  memoriesLoading: boolean;

  // Search
  searchResults: ContextSearchResult[];
  searchLoading: boolean;
  searchQuery: string;

  // Documentation
  documentation: ProjectDocumentation | null;
  documentationLoading: boolean;
  documentationError: string | null;
  documentationStreamChunk: string;

  // Actions
  setProjectIndex: (index: ProjectIndex | null) => void;
  setIndexLoading: (loading: boolean) => void;
  setIndexError: (error: string | null) => void;
  setMemoryStatus: (status: MemorySystemStatus | null) => void;
  setMemoryState: (state: MemorySystemState | null) => void;
  setMemoryLoading: (loading: boolean) => void;
  setMemoryError: (error: string | null) => void;
  setRecentMemories: (memories: RendererMemory[]) => void;
  setMemoriesLoading: (loading: boolean) => void;
  setSearchResults: (results: ContextSearchResult[]) => void;
  setSearchLoading: (loading: boolean) => void;
  setSearchQuery: (query: string) => void;
  setDocumentation: (doc: ProjectDocumentation | null) => void;
  setDocumentationLoading: (loading: boolean) => void;
  setDocumentationError: (error: string | null) => void;
  appendDocumentationChunk: (chunk: string) => void;
  clearDocumentationChunk: () => void;
  clearAll: () => void;
}

export const useContextStore = create<ContextState>((set) => ({
  // Project Index
  projectIndex: null,
  indexLoading: false,
  indexError: null,

  // Memory Status
  memoryStatus: null,
  memoryState: null,
  memoryLoading: false,
  memoryError: null,

  // Recent Memories
  recentMemories: [],
  memoriesLoading: false,

  // Search
  searchResults: [],
  searchLoading: false,
  searchQuery: '',

  // Documentation
  documentation: null,
  documentationLoading: false,
  documentationError: null,
  documentationStreamChunk: '',

  // Actions
  setProjectIndex: (index) => set({ projectIndex: index }),
  setIndexLoading: (loading) => set({ indexLoading: loading }),
  setIndexError: (error) => set({ indexError: error }),
  setMemoryStatus: (status) => set({ memoryStatus: status }),
  setMemoryState: (state) => set({ memoryState: state }),
  setMemoryLoading: (loading) => set({ memoryLoading: loading }),
  setMemoryError: (error) => set({ memoryError: error }),
  setRecentMemories: (memories) => set({ recentMemories: memories }),
  setMemoriesLoading: (loading) => set({ memoriesLoading: loading }),
  setSearchResults: (results) => set({ searchResults: results }),
  setSearchLoading: (loading) => set({ searchLoading: loading }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setDocumentation: (doc) => set({ documentation: doc }),
  setDocumentationLoading: (loading) => set({ documentationLoading: loading }),
  setDocumentationError: (error) => set({ documentationError: error }),
  appendDocumentationChunk: (chunk) =>
    set((state) => ({ documentationStreamChunk: state.documentationStreamChunk + chunk })),
  clearDocumentationChunk: () => set({ documentationStreamChunk: '' }),
  clearAll: () =>
    set({
      projectIndex: null,
      indexLoading: false,
      indexError: null,
      memoryStatus: null,
      memoryState: null,
      memoryLoading: false,
      memoryError: null,
      recentMemories: [],
      memoriesLoading: false,
      searchResults: [],
      searchLoading: false,
      searchQuery: '',
      documentation: null,
      documentationLoading: false,
      documentationError: null,
      documentationStreamChunk: ''
    })
}));

/**
 * Load project context (project index + memory status)
 */
export async function loadProjectContext(projectId: string): Promise<void> {
  const store = useContextStore.getState();
  store.setIndexLoading(true);
  store.setMemoryLoading(true);
  store.setIndexError(null);
  store.setMemoryError(null);

  try {
    const result = await window.electronAPI.getProjectContext(projectId);
    if (result.success && result.data && typeof result.data === 'object') {
      const data = result.data as {
        projectIndex?: unknown;
        memoryStatus?: unknown;
        memoryState?: unknown;
        recentMemories?: unknown;
      };
      if (data.projectIndex && typeof data.projectIndex === 'object') {
        store.setProjectIndex(data.projectIndex as ProjectIndex);
      }
      if (data.memoryStatus && typeof data.memoryStatus === 'object') {
        store.setMemoryStatus(data.memoryStatus as MemorySystemStatus);
      }
      if (data.memoryState && typeof data.memoryState === 'object') {
        store.setMemoryState(data.memoryState as MemorySystemState);
      }
      if (Array.isArray(data.recentMemories)) {
        store.setRecentMemories(data.recentMemories as RendererMemory[]);
      } else if (result.success) {
        // Unexpected data shape - clear to avoid stale data
        store.setRecentMemories([]);
      }
    } else {
      store.setIndexError(result.error || 'Failed to load project context');
    }
  } catch (error) {
    store.setIndexError(error instanceof Error ? error.message : 'Unknown error');
  } finally {
    store.setIndexLoading(false);
    store.setMemoryLoading(false);
  }
}

/**
 * Refresh project index by re-running analyzer
 */
export async function refreshProjectIndex(projectId: string): Promise<void> {
  const store = useContextStore.getState();
  store.setIndexLoading(true);
  store.setIndexError(null);

  try {
    const result = await window.electronAPI.refreshProjectIndex(projectId);
    if (result.success && result.data && typeof result.data === 'object') {
      store.setProjectIndex(result.data as ProjectIndex);
    } else {
      store.setIndexError(result.error || 'Failed to refresh project index');
    }
  } catch (error) {
    store.setIndexError(error instanceof Error ? error.message : 'Unknown error');
  } finally {
    store.setIndexLoading(false);
  }
}

/**
 * Search memories using semantic search
 */
export async function searchMemories(
  projectId: string,
  query: string
): Promise<void> {
  const store = useContextStore.getState();
  store.setSearchQuery(query);

  if (!query.trim()) {
    store.setSearchResults([]);
    return;
  }

  store.setSearchLoading(true);

  try {
    const result = await window.electronAPI.searchMemories(projectId, query);
    if (result.success && result.data && Array.isArray(result.data)) {
      store.setSearchResults(result.data as ContextSearchResult[]);
    } else {
      store.setSearchResults([]);
    }
  } catch (_error) {
    store.setSearchResults([]);
  } finally {
    store.setSearchLoading(false);
  }
}

/**
 * Load recent memories
 */
export async function loadRecentMemories(
  projectId: string,
  limit: number = 20
): Promise<void> {
  const store = useContextStore.getState();
  store.setMemoriesLoading(true);

  try {
    const result = await window.electronAPI.getRecentMemories(projectId, limit);
    if (result.success && result.data && Array.isArray(result.data)) {
      store.setRecentMemories(result.data as RendererMemory[]);
    }
  } catch (_error) {
    // Silently fail - memories are optional
  } finally {
    store.setMemoriesLoading(false);
  }
}

/**
 * Verify a memory (mark as user-verified)
 */
export async function verifyMemory(memoryId: string): Promise<boolean> {
  try {
    const result = await window.electronAPI.verifyMemory(memoryId);
    if (result.success) {
      const store = useContextStore.getState();
      store.setRecentMemories(
        store.recentMemories.map((m) =>
          m.id === memoryId ? { ...m, userVerified: true, needsReview: false } : m
        )
      );
    }
    return result.success;
  } catch {
    return false;
  }
}

/**
 * Pin/unpin a memory
 */
export async function pinMemory(memoryId: string, pinned: boolean): Promise<boolean> {
  try {
    const result = await window.electronAPI.pinMemory(memoryId, pinned);
    if (result.success) {
      const store = useContextStore.getState();
      store.setRecentMemories(
        store.recentMemories.map((m) =>
          m.id === memoryId ? { ...m, pinned } : m
        )
      );
    }
    return result.success;
  } catch {
    return false;
  }
}

/**
 * Deprecate a memory (soft delete)
 */
export async function deprecateMemory(memoryId: string): Promise<boolean> {
  try {
    const result = await window.electronAPI.deprecateMemory(memoryId);
    if (result.success) {
      const store = useContextStore.getState();
      store.setRecentMemories(
        store.recentMemories.filter((m) => m.id !== memoryId)
      );
    }
    return result.success;
  } catch {
    return false;
  }
}

/**
 * Delete a memory permanently
 */
export async function deleteMemory(memoryId: string): Promise<boolean> {
  try {
    const result = await window.electronAPI.deleteMemory(memoryId);
    if (result.success) {
      const store = useContextStore.getState();
      store.setRecentMemories(
        store.recentMemories.filter((m) => m.id !== memoryId)
      );
    }
    return result.success;
  } catch {
    return false;
  }
}
