import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendTaskDeployment } from '../task-deployments';
import { countUndeployedTasks, getLastDeployment } from '../../shared/utils/task-deployments';
import type { Task } from '../../shared/types';

describe('appendTaskDeployment', () => {
  let root: string;
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('appends to task_metadata.json in every spec location, keeping other fields', () => {
    root = mkdtempSync(path.join(tmpdir(), 'deployments-'));
    const main = path.join(root, 'main');
    const worktree = path.join(root, 'worktree');
    mkdirSync(main);
    mkdirSync(worktree);
    writeFileSync(path.join(main, 'task_metadata.json'), JSON.stringify({ category: 'feature' }));

    const first = { script: 'deploy.sh', args: '', at: '2026-10-10T10:00:00.000Z' };
    const second = { script: 'apple/deploy-ios.sh', args: '--beta', at: '2026-10-11T10:00:00.000Z' };
    expect(appendTaskDeployment([main, worktree], first)).toEqual([first]);
    expect(appendTaskDeployment([main, worktree], second)).toEqual([first, second]);

    const mainMeta = JSON.parse(readFileSync(path.join(main, 'task_metadata.json'), 'utf-8'));
    expect(mainMeta).toEqual({ category: 'feature', deployments: [first, second] });
    const worktreeMeta = JSON.parse(readFileSync(path.join(worktree, 'task_metadata.json'), 'utf-8'));
    expect(worktreeMeta.deployments).toHaveLength(2);
  });

  it('returns null when the spec has no location', () => {
    root = mkdtempSync(path.join(tmpdir(), 'deployments-'));
    expect(appendTaskDeployment([], { script: 'deploy.sh', at: 'x' })).toBeNull();
  });
});

describe('deployment helpers', () => {
  const task = (status: Task['status'], metadata?: Task['metadata']) => ({ status, metadata }) as Task;

  it('counts merged tasks that were never deployed (ignoring archived)', () => {
    const tasks = [
      task('done'),
      task('done', { deployments: [{ script: 'deploy.sh', at: '2026-10-11T00:00:00Z' }] }),
      task('done', { archivedAt: '2026-10-01T00:00:00Z' }),
      task('human_review'),
      task('done', { deployments: [] }),
    ];
    expect(countUndeployedTasks(tasks)).toBe(2);
  });

  it('returns the newest deployment', () => {
    const d1 = { script: 'a.sh', at: '2026-10-10T00:00:00Z' };
    const d2 = { script: 'b.sh', at: '2026-10-11T00:00:00Z' };
    expect(getLastDeployment(task('done', { deployments: [d1, d2] }))).toEqual(d2);
    expect(getLastDeployment(task('done'))).toBeUndefined();
  });
});
