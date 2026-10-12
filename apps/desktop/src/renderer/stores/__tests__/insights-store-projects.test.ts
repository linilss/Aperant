/**
 * Insights store: events are applied only to the project and session they belong to,
 * and a reply still streaming in main is restored when the user comes back.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InsightsSession, InsightsStreamStatus } from '../../../shared/types';
import {
  loadInsightsSession,
  sendMessage,
  setupInsightsListeners,
  switchSession,
  useInsightsStore
} from '../insights-store';

type Listener = (...args: unknown[]) => void;
const listeners: Record<string, Listener> = {};
const listen = (name: string) =>
  vi.fn((cb: Listener) => {
    listeners[name] = cb;
    return () => {
      delete listeners[name];
    };
  });

function session(projectId: string, id: string, replies: string[] = []): InsightsSession {
  return {
    id,
    projectId,
    title: id,
    messages: [
      { id: `${id}-u`, role: 'user', content: 'question', timestamp: new Date() },
      ...replies.map((content, i) => ({ id: `${id}-a${i}`, role: 'assistant' as const, content, timestamp: new Date() }))
    ],
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

function stream(overrides: Partial<InsightsStreamStatus> = {}): InsightsStreamStatus {
  return {
    projectId: 'A',
    sessionId: 'sA',
    startedAt: '2026-10-12T10:00:00.000Z',
    status: { phase: 'streaming', message: '' },
    content: 'Partial answer',
    currentTool: { name: 'Grep', input: 'pattern: foo' },
    toolsUsed: [{ name: 'Grep', input: 'pattern: foo', timestamp: new Date('2026-10-12T10:00:01.000Z') }],
    suggestedTasks: [],
    ...overrides
  };
}

const sessionsByProject: Record<string, InsightsSession | null> = {};
const streamsByProject: Record<string, InsightsStreamStatus | null> = {};

const api = {
  getInsightsSession: vi.fn(async (projectId: string) => ({ success: true, data: sessionsByProject[projectId] ?? null })),
  getInsightsStreamStatus: vi.fn(async (projectId: string) => ({ success: true, data: streamsByProject[projectId] ?? null })),
  listInsightsSessions: vi.fn(async () => ({ success: true, data: [] })),
  switchInsightsSession: vi.fn(),
  sendInsightsMessage: vi.fn(),
  onInsightsStreamChunk: listen('chunk'),
  onInsightsStatus: listen('status'),
  onInsightsError: listen('error'),
  onInsightsSessionUpdated: listen('sessionUpdated')
};

describe('insights store across projects', () => {
  let cleanup: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(sessionsByProject)) delete sessionsByProject[key];
    for (const key of Object.keys(streamsByProject)) delete streamsByProject[key];
    (window as unknown as { electronAPI: unknown }).electronAPI = api;
    useInsightsStore.setState({
      projectId: null,
      session: null,
      placeholderSessionId: null,
      busySessionId: null,
      status: { phase: 'idle', message: '' },
      streamingContent: '',
      streamingTasks: [],
      currentTool: null,
      toolsUsed: []
    });
    cleanup = setupInsightsListeners();
  });

  afterEach(() => cleanup());

  it("events for another project don't touch the shown session", async () => {
    sessionsByProject.B = session('B', 'sB');
    await loadInsightsSession('B');

    listeners.status('A', { phase: 'thinking', message: '' }, 'sA');
    listeners.chunk('A', { type: 'text', content: 'reply for A' }, 'sA');
    listeners.chunk('A', { type: 'tool_start', tool: { name: 'Read' } }, 'sA');
    listeners.chunk('A', { type: 'done' }, 'sA');
    listeners.error('A', 'boom', 'sA');
    listeners.sessionUpdated('A', session('A', 'sA', ['reply for A']));

    const state = useInsightsStore.getState();
    expect(state.session?.id).toBe('sB');
    expect(state.session?.messages).toHaveLength(1);
    expect(state.streamingContent).toBe('');
    expect(state.currentTool).toBeNull();
    expect(state.status.phase).toBe('idle');
    // The sidebar keeps listing B's sessions
    expect(api.listInsightsSessions).toHaveBeenCalledTimes(1);
  });

  it("switching projects drops the previous project's in-progress reply from view", async () => {
    sessionsByProject.A = session('A', 'sA');
    sessionsByProject.B = session('B', 'sB');
    await loadInsightsSession('A');
    listeners.chunk('A', { type: 'text', content: 'half of A' }, 'sA');
    expect(useInsightsStore.getState().streamingContent).toBe('half of A');

    await loadInsightsSession('B');

    const state = useInsightsStore.getState();
    expect(state.session?.id).toBe('sB');
    expect(state.streamingContent).toBe('');
    expect(state.status.phase).toBe('idle');
  });

  it('restores a partial reply on return and keeps streaming into it', async () => {
    sessionsByProject.A = session('A', 'sA');
    streamsByProject.A = stream();

    await loadInsightsSession('A');

    let state = useInsightsStore.getState();
    expect(state.streamingContent).toBe('Partial answer');
    expect(state.status.phase).toBe('streaming');
    expect(state.currentTool).toEqual({ name: 'Grep', input: 'pattern: foo' });
    expect(state.toolsUsed.map((t) => t.name)).toEqual(['Grep']);

    listeners.chunk('A', { type: 'text', content: ' and the rest' }, 'sA');
    listeners.chunk('A', { type: 'done' }, 'sA');

    state = useInsightsStore.getState();
    const last = state.session?.messages.at(-1);
    expect(last?.role).toBe('assistant');
    expect(last?.content).toBe('Partial answer and the rest');
    expect(last?.toolsUsed?.map((t) => t.name)).toEqual(['Grep']);
    expect(state.status.phase).toBe('complete');
  });

  it('a reply finished while away shows from the saved session, without a spinner', async () => {
    sessionsByProject.A = session('A', 'sA');
    sessionsByProject.B = session('B', 'sB');
    await loadInsightsSession('A');
    listeners.status('A', { phase: 'thinking', message: '' }, 'sA');
    await loadInsightsSession('B');

    // A finishes while B is shown: main saved it into A's session
    listeners.chunk('A', { type: 'done' }, 'sA');
    sessionsByProject.A = session('A', 'sA', ['answer for A']);
    listeners.sessionUpdated('A', sessionsByProject.A);
    expect(useInsightsStore.getState().session?.id).toBe('sB');

    await loadInsightsSession('A');

    const state = useInsightsStore.getState();
    expect(state.session?.messages.at(-1)?.content).toBe('answer for A');
    expect(state.status.phase).toBe('idle');
    expect(state.streamingContent).toBe('');
  });

  it('a reply of another session in the same project stays out of the shown chat and blocks sending', async () => {
    sessionsByProject.A = session('A', 's2');
    streamsByProject.A = stream({ sessionId: 's1' });

    await loadInsightsSession('A');
    listeners.chunk('A', { type: 'text', content: 'for s1' }, 's1');

    let state = useInsightsStore.getState();
    expect(state.streamingContent).toBe('');
    expect(state.busySessionId).toBe('s1');

    listeners.chunk('A', { type: 'done' }, 's1');
    state = useInsightsStore.getState();
    expect(state.busySessionId).toBeNull();
    expect(state.session?.messages).toHaveLength(1);
  });

  it('switching back to the session with the streaming reply restores it', async () => {
    sessionsByProject.A = session('A', 's2');
    streamsByProject.A = stream({ sessionId: 's1' });
    await loadInsightsSession('A');

    api.switchInsightsSession.mockResolvedValueOnce({ success: true, data: session('A', 's1') });
    await switchSession('A', 's1');

    const state = useInsightsStore.getState();
    expect(state.session?.id).toBe('s1');
    expect(state.streamingContent).toBe('Partial answer');
    expect(state.busySessionId).toBeNull();
  });

  it('the first message of a new chat streams into it and adopts the session main created', async () => {
    await loadInsightsSession('A');
    sendMessage('A', 'hello');
    const placeholder = useInsightsStore.getState().session?.id;
    expect(placeholder).toBeDefined();

    listeners.chunk('A', { type: 'text', content: 'hi' }, 'session-real');
    expect(useInsightsStore.getState().streamingContent).toBe('hi');

    listeners.chunk('A', { type: 'done' }, 'session-real');
    listeners.sessionUpdated('A', session('A', 'session-real', ['hi']));

    const state = useInsightsStore.getState();
    expect(state.session?.id).toBe('session-real');
    expect(state.placeholderSessionId).toBeNull();
  });
});
