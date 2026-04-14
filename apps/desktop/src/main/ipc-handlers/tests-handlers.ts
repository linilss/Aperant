import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { TestResult, TestRunStatus } from '../../shared/types/tests';
import { projectStore } from '../project-store';
import { safeSendToRenderer } from './utils';
import {
  discoverTestProjects,
  runTests,
  stopTests,
  getTestConfig,
  saveSolution,
  loadSolution,
} from './tests';

/**
 * Register all test-related IPC handlers.
 */
export function registerTestsHandlers(getMainWindow: () => BrowserWindow | null): void {
  // ──────────────────────────────────────────────────────────────
  // TESTS_LOAD_SOLUTION  (load persisted solution without re-discovering)
  // ──────────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.TESTS_LOAD_SOLUTION, async (_event, projectId: string) => {
    const project = projectStore.getProject(projectId);
    if (!project) {
      return { success: false, error: 'Project not found' };
    }
    try {
      const solution = await loadSolution(project.path);
      return { success: true, data: solution ?? null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });

  // ──────────────────────────────────────────────────────────────
  // TESTS_DISCOVER
  // ──────────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.TESTS_DISCOVER, async (_event, projectId: string) => {
    const project = projectStore.getProject(projectId);
    if (!project) {
      return { success: false, error: 'Project not found' };
    }

    try {
      const testProjects = await discoverTestProjects(project.path);
      const solution = {
        projectId,
        testProjects,
        lastDiscoveredAt: new Date().toISOString(),
      };
      await saveSolution(project.path, solution);
      return { success: true, data: solution };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });

  // ──────────────────────────────────────────────────────────────
  // TESTS_RUN  (runs all test projects)
  // ──────────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.TESTS_RUN, async (_event, projectId: string) => {
    return runTestsImpl(projectId, {}, getMainWindow);
  });

  // ──────────────────────────────────────────────────────────────
  // TESTS_RUN_CATEGORY
  // ──────────────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.TESTS_RUN_CATEGORY,
    async (_event, projectId: string, category: string) => {
      return runTestsImpl(projectId, { category }, getMainWindow);
    },
  );

  // ──────────────────────────────────────────────────────────────
  // TESTS_RUN_SINGLE
  // ──────────────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.TESTS_RUN_SINGLE,
    async (_event, projectId: string, testId: string, testProjectId: string) => {
      return runTestsImpl(projectId, { testId, testProjectId }, getMainWindow);
    },
  );

  // ──────────────────────────────────────────────────────────────
  // TESTS_STOP
  // ──────────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.TESTS_STOP, (_event, _projectId: string, testProjectId: string) => {
    stopTests(testProjectId);
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.TESTS_STOPPED, _projectId, testProjectId);
    return { success: true };
  });

  // ──────────────────────────────────────────────────────────────
  // TESTS_GET_CONFIG
  // ──────────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.TESTS_GET_CONFIG, async (_event, projectId: string) => {
    const project = projectStore.getProject(projectId);
    if (!project) {
      return { success: false, error: 'Project not found' };
    }

    try {
      const config = await getTestConfig(project.path);
      return { success: true, data: config };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });
}

// ──────────────────────────────────────────────────────────────
// Shared run helper
// ──────────────────────────────────────────────────────────────

async function runTestsImpl(
  projectId: string,
  options: { category?: string; testId?: string; testProjectId?: string },
  getMainWindow: () => BrowserWindow | null,
): Promise<{ success: boolean; error?: string }> {
  const project = projectStore.getProject(projectId);
  if (!project) {
    return { success: false, error: 'Project not found' };
  }

  // Load persisted solution to get known test projects
  const solution = await loadSolution(project.path);
  if (!solution || solution.testProjects.length === 0) {
    return { success: false, error: 'No test projects found. Run discovery first.' };
  }

  const onResult = (testProjectId: string, result: TestResult): void => {
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.TESTS_RESULT, projectId, testProjectId, result);
  };

  const onStatus = (status: TestRunStatus): void => {
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.TESTS_RUN_STATUS, projectId, status);
  };

  try {
    const updatedProjects = await runTests(
      project.path,
      solution.testProjects,
      options,
      onResult,
      onStatus,
    );

    // Persist updated solution
    const updatedSolution = {
      ...solution,
      testProjects: updatedProjects,
    };
    await saveSolution(project.path, updatedSolution);

    safeSendToRenderer(getMainWindow, IPC_CHANNELS.TESTS_COMPLETE, projectId, updatedSolution);
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.TESTS_ERROR, projectId, message);
    return { success: false, error: message };
  }
}
