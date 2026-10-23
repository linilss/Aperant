import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../cli-tool-manager', () => ({ getToolPath: () => 'git' }));
vi.mock('../ai/cli/claude-cli', () => ({ runClaudeCliDetailed: vi.fn() }));

import { buildFixPrompt, verifyAndFixAfterMerge } from '../deploy-verify';

const result = (passed: boolean, output = '') => ({ passed, exitCode: passed ? 0 : 1, timedOut: false, output, durationMs: 1 });
let dir: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf-8' });

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'deploy-verify-'));
  git('init', '-q', '-b', 'main');
  writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  git('add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('verifyAndFixAfterMerge', () => {
  it('skips without a verify command', async () => {
    expect(await verifyAndFixAfterMerge(dir, '  ', ['A'])).toEqual({ ok: true, skipped: true });
  });

  it('passes straight through when verify passes', async () => {
    const fix = vi.fn();
    expect(await verifyAndFixAfterMerge(dir, 'make', ['A'], { verify: async () => result(true), fix })).toEqual({ ok: true });
    expect(fix).not.toHaveBeenCalled();
  });

  it('fixes, re-verifies and commits the fix', async () => {
    const verify = vi.fn().mockResolvedValueOnce(result(false, 'error CS0101')).mockResolvedValueOnce(result(true));
    const fix = vi.fn(async () => writeFileSync(path.join(dir, 'a.txt'), 'fixed\n'));
    const out = await verifyAndFixAfterMerge(dir, 'dotnet build', ['A', 'B'], { verify, fix });
    expect(out).toEqual({ ok: true, fixed: true });
    expect(git('log', '-1', '--format=%s').trim()).toBe('Fix build after merging 2 tasks');
    expect(git('status', '--porcelain').trim()).toBe('');
  });

  it('does not touch a checkout with uncommitted work', async () => {
    writeFileSync(path.join(dir, 'a.txt'), 'user wip\n');
    const fix = vi.fn();
    const out = await verifyAndFixAfterMerge(dir, 'make', ['A'], { verify: async () => result(false, 'boom'), fix });
    expect(out).toMatchObject({ ok: false, reason: 'uncommitted', output: 'boom' });
    expect(fix).not.toHaveBeenCalled();
  });

  it('gives up after the attempts and reports the last output', async () => {
    const fix = vi.fn();
    const out = await verifyAndFixAfterMerge(dir, 'make', ['A'], { verify: async () => result(false, 'still'), fix });
    expect(out).toMatchObject({ ok: false, reason: 'still-failing', output: 'still' });
    expect(fix).toHaveBeenCalledTimes(2);
  });

  it('prompt names the merged tasks and the failure', () => {
    const prompt = buildFixPrompt('npm test', 'FAIL x', ['Task one']);
    expect(prompt).toContain('- Task one');
    expect(prompt).toContain('$ npm test');
    expect(prompt).toContain('Do not commit');
  });
});
