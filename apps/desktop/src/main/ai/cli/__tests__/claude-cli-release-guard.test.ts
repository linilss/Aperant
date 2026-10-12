import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawnArgs: string[][] = [];

vi.mock('node:child_process', () => ({
  spawn: (_cmd: string, args: string[]) => {
    spawnArgs.push(args);
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    child.stdin = { write: vi.fn(), end: () => setImmediate(() => child.emit('close', 0)) };
    return child;
  },
}));

vi.mock('../../../platform', () => ({ findExecutable: () => '/usr/bin/claude' }));

import { runClaudeCliDetailed } from '../claude-cli';

const run = (allowedTools: string[]) =>
  runClaudeCliDetailed({ prompt: 'hi', cwd: '/tmp', modelId: 'm', allowedTools, env: {} });

describe('runClaudeCliDetailed — release guard', () => {
  beforeEach(() => {
    spawnArgs.length = 0;
  });

  it('adds --disallowedTools with release patterns when Bash is allowed', async () => {
    await run(['Read', 'Bash']);
    const args = spawnArgs[0];
    expect(args).toContain('--disallowedTools');
    expect(args[args.indexOf('--disallowedTools') + 1]).toContain('Bash(git push:*)');
  });

  it('denies the Artifact tool when Write is allowed (even without Bash)', async () => {
    await run(['Read', 'Write', 'Edit']);
    const args = spawnArgs[0];
    expect(args[args.indexOf('--disallowedTools') + 1].split(',')).toContain('Artifact');
  });

  it('leaves the dedicated design-system runners (Artifact without Bash/Write) unguarded', async () => {
    await run(['Artifact', 'Read', 'Glob']);
    expect(spawnArgs[0]).not.toContain('--disallowedTools');
  });

  it('adds nothing for read-only tool sets', async () => {
    await run(['Read', 'Glob', 'Grep']);
    expect(spawnArgs[0]).not.toContain('--disallowedTools');
  });
});
