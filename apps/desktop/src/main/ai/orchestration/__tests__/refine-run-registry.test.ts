import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The `claude` CLI is the boundary: each spawn is a child that stays open until the test closes it
interface FakeChild extends EventEmitter {
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
}
const children: FakeChild[] = [];
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    const child = new EventEmitter() as FakeChild;
    child.stdin = { write: vi.fn(), end: vi.fn() };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn(() => child.emit('close'));
    children.push(child);
    return child;
  }),
}));
vi.mock('../../../env-utils', () => ({
  getAugmentedEnvAsync: async () => ({}),
  findExecutableAsync: async () => '/usr/local/bin/claude',
}));
vi.mock('../../prompts/prompt-loader', () => ({ tryLoadPrompt: () => 'system prompt' }));
vi.mock('../../../claude-profile/project-profile', () => ({ getProjectProfileEnv: () => ({}) }));
vi.mock('../../../project-store', () => ({
  projectStore: { getProjects: () => [], invalidateTasksCache: vi.fn() },
}));

import { RefineOrchestrator } from '../refine-orchestrator';
import { RefineRunRegistry } from '../refine-run-registry';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('RefineRunRegistry with RefineOrchestrator', () => {
  let specDir: string;
  const send = vi.fn();
  const getMainWindow = () => ({ webContents: { send } }) as never;

  const create = (taskId: string, autoMode = false) => () =>
    new RefineOrchestrator({
      taskId,
      taskTitle: 'Title',
      taskDescription: 'Description',
      projectDir: specDir,
      specDir: path.join(specDir, 'spec'),
      terminalId: `refine-${taskId}`,
      autoMode,
      getMainWindow,
    });

  beforeEach(() => {
    specDir = mkdtempSync(path.join(tmpdir(), 'refine-registry-'));
    children.length = 0;
    send.mockClear();
  });

  afterEach(() => {
    rmSync(specDir, { recursive: true, force: true });
  });

  it('reports the running phase, terminal and start time of a task run', async () => {
    const runs = new RefineRunRegistry<RefineOrchestrator>();
    expect(runs.getStatus('t1')).toBeNull();

    runs.start('t1', create('t1', true));
    await flush();

    const status = runs.getStatus('t1');
    expect(status).toMatchObject({
      taskId: 't1',
      isRunning: true,
      autoMode: true,
      terminalId: 'refine-t1',
      currentPhase: 'understand',
      currentPhaseIndex: 0,
    });
    expect(Number.isNaN(Date.parse(status?.startedAt ?? ''))).toBe(false);
    expect(status?.phases[0]).toEqual({ name: 'understand', label: 'Understand', status: 'active' });
    expect(status?.phases[1].status).toBe('pending');
    expect(status?.outputTail).toContain('Phase 1/5: Understand');
    expect(runs.getStatus('other')).toBeNull();
  });

  it('a second start for a running task returns the existing run instead of spawning', async () => {
    const runs = new RefineRunRegistry<RefineOrchestrator>();
    const first = runs.start('t1', create('t1'));
    await flush();
    expect(children).toHaveLength(1);

    const second = runs.start('t1', create('t1'));
    await flush();

    expect(first.started).toBe(true);
    expect(second.started).toBe(false);
    expect(second.run).toBe(first.run);
    expect(children).toHaveLength(1);
    expect(children[0].kill).not.toHaveBeenCalled();
    expect(runs.getStatus('t1')?.isRunning).toBe(true);
  });

  it('another task starts its own run', async () => {
    const runs = new RefineRunRegistry<RefineOrchestrator>();
    runs.start('t1', create('t1'));
    const other = runs.start('t2', create('t2'));
    await flush();

    expect(other.started).toBe(true);
    expect(children).toHaveLength(2);
  });

  it('starts a new run after the previous one was stopped', async () => {
    const runs = new RefineRunRegistry<RefineOrchestrator>();
    const first = runs.start('t1', create('t1'));
    await flush();

    runs.stop('t1');
    expect(runs.getStatus('t1')).toBeNull();

    const again = runs.start('t1', create('t1'));
    await flush();
    expect(again.started).toBe(true);
    expect(again.run).not.toBe(first.run);
    expect(children).toHaveLength(2);
  });

  it('a finished run no longer counts as running', async () => {
    const runs = new RefineRunRegistry<RefineOrchestrator>();
    const { run } = runs.start('t1', create('t1'));
    await flush();
    run.stop();

    expect(runs.getStatus('t1')?.isRunning).toBe(false);
    const again = runs.start('t1', create('t1'));
    expect(again.started).toBe(true);
  });
});
