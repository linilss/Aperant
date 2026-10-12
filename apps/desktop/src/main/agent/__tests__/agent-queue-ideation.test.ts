import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IdeationConfig } from '../../../shared/types';

// The runner is the boundary: record each call and write the type's output file like the CLI would
const runnerCalls: Array<Record<string, unknown>> = [];
vi.mock('../../ai/runners/ideation', () => ({
  IDEATION_TYPES: ['features', 'code_improvements'],
  runIdeation: vi.fn(async (config: Record<string, unknown>) => {
    runnerCalls.push(config);
    const type = String(config.ideationType);
    const file = type === 'features' ? 'features_ideas.json' : `${type}_ideas.json`;
    mkdirSync(String(config.outputDir), { recursive: true });
    writeFileSync(
      path.join(String(config.outputDir), file),
      JSON.stringify({ [type]: [{ id: `${type}-1`, type, title: 't', description: 'd', rationale: 'r' }] }),
    );
    return { success: true, text: '' };
  }),
}));
vi.mock('../../ai/runners/roadmap', () => ({ runRoadmapGeneration: vi.fn() }));
vi.mock('../../ai/prompts/prompt-loader', () => ({ resolvePromptsDir: () => '/prompts' }));
vi.mock('../../project-store', () => ({ projectStore: { getTasks: () => [] } }));
vi.mock('../agent-process', () => ({ AgentProcessManager: class {} }));

import { AgentQueueManager } from '../agent-queue';
import { AgentState } from '../agent-state';
import { transformSessionFromSnakeCase } from '../../ipc-handlers/ideation/transformers';
import { runIdeation } from '../../ai/runners/ideation';
import type { IdeationRunStatus } from '../../../shared/types';

describe('AgentQueueManager ideation: focus and saved config', () => {
  let projectDir: string;
  let emitter: EventEmitter;
  let queue: AgentQueueManager;

  const baseConfig = (overrides: Partial<IdeationConfig> = {}): IdeationConfig => ({
    enabledTypes: ['features', 'code_improvements'],
    includeRoadmapContext: false,
    includeKanbanContext: false,
    maxIdeasPerType: 3,
    ...overrides,
  });

  const run = async (config: IdeationConfig) => {
    const done = new Promise((resolve) => emitter.once('ideation-complete', resolve));
    await queue.startIdeationGeneration('p1', projectDir, config, false);
    await done;
  };

  const savedIdeation = () =>
    JSON.parse(readFileSync(path.join(projectDir, '.malvy', 'ideation', 'ideation.json'), 'utf-8'));

  beforeEach(() => {
    runnerCalls.length = 0;
    projectDir = mkdtempSync(path.join(tmpdir(), 'ideation-queue-'));
    emitter = new EventEmitter();
    const processManager = { killProcess: vi.fn() } as unknown as ConstructorParameters<typeof AgentQueueManager>[2];
    queue = new AgentQueueManager(
      new AgentState(),
      {} as ConstructorParameters<typeof AgentQueueManager>[1],
      processManager,
      emitter,
    );
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('passes the focus to the runner for every enabled type', async () => {
    await run(baseConfig({ focus: 'Keep kids playing longer' }));

    expect(runnerCalls.map((c) => c.ideationType)).toEqual(['features', 'code_improvements']);
    for (const call of runnerCalls) expect(call.focus).toBe('Keep kids playing longer');
  });

  it('saves types, toggles and the trimmed focus to ideation.json and restores them', async () => {
    await run(baseConfig({ enabledTypes: ['code_improvements'], focus: '  offline play  ' }));

    const saved = savedIdeation();
    expect(saved.config).toMatchObject({
      enabled_types: ['code_improvements'],
      include_roadmap_context: false,
      max_ideas_per_type: 3,
      focus: 'offline play',
    });
    expect(saved.config.known_types).toContain('features');

    // Features was known and switched off: it stays off when restored
    const session = transformSessionFromSnakeCase(saved, 'p1');
    expect(session.config.enabledTypes).toEqual(['code_improvements']);
    expect(session.config.focus).toBe('offline play');
  });

  it('an append run adds its types to the saved selection', async () => {
    await run(baseConfig({ enabledTypes: ['features'] }));
    await run(baseConfig({ enabledTypes: ['code_improvements'], append: true }));

    expect(savedIdeation().config.enabled_types).toEqual(['features', 'code_improvements']);
  });

  describe('run status for getStatus', () => {
    it('tracks progress and finished types while running, and clears on complete', async () => {
      const seen: Array<IdeationRunStatus | null> = [];
      emitter.on('ideation-type-complete', () => seen.push(queue.getIdeationRunStatus('p1')));
      let atComplete: IdeationRunStatus | null | undefined;
      emitter.on('ideation-complete', () => {
        atComplete = queue.getIdeationRunStatus('p1');
      });

      await run(baseConfig());

      expect(seen[0]).toMatchObject({
        isRunning: true,
        append: false,
        enabledTypes: ['features', 'code_improvements'],
        typeStates: { features: 'done', code_improvements: 'queued' },
        typeCounts: { features: 1 },
        status: { phase: 'generating', message: 'Generating features ideas...' },
      });
      expect(seen[0]?.ideasByType.features?.map((i) => i.id)).toEqual(['features-1']);
      expect(seen[1]?.typeStates).toEqual({ features: 'done', code_improvements: 'done' });
      // Cleared before the completion event goes out, so a reload on it sees the final state
      expect(atComplete).toBeNull();
      expect(queue.getIdeationRunStatus('p1')).toBeNull();
      expect(queue.getIdeationRunStatus('other')).toBeNull();
    });

    it('marks a failed type and keeps running', async () => {
      vi.mocked(runIdeation).mockResolvedValueOnce({ success: false, error: 'boom' } as never);
      const seen: Array<IdeationRunStatus | null> = [];
      emitter.on('ideation-type-failed', () => seen.push(queue.getIdeationRunStatus('p1')));

      await run(baseConfig());

      expect(seen[0]?.typeStates).toEqual({ features: 'failed', code_improvements: 'queued' });
      expect(queue.getIdeationRunStatus('p1')).toBeNull();
    });

    it('clears on error', async () => {
      // ideation.json as a directory makes the consolidation write fail
      mkdirSync(path.join(projectDir, '.malvy', 'ideation', 'ideation.json'), { recursive: true });
      const errored = new Promise((resolve) => emitter.once('ideation-error', resolve));

      await queue.startIdeationGeneration('p1', projectDir, baseConfig(), false);
      await errored;

      expect(queue.getIdeationRunStatus('p1')).toBeNull();
    });

    it('clears on stop, and a stopped run cannot clear the run that replaced it', async () => {
      vi.mocked(runIdeation).mockImplementationOnce(
        (config: { abortSignal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            config.abortSignal?.addEventListener('abort', () => reject(new Error('aborted')));
          }) as never
      );
      const stopped = vi.fn();
      emitter.on('ideation-stopped', stopped);

      const first = queue.startIdeationGeneration('p1', projectDir, baseConfig(), false);
      expect(queue.getIdeationRunStatus('p1')?.typeStates.features).toBe('running');

      expect(queue.stopIdeation('p1')).toBe(true);
      expect(queue.getIdeationRunStatus('p1')).toBeNull();

      // Refresh: a new run starts before the stopped one has unwound
      // The replacement run never finishes during the test
      vi.mocked(runIdeation).mockImplementationOnce(() => new Promise(() => undefined) as never);
      void queue.startIdeationGeneration('p1', projectDir, baseConfig({ enabledTypes: ['features'] }), false);
      await first;

      expect(stopped).not.toHaveBeenCalled();
      expect(queue.isIdeationRunning('p1')).toBe(true);
      expect(queue.getIdeationRunStatus('p1')).toMatchObject({ isRunning: true, enabledTypes: ['features'] });
    });

    it('a plain stop emits stopped and leaves nothing tracked', async () => {
      vi.mocked(runIdeation).mockImplementationOnce(
        (config: { abortSignal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            config.abortSignal?.addEventListener('abort', () => reject(new Error('aborted')));
          }) as never
      );
      const stopped = new Promise((resolve) => emitter.once('ideation-stopped', resolve));

      const running = queue.startIdeationGeneration('p1', projectDir, baseConfig(), false);
      queue.stopIdeation('p1');
      await running;
      await stopped;

      expect(queue.isIdeationRunning('p1')).toBe(false);
      expect(queue.getIdeationRunStatus('p1')).toBeNull();
    });
  });
});
