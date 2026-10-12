import { useEffect } from 'react';
import { create } from 'zustand';
import type { FunnelProgress } from '../../shared/types';

/** Plan-funnel progress per project id (project tab bars, sidebar checks, mobile drawer) */
interface FunnelState {
  byProject: Record<string, FunnelProgress>;
}

export const useFunnelStore = create<FunnelState>(() => ({ byProject: {} }));

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
}
