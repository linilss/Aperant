import { create } from 'zustand';
import type {
  ProjectIndex,
  MemorySystemStatus,
  MemorySystemState,
  RendererMemory,
  ContextSearchResult,
  ClaudeDocFile,
  DocPointer,
  DocProposal,
  CreatePointerInput,
  ApplyDocProposalsResult,
  CodeBranch,
  ProjectSummary,
  BranchProgressEvent,
  DocsOptimizeOptions,
  DocsOptimizerResult
} from '../../shared/types';

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

  // Docs tree (team + .malvy/docs)
  docs: ClaudeDocFile[];
  docsLoading: boolean;
  lastOptimizedAt: string | null;

  // Developer pointers
  pointers: DocPointer[];

  // Code branches + project summary (.malvy/docs/project_summary.json)
  branches: CodeBranch[];
  branchesLoading: boolean;
  projectSummary: ProjectSummary | null;

  // Docs optimizer
  optimizerRunning: boolean;
  optimizerStream: string;
  optimizerError: string | null;
  proposals: DocProposal[] | null;
  /** Live per-branch status of the current/last run, keyed by branch path */
  branchProgress: Record<string, BranchProgressEvent>;

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
  setDocs: (docs: ClaudeDocFile[], lastOptimizedAt: string | null) => void;
  setDocsLoading: (loading: boolean) => void;
  setPointers: (pointers: DocPointer[]) => void;
  setBranches: (branches: CodeBranch[]) => void;
  setBranchesLoading: (loading: boolean) => void;
  setProjectSummary: (summary: ProjectSummary | null) => void;
  setBranchProgress: (progress: BranchProgressEvent) => void;
  setOptimizerResult: (result: DocsOptimizerResult) => void;
  setOptimizerRunning: (running: boolean) => void;
  appendOptimizerStream: (chunk: string) => void;
  setOptimizerError: (error: string | null) => void;
  setProposals: (proposals: DocProposal[] | null) => void;
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

  // Docs tree
  docs: [],
  docsLoading: false,
  lastOptimizedAt: null,

  // Developer pointers
  pointers: [],

  // Code branches + project summary
  branches: [],
  branchesLoading: false,
  projectSummary: null,

  // Docs optimizer
  optimizerRunning: false,
  optimizerStream: '',
  optimizerError: null,
  proposals: null,
  branchProgress: {},

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
  setDocs: (docs, lastOptimizedAt) => set({ docs, lastOptimizedAt }),
  setDocsLoading: (loading) => set({ docsLoading: loading }),
  setPointers: (pointers) => set({ pointers }),
  setBranches: (branches) => set({ branches }),
  setBranchesLoading: (loading) => set({ branchesLoading: loading }),
  setProjectSummary: (summary) => set({ projectSummary: summary }),
  setBranchProgress: (progress) =>
    set((state) => ({ branchProgress: { ...state.branchProgress, [progress.branch]: progress } })),
  setOptimizerResult: (result) =>
    set({ proposals: result.proposals, optimizerRunning: false }),
  setOptimizerRunning: (running) => set({ optimizerRunning: running }),
  appendOptimizerStream: (chunk) =>
    set((state) => ({ optimizerStream: state.optimizerStream + chunk })),
  setOptimizerError: (error) => set({ optimizerError: error }),
  setProposals: (proposals) => set({ proposals }),
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
      docs: [],
      docsLoading: false,
      lastOptimizedAt: null,
      pointers: [],
      branches: [],
      branchesLoading: false,
      projectSummary: null,
      optimizerRunning: false,
      optimizerStream: '',
      optimizerError: null,
      proposals: null,
      branchProgress: {}
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

// ============================================================
// Docs tree
// ============================================================

/**
 * Load the CLAUDE.md docs tree (both layers) and last optimization time
 */
export async function loadDocs(projectId: string): Promise<void> {
  const store = useContextStore.getState();
  store.setDocsLoading(true);
  try {
    const result = await window.electronAPI.listClaudeDocs(projectId);
    if (result.success && result.data) {
      store.setDocs(result.data.docs, result.data.lastOptimizedAt);
    } else {
      store.setDocs([], null);
    }
  } catch {
    store.setDocs([], null);
  } finally {
    store.setDocsLoading(false);
  }
}

/**
 * Load code branches with their documentation status
 */
export async function loadBranches(projectId: string): Promise<void> {
  const store = useContextStore.getState();
  store.setBranchesLoading(true);
  try {
    const result = await window.electronAPI.listCodeBranches(projectId);
    store.setBranches(result.success && result.data ? result.data : []);
  } catch {
    store.setBranches([]);
  } finally {
    store.setBranchesLoading(false);
  }
}

/**
 * Restore the last optimizer outcome after a tab switch or restart: proposals still
 * waiting for review, the error of a failed run, or that a run is in progress.
 */
export async function loadPendingDocsRun(projectId: string): Promise<void> {
  try {
    const result = await window.electronAPI.getPendingDocsRun(projectId);
    if (!result.success || !result.data) return;
    const store = useContextStore.getState();
    const { pending, isRunning } = result.data;
    store.setOptimizerRunning(isRunning);
    if (isRunning) return;
    if (pending?.error) {
      store.setOptimizerError(pending.error);
    } else if (pending && pending.proposals.length > 0) {
      store.setProposals(pending.proposals);
    }
  } catch {
    // Nothing to restore
  }
}

/** Close the review: unapplied proposals are dropped for good */
export async function discardPendingDocsRun(projectId: string): Promise<void> {
  useContextStore.getState().setProposals(null);
  try {
    await window.electronAPI.discardPendingDocsRun(projectId);
  } catch {
    // The file is overwritten by the next run anyway
  }
}

/**
 * Load `.malvy/docs/project_summary.json`
 */
export async function loadProjectSummary(projectId: string): Promise<void> {
  try {
    const result = await window.electronAPI.getProjectSummary(projectId);
    useContextStore.getState().setProjectSummary(result.success && result.data ? result.data : null);
  } catch {
    useContextStore.getState().setProjectSummary(null);
  }
}

// ============================================================
// Developer pointers
// ============================================================

/**
 * Load developer pointers (user_taught memories)
 */
export async function loadPointers(projectId: string): Promise<void> {
  try {
    const result = await window.electronAPI.listPointers(projectId);
    useContextStore.getState().setPointers(result.success && result.data ? result.data : []);
  } catch {
    useContextStore.getState().setPointers([]);
  }
}

export async function createPointer(projectId: string, input: CreatePointerInput): Promise<boolean> {
  try {
    const result = await window.electronAPI.createPointer(projectId, input);
    if (result.success) await loadPointers(projectId);
    return result.success;
  } catch {
    return false;
  }
}

export async function updatePointer(projectId: string, memoryId: string, content: string): Promise<boolean> {
  try {
    const result = await window.electronAPI.updatePointer(projectId, memoryId, content);
    if (result.success) await loadPointers(projectId);
    return result.success;
  } catch {
    return false;
  }
}

export async function deletePointer(projectId: string, memoryId: string): Promise<boolean> {
  try {
    const result = await window.electronAPI.deletePointer(projectId, memoryId);
    if (result.success) {
      const store = useContextStore.getState();
      store.setPointers(store.pointers.filter((p) => p.id !== memoryId));
      store.setRecentMemories(store.recentMemories.filter((m) => m.id !== memoryId));
    }
    return result.success;
  } catch {
    return false;
  }
}

// ============================================================
// Docs optimizer
// ============================================================

/**
 * Start the orchestrated docs optimizer (all branches + root by default, or
 * only `options.branches`); results arrive via onDocsOptimizer* listeners
 */
export function startDocsOptimizer(projectId: string, options?: DocsOptimizeOptions): void {
  useContextStore.setState({
    optimizerRunning: true,
    optimizerStream: '',
    optimizerError: null,
    proposals: null,
    branchProgress: {}
  });
  window.electronAPI.optimizeClaudeDocs(projectId, options);
}

export function stopDocsOptimizer(projectId: string): void {
  window.electronAPI.stopClaudeDocsOptimizer(projectId);
  useContextStore.getState().setOptimizerRunning(false);
}

/**
 * Apply approved proposals, drop them from the review list and reload docs + pointers
 */
export async function applyProposals(
  projectId: string,
  approved: DocProposal[]
): Promise<ApplyDocProposalsResult | null> {
  try {
    const result = await window.electronAPI.applyDocProposals(projectId, approved);
    if (!result.success || !result.data) return null;
    const appliedPaths = new Set(result.data.applied);
    const store = useContextStore.getState();
    const remaining = (store.proposals ?? []).filter((p) => !appliedPaths.has(p.path));
    store.setProposals(remaining.length > 0 ? remaining : null);
    await Promise.all([
      loadDocs(projectId),
      loadPointers(projectId),
      loadBranches(projectId),
      loadProjectSummary(projectId)
    ]);
    return result.data;
  } catch {
    return null;
  }
}

/**
 * Drop a proposal from the review list without applying it
 */
export function rejectProposal(path: string): void {
  const store = useContextStore.getState();
  const remaining = (store.proposals ?? []).filter((p) => p.path !== path);
  store.setProposals(remaining.length > 0 ? remaining : null);
}
