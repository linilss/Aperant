import { describe, expect, it } from 'vitest';

import { computeProjectActivity } from '../project-activity';
import type { Task } from '../../types';

const task = (status: string, archived = false) =>
  ({ status, metadata: archived ? { archivedAt: '2026-10-01' } : {} }) as unknown as Task;

describe('computeProjectActivity', () => {
  it('counts running work and what waits for the user', () => {
    const tasks = [
      task('in_progress'),
      task('ai_review'),
      task('queue'),
      task('human_review'),
      task('error'),
      task('pending_merge'),
      task('done'),
      task('human_review', true),
    ];
    expect(computeProjectActivity(tasks)).toEqual({ running: 2, needsYou: 3, merging: 0, deploying: false });
  });

  it('reports running merges and deploys', () => {
    expect(computeProjectActivity([], { deploying: true, merging: 2 })).toEqual({ running: 0, needsYou: 0, merging: 2, deploying: true });
  });
});
