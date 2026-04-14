import { IPC_CHANNELS } from '../../../shared/constants';
import type {
  TestSolution,
  TestConfig,
  TestResult,
  TestRunStatus,
} from '../../../shared/types/tests';
import type { IPCResult } from '../../../shared/types';
import { createIpcListener, invokeIpc, type IpcListenerCleanup } from './ipc-utils';

/**
 * Tests API — exposes all test-related IPC operations to the renderer.
 */
export interface TestsAPI {
  // Load persisted solution (no re-discovery)
  loadTestSolution: (projectId: string) => Promise<IPCResult<TestSolution | null>>;

  // Discovery
  discoverTests: (projectId: string) => Promise<IPCResult<TestSolution>>;

  // Run operations
  runTests: (projectId: string) => Promise<IPCResult>;
  runTestsByCategory: (projectId: string, category: string) => Promise<IPCResult>;
  runSingleTest: (
    projectId: string,
    testId: string,
    testProjectId: string,
  ) => Promise<IPCResult>;

  // Stop
  stopTests: (projectId: string, testProjectId: string) => Promise<IPCResult>;

  // Config
  getTestConfig: (projectId: string) => Promise<IPCResult<TestConfig>>;

  // Event listeners
  onTestRunStatus: (
    callback: (projectId: string, status: TestRunStatus) => void,
  ) => IpcListenerCleanup;
  onTestResult: (
    callback: (projectId: string, testProjectId: string, result: TestResult) => void,
  ) => IpcListenerCleanup;
  onTestsComplete: (
    callback: (projectId: string, solution: TestSolution) => void,
  ) => IpcListenerCleanup;
  onTestsError: (
    callback: (projectId: string, error: string) => void,
  ) => IpcListenerCleanup;
  onTestsStopped: (
    callback: (projectId: string, testProjectId: string) => void,
  ) => IpcListenerCleanup;
}

/**
 * Creates the TestsAPI implementation.
 */
export const createTestsAPI = (): TestsAPI => ({
  loadTestSolution: (projectId: string): Promise<IPCResult<TestSolution | null>> =>
    invokeIpc(IPC_CHANNELS.TESTS_LOAD_SOLUTION, projectId),

  discoverTests: (projectId: string): Promise<IPCResult<TestSolution>> =>
    invokeIpc(IPC_CHANNELS.TESTS_DISCOVER, projectId),

  runTests: (projectId: string): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.TESTS_RUN, projectId),

  runTestsByCategory: (projectId: string, category: string): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.TESTS_RUN_CATEGORY, projectId, category),

  runSingleTest: (
    projectId: string,
    testId: string,
    testProjectId: string,
  ): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.TESTS_RUN_SINGLE, projectId, testId, testProjectId),

  stopTests: (projectId: string, testProjectId: string): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.TESTS_STOP, projectId, testProjectId),

  getTestConfig: (projectId: string): Promise<IPCResult<TestConfig>> =>
    invokeIpc(IPC_CHANNELS.TESTS_GET_CONFIG, projectId),

  onTestRunStatus: (
    callback: (projectId: string, status: TestRunStatus) => void,
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.TESTS_RUN_STATUS, callback),

  onTestResult: (
    callback: (projectId: string, testProjectId: string, result: TestResult) => void,
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.TESTS_RESULT, callback),

  onTestsComplete: (
    callback: (projectId: string, solution: TestSolution) => void,
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.TESTS_COMPLETE, callback),

  onTestsError: (
    callback: (projectId: string, error: string) => void,
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.TESTS_ERROR, callback),

  onTestsStopped: (
    callback: (projectId: string, testProjectId: string) => void,
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.TESTS_STOPPED, callback),
});
