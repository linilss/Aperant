import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readSettingsFile: vi.fn(),
  getMemoryService: vi.fn(),
  extractSessionInsights: vi.fn(),
}));

vi.mock('../../settings-utils', () => ({ readSettingsFile: mocks.readSettingsFile }));
vi.mock('../../ipc-handlers/context/memory-service-factory', () => ({ getMemoryService: mocks.getMemoryService }));
vi.mock('../../ai/memory/db', () => ({ getMemoryClient: vi.fn() }));
vi.mock('../../ai/runners/insight-extractor', () => ({ extractSessionInsights: mocks.extractSessionInsights }));
vi.mock('../../cli-tool-manager', () => ({ getToolPath: () => 'git' }));

import { buildMemoryContextForTask, isAgentMemoryEnabled, learnFromCompletedTask } from '../agent-memory';
import { resolveMemoryEnabled } from '../../ai/memory/memory-enabled';

describe('resolveMemoryEnabled', () => {
  it('follows the app setting unless the project overrides it', () => {
    expect(resolveMemoryEnabled(true, undefined)).toBe(true);
    expect(resolveMemoryEnabled(undefined, undefined)).toBe(false);
    expect(resolveMemoryEnabled(true, 'false')).toBe(false);
    expect(resolveMemoryEnabled(false, 'TRUE')).toBe(true);
    expect(resolveMemoryEnabled(true, 'garbage')).toBe(true);
  });
});

describe('agent memory gating', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'agent-memory-'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const writeProjectEnv = (content: string) => {
    mkdirSync(path.join(root, '.malvy'), { recursive: true });
    writeFileSync(path.join(root, '.malvy', '.env'), content);
  };

  it('reads the project override from .malvy/.env', () => {
    mocks.readSettingsFile.mockReturnValue({ memoryEnabled: true });
    expect(isAgentMemoryEnabled(root, '.malvy')).toBe(true);
    writeProjectEnv('GRAPHITI_ENABLED=false\n');
    expect(isAgentMemoryEnabled(root, '.malvy')).toBe(false);
  });

  it('memory off → no injection and the memory service is never opened', async () => {
    mocks.readSettingsFile.mockReturnValue({ memoryEnabled: false });
    const context = await buildMemoryContextForTask({ projectId: 'p1', projectPath: root, autoBuildPath: '.malvy', query: 'x' });
    expect(context).toBeUndefined();
    expect(mocks.getMemoryService).not.toHaveBeenCalled();
  });

  it('memory off → nothing learned', async () => {
    mocks.readSettingsFile.mockReturnValue({ memoryEnabled: true });
    writeProjectEnv('GRAPHITI_ENABLED=false\n');
    await learnFromCompletedTask({
      projectId: 'p1', projectPath: root, autoBuildPath: '.malvy', specId: '001', workDir: root, specDir: root,
    });
    expect(mocks.getMemoryService).not.toHaveBeenCalled();
    expect(mocks.extractSessionInsights).not.toHaveBeenCalled();
  });

  it('memory on → injects formatted memories', async () => {
    mocks.readSettingsFile.mockReturnValue({ memoryEnabled: true });
    mocks.getMemoryService.mockResolvedValue({
      search: vi.fn(async (f: { query?: string }) => f.query
        ? [{
            id: 'a', type: 'gotcha', content: 'Run migrations first', confidence: 0.8, tags: [], relatedFiles: [],
            relatedModules: [], createdAt: '', lastAccessedAt: '', accessCount: 0, scope: 'global',
            source: 'agent_explicit', sessionId: '', provenanceSessionIds: [], projectId: 'p1',
          }]
        : []),
    });
    const context = await buildMemoryContextForTask({ projectId: 'p1', projectPath: root, query: 'db task' });
    expect(context).toBe('- [gotcha] Run migrations first');
  });

  it('memory on but service unavailable → skips silently', async () => {
    mocks.readSettingsFile.mockReturnValue({ memoryEnabled: true });
    mocks.getMemoryService.mockRejectedValue(new Error('libsql missing'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(buildMemoryContextForTask({ projectId: 'p1', projectPath: root, query: 'db task' })).resolves.toBeUndefined();
    await expect(learnFromCompletedTask({
      projectId: 'p1', projectPath: root, specId: '001', workDir: root, specDir: root,
    })).resolves.toBeUndefined();
  });
});
