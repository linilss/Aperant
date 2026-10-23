/**
 * Changelog handlers: generation state per project via changelog:getStatus / clearStatus
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants';

const { handlers, generateMock, sent } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  generateMock: vi.fn(),
  sent: [] as unknown[][],
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
    removeHandler: (channel: string) => handlers.delete(channel),
  },
}));

vi.mock('../../project-store', () => ({
  projectStore: {
    getProject: (id: string) => ({ id, name: `Project ${id}`, path: `/tmp/${id}`, autoBuildPath: '.malvy' }),
    getTasks: () => [],
  },
}));

vi.mock('../../changelog-service', () => ({
  changelogService: {
    on: vi.fn(),
    off: vi.fn(),
    loadTaskSpecs: vi.fn(async () => []),
    getCommits: vi.fn(() => []),
    getBranchDiffCommits: vi.fn(() => []),
  },
}));

vi.mock('../../ai/runners/changelog', () => ({ generateChangelog: generateMock }));

import { registerChangelogHandlers } from '../changelog-handlers';

const mainWindow = {
  webContents: { send: (...args: unknown[]) => sent.push(args) },
} as unknown as BrowserWindow;

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`No handler for ${channel}`);
  return Promise.resolve(handler({}, ...args));
}

const getStatus = async (projectId: string) =>
  ((await invoke(IPC_CHANNELS.CHANGELOG_GET_STATUS, projectId)) as { data: unknown }).data;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = () => new Promise((r) => setImmediate(r));

const request = (projectId: string) => ({
  projectId,
  sourceMode: 'tasks' as const,
  taskIds: [],
  version: '1.2.0',
  date: '2026-10-12',
  format: 'keep-a-changelog' as const,
  audience: 'user-facing' as const,
});

describe('changelog handlers: generation status per project', () => {
  beforeEach(() => {
    handlers.clear();
    sent.length = 0;
    generateMock.mockReset();
    registerChangelogHandlers(() => mainWindow);
  });

  it('reports running, then keeps the finished result until cleared; other project unaffected', async () => {
    const runA = deferred<{ success: boolean; text: string }>();
    generateMock.mockImplementationOnce(() => runA.promise);

    await invoke(IPC_CHANNELS.CHANGELOG_GENERATE, request('A'));
    await flush();

    expect(await getStatus('A')).toMatchObject({ state: 'running', progress: { stage: 'generating' } });
    expect(await getStatus('B')).toBeNull();

    runA.resolve({ success: true, text: '## 1.2.0\n- Added X' });
    await flush();

    // Still there after any number of fetches, until the renderer clears it
    expect(await getStatus('A')).toMatchObject({
      state: 'done',
      result: { success: true, changelog: '## 1.2.0\n- Added X', version: '1.2.0' },
    });
    expect(await getStatus('A')).toMatchObject({ state: 'done' });
    expect(await getStatus('B')).toBeNull();

    // Every event carries its project id
    expect(sent.every((args) => args[1] === 'A')).toBe(true);
    expect(sent.map((args) => args[0])).toContain(IPC_CHANNELS.CHANGELOG_GENERATION_COMPLETE);

    await invoke(IPC_CHANNELS.CHANGELOG_CLEAR_STATUS, 'A');
    expect(await getStatus('A')).toBeNull();
  });

  it('keeps an error of a project, separate from another running project', async () => {
    const runB = deferred<{ success: boolean; text: string }>();
    generateMock
      .mockImplementationOnce(async () => ({ success: false, text: '', error: 'rate limited' }))
      .mockImplementationOnce(() => runB.promise);

    await invoke(IPC_CHANNELS.CHANGELOG_GENERATE, request('A'));
    await invoke(IPC_CHANNELS.CHANGELOG_GENERATE, request('B'));
    await flush();
    await flush();

    expect(await getStatus('A')).toMatchObject({ state: 'error', error: 'rate limited' });
    expect(await getStatus('B')).toMatchObject({ state: 'running' });

    await invoke(IPC_CHANNELS.CHANGELOG_CLEAR_STATUS, 'A');
    expect(await getStatus('A')).toBeNull();
    expect(await getStatus('B')).toMatchObject({ state: 'running' });
    runB.resolve({ success: true, text: 'B log' });
    await flush();
  });
});
