import { create } from 'zustand';
import type { CoreValues } from '../../shared/types';

/** The open project's core values (`.malvy/core-values.md`), shared by Context and Competitors */
interface CoreValuesState {
  projectId: string | null;
  values: CoreValues | null;
  loading: boolean;
}

export const useCoreValuesStore = create<CoreValuesState>(() => ({
  projectId: null,
  values: null,
  loading: false,
}));

/** Values for `projectId`, or null while another project's (or nothing) is loaded */
export function selectCoreValues(state: CoreValuesState, projectId: string): CoreValues | null {
  return state.projectId === projectId ? state.values : null;
}

export async function loadCoreValues(projectId: string): Promise<void> {
  const keep = useCoreValuesStore.getState().projectId === projectId;
  useCoreValuesStore.setState({ projectId, loading: true, ...(keep ? {} : { values: null }) });
  try {
    const result = await window.electronAPI.getCoreValues(projectId);
    if (useCoreValuesStore.getState().projectId !== projectId) return;
    useCoreValuesStore.setState({
      values: result.success && result.data ? result.data : { text: '', updatedAt: null },
      loading: false,
    });
  } catch {
    if (useCoreValuesStore.getState().projectId === projectId) {
      useCoreValuesStore.setState({ values: { text: '', updatedAt: null }, loading: false });
    }
  }
}

/** Save; `error` is set on failure */
export async function saveCoreValues(
  projectId: string,
  text: string,
): Promise<{ error?: string; directionsMarkedStale?: boolean }> {
  try {
    const result = await window.electronAPI.saveCoreValues(projectId, text);
    if (!result.success || !result.data) return { error: result.error ?? 'Save failed' };
    if (useCoreValuesStore.getState().projectId === projectId) {
      useCoreValuesStore.setState({ values: result.data.values });
    }
    return { directionsMarkedStale: result.data.directionsMarkedStale };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** AI first draft (not saved) */
export async function draftCoreValues(projectId: string): Promise<{ text?: string; error?: string }> {
  try {
    const result = await window.electronAPI.draftCoreValues(projectId);
    return result.success && result.data ? { text: result.data } : { error: result.error ?? 'Draft failed' };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
