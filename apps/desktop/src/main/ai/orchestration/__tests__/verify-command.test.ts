import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isWindows } from '../../../platform';
import { formatVerifyFailure, runVerifyCommand, tailOutput } from '../verify-command';

describe('runVerifyCommand', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'verify-cmd-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('passes when the command exits 0 and runs in the given directory', async () => {
    writeFileSync(path.join(dir, 'marker.txt'), 'hello-from-worktree');
    const command = isWindows() ? 'type marker.txt' : 'cat marker.txt';
    const result = await runVerifyCommand(command, dir);

    expect(result.passed).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.output).toContain('hello-from-worktree');
  });

  it('fails with the exit code and captures stderr', async () => {
    const result = await runVerifyCommand('echo build broke 1>&2 && exit 3', dir);

    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(result.output).toContain('build broke');
  });

  it.skipIf(isWindows())('times out long-running commands', async () => {
    const result = await runVerifyCommand('sleep 10', dir, { timeoutMs: 300 });

    expect(result.passed).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.output).toContain('timed out');
    expect(result.durationMs).toBeLessThan(5_000);
  });

  it.skipIf(isWindows())('keeps only the tail of long output', async () => {
    const result = await runVerifyCommand('for i in $(seq 1 500); do echo "line $i"; done; exit 1', dir, {
      maxLines: 20,
      maxChars: 8_000,
    });

    expect(result.passed).toBe(false);
    expect(result.output).toContain('line 500');
    expect(result.output).not.toContain('line 480\n');
    expect(result.output).toContain('output truncated');
  });
});

describe('tailOutput', () => {
  it('returns short output unchanged', () => {
    expect(tailOutput('a\nb\n', 10, 100)).toBe('a\nb');
  });

  it('keeps the last N lines', () => {
    const text = Array.from({ length: 10 }, (_, i) => `l${i}`).join('\n');
    expect(tailOutput(text, 3, 1000)).toBe('[... output truncated ...]\nl7\nl8\nl9');
  });

  it('keeps the last N characters', () => {
    const out = tailOutput('x'.repeat(50) + 'END', 100, 10);
    expect(out.endsWith('xxxxxxxEND')).toBe(true);
    expect(out).toContain('output truncated');
  });
});

describe('formatVerifyFailure', () => {
  it('includes the command, status and output', () => {
    const text = formatVerifyFailure('npm test', {
      passed: false,
      exitCode: 1,
      timedOut: false,
      output: '1 failing test',
      durationMs: 10,
    });
    expect(text).toContain('npm test');
    expect(text).toContain('exit code 1');
    expect(text).toContain('1 failing test');
  });
});
