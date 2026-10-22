import { describe, expect, it, vi } from 'vitest';
import type { Task } from '../../../../shared/types';
import { runMergeBatch, type MergeOneResult } from '../merge-batch';

function task(id: string, createdAt: string): Task {
  return { id, title: `Task ${id}`, projectId: 'p1', status: 'pending_merge', createdAt } as unknown as Task;
}

describe('runMergeBatch', () => {
  it('merges oldest first and continues past a failure', async () => {
    const a = task('a', '2026-01-01');
    const b = task('b', '2026-01-02');
    const c = task('c', '2026-01-03');
    const order: string[] = [];
    const mergeOne = vi.fn(async (t: Task): Promise<MergeOneResult> => {
      order.push(t.id);
      return t.id === 'b' ? { ok: false, reason: 'conflict in x.ts' } : { ok: true };
    });

    const outcome = await runMergeBatch({ tasks: [c, a, b], mergeOne });

    expect(order).toEqual(['a', 'b', 'c']);
    expect(outcome.merged.map((t) => t.id)).toEqual(['a', 'c']);
    expect(outcome.failed).toEqual([{ task: b, reason: 'conflict in x.ts' }]);
  });

  it('records a thrown error as a failure with its message', async () => {
    const a = task('a', '2026-01-01');
    const outcome = await runMergeBatch({
      tasks: [a],
      mergeOne: async () => {
        throw new Error('IPC gone');
      }
    });

    expect(outcome.failed).toEqual([{ task: a, reason: 'IPC gone' }]);
  });

  it('reports progress per task', async () => {
    const onStart = vi.fn();
    await runMergeBatch({
      tasks: [task('a', '2026-01-01'), task('b', '2026-01-02')],
      mergeOne: async () => ({ ok: true }),
      onStart
    });

    expect(onStart.mock.calls.map(([t, i, n]) => [t.id, i, n])).toEqual([
      ['a', 1, 2],
      ['b', 2, 2]
    ]);
  });
});
