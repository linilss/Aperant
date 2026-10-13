/**
 * Verify Command
 * ==============
 *
 * Runs the project's verify command (ProjectSettings.verifyCommand, e.g.
 * "npm run typecheck && npm test") in the task worktree. Used by the build
 * orchestrator as a deterministic quality gate after each subtask and before QA.
 */

import { spawn } from 'node:child_process';

import { getShellConfig, isWindows, killProcessGracefully } from '../../platform';

// =============================================================================
// Constants
// =============================================================================

/** Default timeout for one verify run (15 minutes) */
export const VERIFY_TIMEOUT_MS = 15 * 60 * 1000;

/** Keep at most this many trailing lines of output */
export const VERIFY_OUTPUT_MAX_LINES = 150;

/** Keep at most this many trailing characters of output */
export const VERIFY_OUTPUT_MAX_CHARS = 8_000;

/** Upper bound on output buffered in memory while the command runs */
const BUFFER_LIMIT_CHARS = 256_000;

// =============================================================================
// Types
// =============================================================================

export interface VerifyCommandOptions {
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  maxLines?: number;
  maxChars?: number;
  env?: NodeJS.ProcessEnv;
}

export interface VerifyCommandResult {
  passed: boolean;
  exitCode: number | null;
  timedOut: boolean;
  /** Tail of combined stdout + stderr */
  output: string;
  durationMs: number;
}

// =============================================================================
// Runner
// =============================================================================

/**
 * Run `command` through the user's shell in `cwd`.
 * Unix uses a login shell so the user's PATH (dotnet, nvm, ...) is available.
 */
export function runVerifyCommand(
  command: string,
  cwd: string,
  options: VerifyCommandOptions = {},
): Promise<VerifyCommandResult> {
  const timeoutMs = options.timeoutMs ?? VERIFY_TIMEOUT_MS;
  const maxLines = options.maxLines ?? VERIFY_OUTPUT_MAX_LINES;
  const maxChars = options.maxChars ?? VERIFY_OUTPUT_MAX_CHARS;
  const startTime = Date.now();

  return new Promise((resolve) => {
    let buffer = '';
    let timedOut = false;
    let settled = false;

    const append = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      if (buffer.length > BUFFER_LIMIT_CHARS) {
        buffer = buffer.slice(-BUFFER_LIMIT_CHARS);
      }
    };

    const finish = (exitCode: number | null, extra?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.abortSignal?.removeEventListener('abort', onAbort);
      if (extra) append(`\n${extra}`);
      resolve({
        passed: exitCode === 0 && !timedOut,
        exitCode,
        timedOut,
        output: tailOutput(buffer, maxLines, maxChars),
        durationMs: Date.now() - startTime,
      });
    };

    const windows = isWindows();
    let child: ReturnType<typeof spawn>;
    try {
      if (windows) {
        child = spawn(command, { cwd, env: options.env ?? process.env, shell: true, windowsHide: true });
      } else {
        const shell = getShellConfig();
        child = spawn(shell.executable, [...shell.args, '-c', command], {
          cwd,
          env: options.env ?? process.env,
          // Own process group so a timeout kills the whole tree (test runners, compilers)
          detached: true,
        });
      }
    } catch (error) {
      resolve({
        passed: false,
        exitCode: null,
        timedOut: false,
        output: `Failed to start verify command: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - startTime,
      });
      return;
    }

    const kill = () => {
      if (!windows && child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
          return;
        } catch {
          // Fall through to single-process kill
        }
      }
      killProcessGracefully(child, { timeoutMs: 2_000 });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);

    const onAbort = () => kill();
    options.abortSignal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.on('error', (error) => finish(null, `Verify command error: ${error.message}`));
    child.on('close', (code) => {
      finish(code, timedOut ? `Verify command timed out after ${Math.round(timeoutMs / 1000)}s` : undefined);
    });
  });
}

// =============================================================================
// Formatting
// =============================================================================

/** Keep the last `maxLines` lines, then the last `maxChars` characters. */
export function tailOutput(text: string, maxLines: number, maxChars: number): string {
  const trimmed = text.replace(/\s+$/, '');
  let lines = trimmed.split(/\r?\n/);
  let truncated = false;
  if (lines.length > maxLines) {
    lines = lines.slice(-maxLines);
    truncated = true;
  }
  let result = lines.join('\n');
  if (result.length > maxChars) {
    result = result.slice(-maxChars);
    truncated = true;
  }
  return truncated ? `[... output truncated ...]\n${result}` : result;
}

/** Prompt section telling planner/coder/QA that a verify command exists. */
export function formatVerifyCommandContext(command: string): string {
  return [
    '## PROJECT VERIFY COMMAND',
    '',
    'This project has a verify command that must pass before work counts as done:',
    '',
    '```',
    command,
    '```',
    '',
    'Malvy runs it automatically in the task worktree after every subtask and before QA. A subtask whose changes make it fail is sent back to the coder. Run it yourself before finishing (plan subtasks so each one leaves it green).',
  ].join('\n');
}

/** Prompt section carrying a failed verify run back to the agent. */
export function formatVerifyFailure(command: string, result: VerifyCommandResult): string {
  const status = result.timedOut
    ? 'timed out'
    : `failed with exit code ${result.exitCode ?? 'unknown'}`;
  return [
    '## VERIFY COMMAND FAILED — FIX THIS FIRST',
    '',
    `The project verify command \`${command}\` ${status}. The work is not done until it passes. Fix the cause, run the command again, and only then finish.`,
    '',
    'Output (tail):',
    '',
    '```',
    result.output || '(no output)',
    '```',
  ].join('\n');
}
