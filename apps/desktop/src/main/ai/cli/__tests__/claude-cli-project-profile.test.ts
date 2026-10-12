import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawnEnvs: Record<string, string | undefined>[] = [];

vi.mock('node:child_process', () => ({
  spawn: (_cmd: string, _args: string[], opts: { env: Record<string, string | undefined> }) => {
    spawnEnvs.push(opts.env);
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    child.stdin = { write: vi.fn(), end: () => setImmediate(() => child.emit('close', 0)) };
    return child;
  },
}));

vi.mock('../../../platform', () => ({ findExecutable: () => '/usr/bin/claude' }));

vi.mock('../../../env-utils', () => ({
  getAugmentedEnvAsync: async () => ({ PATH: '/usr/bin' }),
  findExecutableAsync: async () => '/usr/bin/claude',
}));

vi.mock('../../../claude-profile-manager', () => ({
  getClaudeProfileManager: () => ({
    getProfileEnv: (id: string) => ({ CLAUDE_CONFIG_DIR: `/cfg/${id}` }),
  }),
}));

const getProjectProfileEnv = vi.fn((ref: { projectPath?: string }) =>
  ref.projectPath?.includes('/chippio/') ? { CLAUDE_CONFIG_DIR: '/cfg/chippio' } : { CLAUDE_CONFIG_DIR: '/cfg/active' },
);
vi.mock('../../../claude-profile/project-profile', () => ({
  getProjectProfileEnv: (ref: { projectPath?: string }) => getProjectProfileEnv(ref),
}));

import { runClaudeCliDetailed } from '../claude-cli';

const base = { prompt: 'hi', modelId: 'm', allowedTools: ['Read'] };

describe('runClaudeCliDetailed — per-project Claude account', () => {
  beforeEach(() => {
    spawnEnvs.length = 0;
    getProjectProfileEnv.mockClear();
  });

  it("runs a pinned project's call on the pinned profile's config dir", async () => {
    await runClaudeCliDetailed({ ...base, cwd: '/x', projectPath: '/Users/me/chippio/app' });
    expect(getProjectProfileEnv).toHaveBeenCalledWith({ projectPath: '/Users/me/chippio/app' });
    expect(spawnEnvs[0].CLAUDE_CONFIG_DIR).toBe('/cfg/chippio');
    expect(spawnEnvs[0].PATH).toBe('/usr/bin');
  });

  it('uses the active profile without a project', async () => {
    await runClaudeCliDetailed({ ...base, cwd: '/Users/me/chippio/app' });
    expect(spawnEnvs[0].CLAUDE_CONFIG_DIR).toBe('/cfg/active');
  });

  it('an explicit profileId wins over the project', async () => {
    await runClaudeCliDetailed({ ...base, cwd: '/x', projectPath: '/Users/me/chippio/app', profileId: 'other' });
    expect(spawnEnvs[0].CLAUDE_CONFIG_DIR).toBe('/cfg/other');
  });

  it('an explicit env skips profile lookup (worker threads)', async () => {
    await runClaudeCliDetailed({ ...base, cwd: '/x', projectPath: '/Users/me/chippio/app', env: { CLAUDE_CONFIG_DIR: '/given' } });
    expect(getProjectProfileEnv).not.toHaveBeenCalled();
    expect(spawnEnvs[0].CLAUDE_CONFIG_DIR).toBe('/given');
  });
});
