export type TestStatus = 'unknown' | 'running' | 'passed' | 'failed' | 'skipped';
export type TestCategory = string;

export interface TestResult {
  id: string;
  name: string;
  fullName: string;
  category: TestCategory;
  status: TestStatus;
  durationMs?: number;
  errorMessage?: string;
  stackTrace?: string;
}

export interface TestProject {
  id: string;
  name: string;
  path: string;
  type: 'dotnet' | 'node';
  tests: TestResult[];
  lastRunAt?: string;
  isRunning: boolean;
}

export interface TestSolution {
  projectId: string;
  testProjects: TestProject[];
  lastDiscoveredAt?: string;
}

export interface TestRunStatus {
  phase: 'idle' | 'discovering' | 'running' | 'complete' | 'error';
  message: string;
  error?: string;
  testProjectId?: string;
  testId?: string;
}
