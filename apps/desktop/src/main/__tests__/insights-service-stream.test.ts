import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The AI runner is the boundary: each query streams through the callback and waits for the test
type StreamEvent = { type: string; [key: string]: unknown };
interface PendingQuery {
  emit: (event: StreamEvent) => void;
  finish: (text: string) => void;
  fail: (error: Error) => void;
}
const queries: PendingQuery[] = [];
vi.mock('../ai/runners/insights', () => ({
  runInsightsQuery: vi.fn(
    (_config: unknown, onEvent: (event: StreamEvent) => void) =>
      new Promise((resolve, reject) => {
        queries.push({
          emit: onEvent,
          finish: (text) => resolve({ text, taskSuggestion: null }),
          fail: reject,
        });
      })
  ),
}));
vi.mock('../rate-limit-detector', () => ({
  detectRateLimit: () => ({ isRateLimited: false }),
  createSDKRateLimitInfo: vi.fn(),
  getBestAvailableProfileEnv: () => ({ env: {} }),
}));
vi.mock('../services/profile', () => ({ getAPIProfileEnv: async () => ({}) }));

import { InsightsService } from '../insights-service';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function readSession(projectPath: string, sessionId: string) {
  return JSON.parse(
    readFileSync(path.join(projectPath, '.malvy', 'insights', 'sessions', `${sessionId}.json`), 'utf-8')
  ) as { messages: Array<{ role: string; content: string }> };
}

describe('InsightsService in-progress reply per project', () => {
  let dirA: string;
  let dirB: string;
  let service: InsightsService;

  beforeEach(() => {
    queries.length = 0;
    dirA = mkdtempSync(path.join(tmpdir(), 'insights-a-'));
    dirB = mkdtempSync(path.join(tmpdir(), 'insights-b-'));
    service = new InsightsService();
  });

  afterEach(() => {
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  });

  it('tags events with the session and buffers the partial reply until it is saved', async () => {
    const chunks: unknown[][] = [];
    service.on('stream-chunk', (...args: unknown[]) => chunks.push(args));
    const sessionA = service.createNewSession('A', dirA);

    const sending = service.sendMessage('A', dirA, 'question');
    await flush();
    queries[0].emit({ type: 'tool-start', name: 'Grep', input: 'pattern: foo' });
    queries[0].emit({ type: 'tool-end', name: 'Grep' });
    queries[0].emit({ type: 'text-delta', text: 'Partial ' });

    expect(chunks.at(-1)).toEqual(['A', { type: 'text', content: 'Partial ' }, sessionA.id]);
    const status = service.getStreamStatus('A');
    expect(status).toMatchObject({
      projectId: 'A',
      sessionId: sessionA.id,
      content: 'Partial ',
      currentTool: null,
      status: { phase: 'streaming' },
    });
    expect(status?.toolsUsed.map((t) => t.name)).toEqual(['Grep']);
    expect(service.getStreamStatus('B')).toBeNull();

    queries[0].emit({ type: 'text-delta', text: 'answer' });
    queries[0].finish('Partial answer');
    await sending;

    expect(service.getStreamStatus('A')).toBeNull();
    expect(readSession(dirA, sessionA.id).messages.map((m) => m.content)).toEqual(['question', 'Partial answer']);
  });

  it("saves each project's reply into its own session when both finish", async () => {
    const updated: Array<[string, { id: string }]> = [];
    service.on('session-updated', (projectId: string, session: { id: string }) => updated.push([projectId, session]));
    const sessionA = service.createNewSession('A', dirA);
    const sessionB = service.createNewSession('B', dirB);

    const sendingA = service.sendMessage('A', dirA, 'question A');
    await flush();
    const sendingB = service.sendMessage('B', dirB, 'question B');
    await flush();

    // B is shown while A finishes
    queries[0].finish('answer A');
    await sendingA;
    expect(service.getStreamStatus('B')?.sessionId).toBe(sessionB.id);
    queries[1].finish('answer B');
    await sendingB;

    expect(readSession(dirA, sessionA.id).messages.map((m) => m.content)).toEqual(['question A', 'answer A']);
    expect(readSession(dirB, sessionB.id).messages.map((m) => m.content)).toEqual(['question B', 'answer B']);
    expect(updated.map(([projectId, s]) => [projectId, s.id])).toEqual([
      ['A', sessionA.id],
      ['B', sessionB.id],
    ]);
  });

  it('clears the buffered reply when the query fails', async () => {
    service.on('error', () => undefined);
    service.createNewSession('A', dirA);

    const sending = service.sendMessage('A', dirA, 'question');
    await flush();
    queries[0].emit({ type: 'text-delta', text: 'half' });
    queries[0].fail(new Error('boom'));
    await sending;

    expect(service.getStreamStatus('A')).toBeNull();
  });
});
