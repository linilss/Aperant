import { useEffect } from 'react';
import { create } from 'zustand';
import type { FunnelProgress, ProjectActivity } from '../../shared/types';

/** Plan-funnel progress per project id (project tab bars, sidebar checks, mobile drawer) */
interface FunnelState {
  byProject: Record<string, FunnelProgress>;
  /** Running / needs-you counts per project (tab and project-list badges) */
  activity: Record<string, ProjectActivity>;
}

export const useFunnelStore = create<FunnelState>(() => ({ byProject: {}, activity: {} }));

/** Activity changes with every task move, so it polls faster than the funnel */
const ACTIVITY_POLL_MS = 10_000;

export async function loadProjectActivity(projectIds: string[]): Promise<void> {
  if (projectIds.length === 0) return;
  try {
    const result = await window.electronAPI.getProjectActivity(projectIds);
    if (!result.success || !result.data) return;
    const data = result.data;
    useFunnelStore.setState((state) => ({ activity: { ...state.activity, ...data } }));
  } catch {
    // Keep the last known counts
  }
}

export function useProjectActivity(projectId: string | null | undefined): ProjectActivity | undefined {
  return useFunnelStore((s) => (projectId ? s.activity[projectId] : undefined));
}

/** Poll interval while the window is visible (events cover most changes; this is the safety net) */
const FUNNEL_POLL_MS = 30_000;

export async function loadFunnelProgress(projectIds: string[]): Promise<void> {
  if (projectIds.length === 0) return;
  try {
    const result = await window.electronAPI.getFunnelProgress(projectIds);
    if (!result.success || !result.data) return;
    const data = result.data;
    useFunnelStore.setState((state) => ({ byProject: { ...state.byProject, ...data } }));
  } catch {
    // Keep the last known progress
  }
}

export function useFunnelProgress(projectId: string | null | undefined): FunnelProgress | undefined {
  return useFunnelStore((s) => (projectId ? s.byProject[projectId] : undefined));
}

/**
 * Keeps funnel progress fresh for the given projects: on mount / when the set
 * changes, when the active project changes, when the window regains focus or
 * becomes visible, when main reports a funnel step changed, and every 30s while visible.
 */
export function useFunnelProgressSync(projectIds: string[], activeProjectId?: string | null): void {
  const key = projectIds.join('\n');

  useEffect(() => {
    if (activeProjectId) void loadFunnelProgress([activeProjectId]);
  }, [activeProjectId]);

  useEffect(() => {
    const ids = key ? key.split('\n') : [];
    if (ids.length === 0) return;
    const refresh = () => {
      void loadFunnelProgress(ids);
    };
    refresh();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, FUNNEL_POLL_MS);
    const unsubscribe = window.electronAPI.onFunnelChanged?.((projectId) => {
      if (ids.includes(projectId)) void loadFunnelProgress([projectId]);
    });

    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(timer);
      unsubscribe?.();
    };
  }, [key]);

  // Activity: poll while visible and refresh a project as soon as one of its tasks moves
  // (not on focus: switching back to the app already refreshes the funnel)
  useEffect(() => {
    const ids = key ? key.split('\n') : [];
    if (ids.length === 0) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') void loadProjectActivity(ids);
    };
    refresh();
    const timer = window.setInterval(refresh, ACTIVITY_POLL_MS);
    const unsubscribe = window.electronAPI.onTaskStatusChange?.((_taskId, _status, projectId) => {
      if (projectId && ids.includes(projectId)) void loadProjectActivity([projectId]);
    });
    return () => {
      window.clearInterval(timer);
      unsubscribe?.();
    };
  }, [key]);
}
