import { describe, it, expect, vi } from 'vitest';
import type { Memory, MemorySearchFilters } from '../../types';
import {
  buildTaskMemoryContext,
  formatTaskMemories,
  type TaskMemorySources,
} from '../../injection/task-memory-context';

let seq = 0;
function mem(overrides: Partial<Memory> = {}): Memory {
  seq++;
  return {
    id: `m${seq}`,
    type: 'gotcha',
    content: `Memory number ${seq}`,
    confidence: 0.8,
    tags: [],
    relatedFiles: [],
    relatedModules: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    lastAccessedAt: '2026-01-01T00:00:00.000Z',
    accessCount: 0,
    scope: 'global',
    source: 'agent_explicit',
    sessionId: '',
    provenanceSessionIds: [],
    projectId: 'p1',
    ...overrides,
  };
}

/** search() returns `priority` for the no-query scan and `relevant` for the query search */
function sources(priority: Memory[], relevant: Memory[] | Error, keyword?: Memory[]): TaskMemorySources & {
  search: ReturnType<typeof vi.fn>;
} {
  return {
    search: vi.fn(async (filters: MemorySearchFilters) => {
      if (!filters.query) return priority;
      if (relevant instanceof Error) throw relevant;
      return relevant;
    }),
    keywordSearch: keyword ? vi.fn(async () => keyword) : undefined,
  };
}

const opts = { projectId: 'p1', query: 'add login form' };

describe('buildTaskMemoryContext', () => {
  it('searches scoped to the project, excluding deprecated and low-confidence memories', async () => {
    const src = sources([], []);
    await buildTaskMemoryContext(src, opts);
    for (const [filters] of src.search.mock.calls as [MemorySearchFilters][]) {
      expect(filters.projectId).toBe('p1');
      expect(filters.excludeDeprecated).toBe(true);
      expect(filters.minConfidence).toBeGreaterThan(0);
    }
    expect(src.search.mock.calls.some(([f]) => (f as MemorySearchFilters).query === 'add login form')).toBe(true);
  });

  it('drops pointers, deprecated, other-project and low-confidence memories', async () => {
    const keep = mem({ content: 'keep me' });
    const src = sources([], [
      keep,
      mem({ content: 'pointer', source: 'user_taught' }),
      mem({ content: 'old', deprecated: true }),
      mem({ content: 'elsewhere', projectId: 'p2' }),
      mem({ content: 'weak', confidence: 0.2 }),
    ]);
    const text = await buildTaskMemoryContext(src, opts);
    expect(text).toContain('keep me');
    for (const dropped of ['pointer', 'old', 'elsewhere', 'weak']) expect(text).not.toContain(dropped);
  });

  it('orders pinned, then verified, then relevant, without duplicates', async () => {
    const pinned = mem({ content: 'pinned one', pinned: true });
    const verified = mem({ content: 'verified one', userVerified: true });
    const relevant = mem({ content: 'relevant one' });
    const src = sources([verified, pinned, mem({ content: 'unrelated unpinned' })], [relevant, pinned]);
    const lines = (await buildTaskMemoryContext(src, opts)).split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('pinned one');
    expect(lines[0]).toContain('[pinned]');
    expect(lines[1]).toContain('verified one');
    expect(lines[1]).toContain('[verified]');
    expect(lines[2]).toContain('relevant one');
  });

  it('marks unverified memories and requires higher confidence for them', async () => {
    const src = sources([], [
      mem({ content: 'learned gotcha', needsReview: true, confidence: 0.6 }),
      mem({ content: 'shaky guess', needsReview: true, confidence: 0.5 }),
    ]);
    const text = await buildTaskMemoryContext(src, opts);
    expect(text).toContain('[unverified] learned gotcha');
    expect(text).not.toContain('shaky guess');
  });

  it('falls back to keyword search when semantic search throws', async () => {
    const src = sources([], new Error('embeddings down'), [mem({ content: 'from bm25' })]);
    const onLog = vi.fn();
    const text = await buildTaskMemoryContext(src, { ...opts, onLog });
    expect(text).toContain('from bm25');
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('semantic search failed'));
  });

  it('falls back to keyword search when semantic search finds nothing', async () => {
    const src = sources([], [], [mem({ content: 'keyword hit' })]);
    expect(await buildTaskMemoryContext(src, opts)).toContain('keyword hit');
  });

  it('returns empty string when every lookup fails', async () => {
    const src: TaskMemorySources = {
      search: vi.fn().mockRejectedValue(new Error('db closed')),
      keywordSearch: vi.fn().mockRejectedValue(new Error('db closed')),
    };
    await expect(buildTaskMemoryContext(src, opts)).resolves.toBe('');
  });
});

describe('formatTaskMemories', () => {
  it('respects the item limit', () => {
    const memories = Array.from({ length: 20 }, () => mem());
    expect(formatTaskMemories(memories, { limit: 12 }).split('\n')).toHaveLength(12);
  });

  it('stops at the token budget', () => {
    const memories = Array.from({ length: 10 }, (_, i) => mem({ content: `${i} ${'x'.repeat(390)}` }));
    const text = formatTaskMemories(memories, { tokenBudget: 300 });
    // each line is ~100 tokens → only 2 fit in 300
    expect(text.split('\n')).toHaveLength(2);
    expect(Math.ceil(text.length / 4)).toBeLessThanOrEqual(300);
  });

  it('shows type and related files', () => {
    const text = formatTaskMemories([
      mem({ type: 'pattern', content: 'use zod', relatedFiles: ['a.ts', 'b.ts', 'c.ts', 'd.ts'] }),
    ]);
    expect(text).toBe('- [pattern] use zod (files: a.ts, b.ts, c.ts, …)');
  });
});
