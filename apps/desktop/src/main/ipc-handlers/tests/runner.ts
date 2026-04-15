import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { TestProject, TestResult, TestRunStatus, TestStatus } from '../../../shared/types/tests';
import { parseTrxFile } from './trx-parser';

/** Module-level registry of running child processes, keyed by testProject.id */
const runningProcesses = new Map<string, ChildProcess>();

const TRX_LOG_FILE = 'malvy-results.trx';

/**
 * Stops a running test process for the given project ID, if one exists.
 */
export function stopTests(projectId: string): void {
  const proc = runningProcesses.get(projectId);
  if (proc) {
    proc.kill('SIGTERM');
    runningProcesses.delete(projectId);
  }
}

/**
 * Builds a stable synthetic TestResult.id from a full test name.
 * Uses the fullName directly as id for easy cross-referencing.
 */
function makeTestId(fullName: string): string {
  return fullName;
}

/**
 * Runs a single .NET test project via `dotnet test`, parses TRX output and
 * fires callbacks for each result.  Returns the updated TestProject.
 */
async function runDotnetProject(
  testProject: TestProject,
  options: { category?: string; testId?: string },
  onResult: (testProjectId: string, result: TestResult) => void,
  onStatus: (status: TestRunStatus) => void,
  abortSignal?: AbortSignal,
): Promise<TestProject> {
  const projectFile = testProject.path;
  const projectDir = path.dirname(projectFile);

  // Write TRX results to a temp directory inside malvy's own space
  // so the file never appears as an unversioned file in the user's project.
  const trxDir = path.join(os.tmpdir(), 'malvy-test-results', testProject.id);
  await fs.mkdir(trxDir, { recursive: true });

  const args: string[] = [
    'test',
    projectFile,
    `--logger`,
    `trx;LogFileName=${TRX_LOG_FILE}`,
    `--results-directory`,
    trxDir,
  ];

  if (options.category) {
    args.push('--filter', `Category=${options.category}`);
  } else if (options.testId) {
    args.push('--filter', `FullyQualifiedName=${options.testId}`);
  }

  onStatus({
    phase: 'running',
    message: `Running ${testProject.name}…`,
    testProjectId: testProject.id,
  });

  const updatedProject: TestProject = {
    ...testProject,
    isRunning: true,
    tests: [],
  };

  await new Promise<void>((resolve) => {
    const proc = spawn('dotnet', args, {
      cwd: projectDir,
      shell: false,
    });

    runningProcesses.set(testProject.id, proc);

    if (abortSignal) {
      const onAbort = (): void => {
        proc.kill('SIGTERM');
      };
      abortSignal.addEventListener('abort', onAbort, { once: true });
      proc.on('close', () => abortSignal.removeEventListener('abort', onAbort));
    }

    proc.on('close', () => {
      runningProcesses.delete(testProject.id);
      resolve();
    });

    proc.on('error', (err) => {
      onStatus({
        phase: 'error',
        message: `Failed to run ${testProject.name}`,
        error: err.message,
        testProjectId: testProject.id,
      });
      runningProcesses.delete(testProject.id);
      resolve();
    });
  });

  // Parse the TRX file produced by dotnet test
  const trxPath = path.join(trxDir, TRX_LOG_FILE);
  let trxContent: string;
  try {
    trxContent = await fs.readFile(trxPath, 'utf-8');
  } catch {
    onStatus({
      phase: 'error',
      message: `Could not read test results for ${testProject.name}`,
      error: `TRX file not found: ${trxPath}`,
      testProjectId: testProject.id,
    });
    return { ...updatedProject, isRunning: false };
  }

  const parsed = parseTrxFile(trxContent);
  const testResults: TestResult[] = parsed.map((record) => ({
    id: makeTestId(record.fullName),
    name: record.fullName.split('.').pop() ?? record.fullName,
    fullName: record.fullName,
    category: '',
    status: record.status,
    durationMs: record.durationMs,
    errorMessage: record.errorMessage,
    stackTrace: record.stackTrace,
  }));

  for (const result of testResults) {
    onResult(testProject.id, result);
  }

  const finalProject = {
    ...updatedProject,
    isRunning: false,
    tests: testResults,
    lastRunAt: new Date().toISOString(),
  };

  onStatus({
    phase: 'complete',
    message: `${testProject.name} complete`,
    testProjectId: testProject.id,
  });

  return finalProject;
}

/**
 * Runs a single Node.js test project via `npm test`.
 * Node projects do not produce structured output we can parse, so we emit a
 * single synthetic result reflecting pass/fail of the entire project run.
 */
async function runNodeProject(
  testProject: TestProject,
  _options: { category?: string; testId?: string },
  onResult: (testProjectId: string, result: TestResult) => void,
  onStatus: (status: TestRunStatus) => void,
  abortSignal?: AbortSignal,
): Promise<TestProject> {
  const projectDir = path.dirname(testProject.path);

  onStatus({
    phase: 'running',
    message: `Running ${testProject.name}…`,
    testProjectId: testProject.id,
  });

  let exitCode = 0;

  await new Promise<void>((resolve) => {
    const proc = spawn('npm', ['test', '--', '--ci'], {
      cwd: projectDir,
      shell: true,
    });

    runningProcesses.set(testProject.id, proc);

    if (abortSignal) {
      const onAbort = (): void => {
        proc.kill('SIGTERM');
      };
      abortSignal.addEventListener('abort', onAbort, { once: true });
      proc.on('close', () => abortSignal.removeEventListener('abort', onAbort));
    }

    proc.on('close', (code) => {
      exitCode = code ?? 1;
      runningProcesses.delete(testProject.id);
      resolve();
    });

    proc.on('error', (err) => {
      onStatus({
        phase: 'error',
        message: `Failed to run ${testProject.name}`,
        error: err.message,
        testProjectId: testProject.id,
      });
      runningProcesses.delete(testProject.id);
      exitCode = 1;
      resolve();
    });
  });

  const status: TestStatus = exitCode === 0 ? 'passed' : 'failed';
  const syntheticResult: TestResult = {
    id: `${testProject.id}:all`,
    name: testProject.name,
    fullName: testProject.name,
    category: '',
    status,
    errorMessage: exitCode !== 0 ? `Process exited with code ${exitCode}` : undefined,
  };

  onResult(testProject.id, syntheticResult);

  onStatus({
    phase: 'complete',
    message: `${testProject.name} complete`,
    testProjectId: testProject.id,
  });

  return {
    ...testProject,
    isRunning: false,
    tests: [syntheticResult],
    lastRunAt: new Date().toISOString(),
  };
}

/**
 * Runs one or more test projects, emitting per-test results via callbacks.
 *
 * When `options.testProjectId` is supplied only that project is run.
 * When `options.category` or `options.testId` are supplied they are forwarded
 * to the underlying test runner as filters.
 *
 * Returns the updated TestProject array.
 */
export async function runTests(
  _projectDir: string,
  testProjects: TestProject[],
  options: { category?: string; testId?: string; testProjectId?: string },
  onResult: (testProjectId: string, result: TestResult) => void,
  onStatus: (status: TestRunStatus) => void,
  abortSignal?: AbortSignal,
): Promise<TestProject[]> {
  const targets = options.testProjectId
    ? testProjects.filter((p) => p.id === options.testProjectId)
    : testProjects;

  if (targets.length === 0) {
    onStatus({ phase: 'complete', message: 'No test projects to run.' });
    return testProjects;
  }

  const updated = new Map(testProjects.map((p) => [p.id, p]));

  // Run all target projects in parallel so the user sees progress across all at once.
  const results = await Promise.allSettled(
    targets.map((project) => {
      if (abortSignal?.aborted) return Promise.resolve(project);
      const runner = project.type === 'dotnet' ? runDotnetProject : runNodeProject;
      return runner(project, options, onResult, onStatus, abortSignal);
    }),
  );

  for (let i = 0; i < targets.length; i++) {
    const settled = results[i];
    if (settled.status === 'fulfilled') {
      updated.set(targets[i].id, settled.value);
    }
    // On rejection, keep the original project entry (already has isRunning: false)
  }

  onStatus({ phase: 'complete', message: 'Test run complete.' });

  return Array.from(updated.values());
}
