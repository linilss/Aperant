import { describe, expect, it, vi } from 'vitest';

vi.mock('../ipc-handlers/task/execution-handlers', () => ({ taskStatusUpdater: null }));
vi.mock('../project-store', () => ({ projectStore: {} }));
vi.mock('electron', () => ({ app: { getPath: () => '/nonexistent' } }));

import { pickTasksToPromote } from '../task-queue';
import type { Task } from '../../shared/types';

const task = (id: string, status: string, createdAt: string, extra: Partial<Task> = {}) =>
  ({ id, specId: id, status, createdAt: new Date(createdAt), metadata: {}, ...extra }) as unknown as Task;

describe('pickTasksToPromote', () => {
  it('fills free slots with the oldest queued tasks', () => {
    const tasks = [
      task('run', 'in_progress', '2026-10-01'),
      task('q-new', 'queue', '2026-10-03'),
      task('q-old', 'queue', '2026-10-02'),
      task('q-mid', 'queue', '2026-10-02T12:00'),
      task('archived', 'queue', '2026-09-01', { metadata: { archivedAt: '2026-10-01' } } as Partial<Task>),
    ];
    expect(pickTasksToPromote(tasks, 3, () => false).map((t) => t.id)).toEqual(['q-old', 'q-mid']);
  });

  it('holds promotion while a task waits out a usage limit', () => {
    const tasks = [task('paused', 'in_progress', '2026-10-01'), task('q', 'queue', '2026-10-02')];
    expect(pickTasksToPromote(tasks, 3, (t) => t.id === 'paused')).toEqual([]);
  });
});
