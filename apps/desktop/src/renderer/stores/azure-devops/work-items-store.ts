/**
 * Azure DevOps Work Items Store
 *
 * Manages Azure DevOps work item state with filtering.
 * Mirrors the structure of github/issues-store.ts.
 */
import { create } from 'zustand';

export interface AzureDevOpsWorkItem {
  id: number;
  title: string;
  description?: string;
  state: string;
  workItemType: string;
  assignedTo?: string;
  createdDate: string;
  changedDate: string;
  tags: string[];
  areaPath: string;
  iterationPath: string;
  webUrl: string;
}

export type WorkItemFilterState = 'active' | 'closed' | 'all';

interface WorkItemsState {
  // Data
  workItems: AzureDevOpsWorkItem[];

  // UI State
  isLoading: boolean;
  error: string | null;
  selectedWorkItemId: number | null;
  filterState: WorkItemFilterState;
  currentRequestToken: string | null;

  // Actions
  setWorkItems: (workItems: AzureDevOpsWorkItem[]) => void;
  addWorkItem: (workItem: AzureDevOpsWorkItem) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  selectWorkItem: (workItemId: number | null) => void;
  setFilterState: (state: WorkItemFilterState) => void;
  clearWorkItems: () => void;
  setCurrentRequestToken: (token: string | null) => void;

  // Selectors
  getSelectedWorkItem: () => AzureDevOpsWorkItem | null;
  getFilteredWorkItems: () => AzureDevOpsWorkItem[];
  getActiveWorkItemCount: () => number;
}

export const useWorkItemsStore = create<WorkItemsState>((set, get) => ({
  // Initial state
  workItems: [],
  isLoading: false,
  error: null,
  selectedWorkItemId: null,
  filterState: 'active',
  currentRequestToken: null,

  // Actions
  setWorkItems: (workItems) => set({ workItems, error: null }),

  addWorkItem: (workItem) => set((state) => ({
    workItems: [workItem, ...state.workItems.filter(w => w.id !== workItem.id)]
  })),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  selectWorkItem: (selectedWorkItemId) => set({ selectedWorkItemId }),

  setFilterState: (filterState) => set({ filterState }),

  clearWorkItems: () => set({
    workItems: [],
    selectedWorkItemId: null,
    error: null,
    currentRequestToken: null,
    isLoading: false
  }),

  setCurrentRequestToken: (currentRequestToken) => set({ currentRequestToken }),

  // Selectors
  getSelectedWorkItem: () => {
    const { workItems, selectedWorkItemId } = get();
    return workItems.find(w => w.id === selectedWorkItemId) ?? null;
  },

  getFilteredWorkItems: () => {
    const { workItems, filterState } = get();
    if (filterState === 'all') return workItems;
    return workItems.filter(item => {
      const stateLower = item.state.toLowerCase();
      if (filterState === 'active') {
        // Active states: Active, New, In Progress, Approved, Committed, Doing, Open
        return !['done', 'closed', 'resolved', 'removed', 'completed'].includes(stateLower);
      }
      // closed: Done, Closed, Resolved, Removed, Completed
      return ['done', 'closed', 'resolved', 'removed', 'completed'].includes(stateLower);
    });
  },

  getActiveWorkItemCount: () => {
    const { workItems } = get();
    return workItems.filter(item => {
      const stateLower = item.state.toLowerCase();
      return !['done', 'closed', 'resolved', 'removed', 'completed'].includes(stateLower);
    }).length;
  }
}));

/**
 * Load Azure DevOps work items for a project.
 */
export async function loadAzureDevOpsWorkItems(
  projectId: string,
  state?: WorkItemFilterState
): Promise<void> {
  const requestId = Math.random().toString(36);
  const store = useWorkItemsStore.getState();
  store.setCurrentRequestToken(requestId);
  store.setLoading(true);
  store.setError(null);

  if (state) {
    store.setFilterState(state);
  }

  try {
    const result = await window.electronAPI.getAzureDevOpsWorkItems(projectId, state);

    // Guard against stale responses
    if (useWorkItemsStore.getState().currentRequestToken !== requestId) {
      return;
    }

    if (result.success && result.data) {
      store.setWorkItems(result.data);
    } else {
      store.setError(result.error ?? 'Failed to load Azure DevOps work items');
    }
  } catch (error) {
    if (useWorkItemsStore.getState().currentRequestToken !== requestId) {
      return;
    }
    store.setError(error instanceof Error ? error.message : 'Unknown error');
  } finally {
    if (useWorkItemsStore.getState().currentRequestToken === requestId) {
      store.setLoading(false);
    }
  }
}

/**
 * Import Azure DevOps work items as tasks.
 */
export async function importAzureDevOpsWorkItems(
  projectId: string,
  workItemIds: number[]
): Promise<boolean> {
  const store = useWorkItemsStore.getState();
  store.setLoading(true);
  store.setError(null);

  try {
    const result = await window.electronAPI.importAzureDevOpsWorkItems(projectId, workItemIds);
    if (result.success) {
      store.setError(null);
      return true;
    }
    store.setError(result.error ?? 'Failed to import Azure DevOps work items');
    return false;
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
    return false;
  } finally {
    store.setLoading(false);
  }
}
