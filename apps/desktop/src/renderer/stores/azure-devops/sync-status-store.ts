/**
 * Azure DevOps Sync Status Store
 *
 * Tracks Azure DevOps connection status for a project.
 * Mirrors github/sync-status-store.ts.
 */
import { create } from 'zustand';

export interface AzureDevOpsSyncStatus {
  connected: boolean;
  orgUrl?: string;
  projectName?: string;
  workItemCount?: number;
  lastSyncedAt?: string;
  error?: string;
}

interface SyncStatusState {
  // Sync status
  syncStatus: AzureDevOpsSyncStatus | null;
  connectionError: string | null;

  // Actions
  setSyncStatus: (status: AzureDevOpsSyncStatus | null) => void;
  setConnectionError: (error: string | null) => void;
  clearSyncStatus: () => void;

  // Selectors
  isConnected: () => boolean;
}

export const useSyncStatusStore = create<SyncStatusState>((set, get) => ({
  // Initial state
  syncStatus: null,
  connectionError: null,

  // Actions
  setSyncStatus: (syncStatus) => set({ syncStatus, connectionError: null }),

  setConnectionError: (connectionError) => set({ connectionError }),

  clearSyncStatus: () => set({
    syncStatus: null,
    connectionError: null
  }),

  // Selectors
  isConnected: () => {
    const { syncStatus } = get();
    return syncStatus?.connected ?? false;
  }
}));

/**
 * Check Azure DevOps connection status.
 */
let latestConnectionRequestId = 0;

export async function checkAzureDevOpsConnection(
  projectId: string
): Promise<AzureDevOpsSyncStatus | null> {
  const store = useSyncStatusStore.getState();
  const requestId = ++latestConnectionRequestId;

  try {
    const result = await window.electronAPI.checkAzureDevOpsConnection(projectId);

    // Ignore stale responses
    if (requestId !== latestConnectionRequestId) return null;

    if (result.success && result.data && result.data.connected === true) {
      store.setSyncStatus(result.data);
      return result.data;
    } else if (result.success && result.data && result.data.connected === false) {
      store.clearSyncStatus();
      store.setConnectionError(result.data.error ?? 'Failed to check Azure DevOps connection');
      return null;
    } else {
      store.clearSyncStatus();
      store.setConnectionError(result.error ?? 'Failed to check Azure DevOps connection');
      return null;
    }
  } catch (error) {
    if (requestId !== latestConnectionRequestId) return null;
    store.clearSyncStatus();
    store.setConnectionError(error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
}
