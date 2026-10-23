import { describe, it, expect, vi } from 'vitest';
import type { Memory, MemoryRecordEntry } from '../types';
import {
  LEARNED_MEMORY_CONFIDENCE,
  MAX_LEARNED_MEMORIES_PER_TASK,
  insightsToMemoryEntries,
  storeTaskLearnings,
  type TaskLearningInput,
} from '../task-learning';

function existing(content: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id: content,
    type: 'gotcha',
    content,
    confidence: 0.8,
    tags: [],
    relatedFiles: [],
    relatedModules: [],
    createdAt: '',
    lastAccessedAt: '',
    accessCount: 0,
    scope: 'global',
    source: 'agent_explicit',
    sessionId: '',
    provenanceSessionIds: [],
    projectId: 'p1',
    ...overrides,
  };
}

const input: TaskLearningInput = {
  projectId: 'p1',
  specId: '007-login',
  changedFiles: ['src/auth/login.ts', 'src/auth/session.ts'],
  insights: {
    gotchas_discovered: ['Session cookies must be set with sameSite=lax or the OAuth redirect drops them'],
    patterns_discovered: ['Auth routes validate input with zod schemas from src/auth/schemas.ts'],
    file_insights: [{ file: 'src/auth/session.ts', insight: 'Session refresh runs in middleware, not in the route handlers' }],
  },
};

function makeStore(memories: Memory[] = []) {
  const stored: MemoryRecordEntry[] = [];
  return {
    stored,
    search: vi.fn(async () => memories),
    store: vi.fn(async (entry: MemoryRecordEntry) => {
      stored.push(entry);
      return `id-${stored.length}`;
    }),
  };
}

describe('insightsToMemoryEntries', () => {
  it('maps insights to typed, reviewable memories for the project', () => {
    const entries = insightsToMemoryEntries(input);
    expect(entries.map((e) => e.type)).toEqual(['gotcha', 'pattern', 'module_insight']);
    for (const e of entries) {
      expect(e.projectId).toBe('p1');
      expect(e.source).toBe('observer_inferred');
      expect(e.needsReview).toBe(true);
      expect(e.confidence).toBe(LEARNED_MEMORY_CONFIDENCE);
      expect(e.tags).toContain('spec:007-login');
    }
    expect(entries[0].relatedFiles).toEqual(input.changedFiles);
    expect(entries[2].relatedFiles).toEqual(['src/auth/session.ts']);
  });

  it('skips empty or trivial insights', () => {
    const entries = insightsToMemoryEntries({
      ...input,
      insights: { gotchas_discovered: ['', 'short'], patterns_discovered: [], file_insights: [] },
    });
    expect(entries).toEqual([]);
  });
});

describe('storeTaskLearnings', () => {
  it('stores new memories', async () => {
    const store = makeStore();
    const result = await storeTaskLearnings(store, input);
    expect(result).toEqual({ stored: 3, skipped: 0 });
    expect(store.search).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1', excludeDeprecated: false }));
  });

  it('skips near-duplicates of existing memories, including deprecated ones', async () => {
    const store = makeStore([
      existing('Session cookies must use sameSite=lax or the OAuth redirect drops them'),
      existing('Auth routes validate input with zod schemas (src/auth/schemas.ts)', { deprecated: true }),
    ]);
    const result = await storeTaskLearnings(store, input);
    expect(result).toEqual({ stored: 1, skipped: 2 });
    expect(store.stored[0].type).toBe('module_insight');
  });

  it('ignores memories from other projects when deduping', async () => {
    const store = makeStore([existing(input.insights.gotchas_discovered[0], { projectId: 'p2' })]);
    expect((await storeTaskLearnings(store, input)).stored).toBe(3);
  });

  it('dedupes within the same batch and caps the count', async () => {
    const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet'];
    const many = words.map((w) => `${w}cache ${w}queue ${w}router ${w}parser ${w}worker`);
    const store = makeStore();
    const result = await storeTaskLearnings(store, {
      ...input,
      insights: { gotchas_discovered: [...many, many[0]], patterns_discovered: [], file_insights: [] },
    });
    expect(result.stored).toBe(MAX_LEARNED_MEMORIES_PER_TASK);
    expect(result.skipped).toBe(11 - MAX_LEARNED_MEMORIES_PER_TASK);
  });
});
