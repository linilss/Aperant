import { create } from 'zustand';
import type {
  TestProject,
  TestCategory,
  TestRunStatus,
  TestResult,
  TestSolution,
} from '../../shared/types/tests';

interface TestsState {
  // Data
  projects: TestProject[];
  selectedProjectId: string | null;
  selectedCategory: TestCategory | 'all';
  isRunning: boolean;
  isLoading: boolean;
  error: string | null;
  runningTestId: string | null;

  // Actions
  setProjects: (projects: TestProject[]) => void;
  setSelectedProjectId: (id: string | null) => void;
  setSelectedCategory: (cat: TestCategory | 'all') => void;
  setIsRunning: (running: boolean) => void;
  setIsLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setRunningTestId: (testId: string | null) => void;
  updateTestResult: (testProjectId: string, result: TestResult) => void;
  updateProjectRunning: (testProjectId: string, running: boolean) => void;
}

export const useTestsStore = create<TestsState>((set) => ({
  // Initial state
  projects: [],
  selectedProjectId: null,
  selectedCategory: 'all',
  isRunning: false,
  isLoading: false,
  error: null,
  runningTestId: null,

  // Actions
  setProjects: (projects) => set({ projects }),
  setSelectedProjectId: (id) => set({ selectedProjectId: id }),
  setSelectedCategory: (cat) => set({ selectedCategory: cat }),
  setIsRunning: (running) => set({ isRunning: running }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  setRunningTestId: (testId) => set({ runningTestId: testId }),

  updateTestResult: (testProjectId, result) =>
    set((state) => ({
      projects: state.projects.map((proj) => {
        if (proj.id !== testProjectId) return proj;
        const existing = proj.tests.findIndex((t) => t.id === result.id);
        const tests =
          existing >= 0
            ? proj.tests.map((t) => (t.id === result.id ? result : t))
            : [...proj.tests, result];
        return { ...proj, tests };
      }),
    })),

  updateProjectRunning: (testProjectId, running) =>
    set((state) => ({
      projects: state.projects.map((proj) =>
        proj.id === testProjectId ? { ...proj, isRunning: running } : proj,
      ),
    })),
}));

// ---- High-level action helpers (called from components) ----

/**
 * Load the persisted solution from disk (called on view mount).
 * Does NOT re-discover — preserves previous run results.
 */
export async function loadSavedSolution(projectId: string): Promise<void> {
  const store = useTestsStore.getState();
  store.setIsLoading(true);
  store.setError(null);
  try {
    const result = await window.electronAPI.loadTestSolution(projectId);
    if (result.success && result.data && result.data.testProjects.length > 0) {
      store.setProjects(result.data.testProjects);
      if (!store.selectedProjectId && result.data.testProjects.length > 0) {
        store.setSelectedProjectId(result.data.testProjects[0].id);
      }
    }
    // If no saved solution, leave projects empty — user will click Discover
  } catch {
    // No saved solution yet — silently ignore
  } finally {
    store.setIsLoading(false);
  }
}

/**
 * Run discovery and overwrite the saved solution (called by Discover button).
 */
export async function discoverProjects(projectId: string): Promise<void> {
  const store = useTestsStore.getState();
  store.setIsLoading(true);
  store.setError(null);
  try {
    const result = await window.electronAPI.discoverTests(projectId);
    if (result.success && result.data) {
      store.setProjects(result.data.testProjects);
      if (!store.selectedProjectId && result.data.testProjects.length > 0) {
        store.setSelectedProjectId(result.data.testProjects[0].id);
      }
    } else {
      store.setProjects([]);
    }
  } catch {
    store.setError('errors.discoveryFailed');
    store.setProjects([]);
  } finally {
    store.setIsLoading(false);
  }
}

export async function runTests(projectId: string, category?: string): Promise<void> {
  const store = useTestsStore.getState();
  store.setIsRunning(true);
  store.setError(null);
  try {
    const result = category
      ? await window.electronAPI.runTestsByCategory(projectId, category)
      : await window.electronAPI.runTests(projectId);
    if (!result.success) {
      store.setError('errors.runFailed');
    }
  } catch {
    store.setError('errors.runFailed');
    store.setIsRunning(false);
  }
}

export async function stopTests(projectId: string, testProjectId: string): Promise<void> {
  const store = useTestsStore.getState();
  try {
    await window.electronAPI.stopTests(projectId, testProjectId);
  } finally {
    store.setIsRunning(false);
  }
}

export async function refreshResults(projectId: string): Promise<void> {
  await loadSavedSolution(projectId);
}

// ---- IPC listener setup — call once when the Tests view mounts ----

export function setupTestsListeners(projectId: string): () => void {
  const store = useTestsStore.getState;

  const unsubStatus = window.electronAPI.onTestRunStatus(
    (_pid: string, status: TestRunStatus) => {
      if (_pid !== projectId) return;
      switch (status.phase) {
        case 'discovering':
          store().setIsLoading(true);
          store().setError(null);
          break;
        case 'running':
          store().setIsRunning(true);
          store().setError(null);
          if (status.testProjectId) {
            store().updateProjectRunning(status.testProjectId, true);
          }
          if (status.testId) {
            store().setRunningTestId(status.testId);
          }
          break;
        case 'complete':
          if (status.testProjectId) {
            // Per-project completion — clear its running spinner only
            store().updateProjectRunning(status.testProjectId, false);
          } else {
            // Global completion — the full run is done
            store().setIsRunning(false);
            store().setIsLoading(false);
            store().setRunningTestId(null);
          }
          break;
        case 'error':
          // Per-project errors (have testProjectId) don't stop the global run —
          // other projects may still be running in parallel.
          if (!status.testProjectId) {
            store().setIsRunning(false);
            store().setIsLoading(false);
          }
          if (status.testProjectId) {
            store().updateProjectRunning(status.testProjectId, false);
          }
          store().setRunningTestId(null);
          store().setError(status.error ?? 'errors.runFailed');
          break;
        case 'idle':
          store().setIsRunning(false);
          store().setRunningTestId(null);
          break;
      }
    },
  );

  const unsubResult = window.electronAPI.onTestResult(
    (_pid: string, testProjectId: string, result: TestResult) => {
      if (_pid !== projectId) return;
      store().updateTestResult(testProjectId, result);
      store().setRunningTestId(null);
    },
  );

  const unsubComplete = window.electronAPI.onTestsComplete(
    (_pid: string, solution: TestSolution) => {
      if (_pid !== projectId) return;
      store().setProjects(solution.testProjects);
      store().setIsRunning(false);
      store().setIsLoading(false);
      store().setRunningTestId(null);
    },
  );

  const unsubError = window.electronAPI.onTestsError(
    (_pid: string, error: string) => {
      if (_pid !== projectId) return;
      store().setError(error);
      store().setIsRunning(false);
      store().setIsLoading(false);
      store().setRunningTestId(null);
    },
  );

  const unsubStopped = window.electronAPI.onTestsStopped(
    (_pid: string, testProjectId: string) => {
      if (_pid !== projectId) return;
      store().updateProjectRunning(testProjectId, false);
      store().setIsRunning(false);
      store().setRunningTestId(null);
    },
  );

  return () => {
    unsubStatus();
    unsubResult();
    unsubComplete();
    unsubError();
    unsubStopped();
  };
}
