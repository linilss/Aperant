import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { scanTaskStatuses } from '../task-status-scan';

let dir = '';
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function spec(id: string, plan: unknown, meta?: unknown) {
  const d = path.join(dir, '.malvy', 'specs', id);
  mkdirSync(d, { recursive: true });
  if (plan !== undefined) writeFileSync(path.join(d, 'implementation_plan.json'), JSON.stringify(plan));
  if (meta !== undefined) writeFileSync(path.join(d, 'task_metadata.json'), JSON.stringify(meta));
}

describe('scanTaskStatuses', () => {
  it('maps plan statuses like the task loader and flags archived tasks', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'status-scan-'));
    spec('001-a', { status: 'queued', created_at: '2026-10-01' });
    spec('002-b', { status: 'coding' });
    spec('003-c', { status: 'completed' }, { archivedAt: '2026-10-02' });
    spec('004-d', undefined);
    const byId = Object.fromEntries((await scanTaskStatuses({ path: dir, autoBuildPath: '.malvy' })).map((s) => [s.id, s]));
    expect(byId['001-a']).toMatchObject({ status: 'queue', createdAt: '2026-10-01', archived: false });
    expect(byId['002-b'].status).toBe('in_progress');
    expect(byId['003-c']).toMatchObject({ status: 'done', archived: true });
    expect(byId['004-d'].status).toBe('backlog');
  });

  it('returns nothing for a project without specs', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'status-scan-'));
    expect(await scanTaskStatuses({ path: dir, autoBuildPath: '.malvy' })).toEqual([]);
  });
});
