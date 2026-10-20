import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { SAFE_STOP_FILE } from '../ai/orchestration/pause-handler';
import { RESUME_AFTER_RESTART_FILE, collectResumeCandidates } from '../safe-restart';

let dir = '';
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function spec(id: string, plan: Record<string, unknown>, markers: string[]) {
  const d = path.join(dir, '.malvy', 'specs', id);
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, 'implementation_plan.json'), JSON.stringify(plan));
  for (const m of markers) writeFileSync(path.join(d, m), 'x');
  return d;
}

describe('collectResumeCandidates', () => {
  it('resumes only safe-stopped tasks and clears every marker', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'safe-restart-'));
    const stopped = spec('001-a', { status: 'human_review', reviewReason: 'stopped' }, [RESUME_AFTER_RESTART_FILE]);
    const finished = spec('002-b', { status: 'done', reviewReason: 'completed' }, [RESUME_AFTER_RESTART_FILE, SAFE_STOP_FILE]);
    const untouched = spec('003-c', { status: 'human_review', reviewReason: 'stopped' }, []);
    // Stopped while still planning: back in Planning, no review reason
    const planning = spec('004-d', { status: 'backlog' }, [RESUME_AFTER_RESTART_FILE]);
    const failed = spec('005-e', { status: 'human_review', reviewReason: 'errors' }, [RESUME_AFTER_RESTART_FILE]);

    const resume = collectResumeCandidates([{ id: 'p', path: dir, specsDir: '.malvy/specs' }]);

    expect(resume).toEqual([
      { projectId: 'p', specId: '001-a' },
      { projectId: 'p', specId: '004-d' },
    ]);
    for (const d of [stopped, finished, untouched, planning, failed]) {
      expect(existsSync(path.join(d, RESUME_AFTER_RESTART_FILE))).toBe(false);
      expect(existsSync(path.join(d, SAFE_STOP_FILE))).toBe(false);
    }
  });
});
