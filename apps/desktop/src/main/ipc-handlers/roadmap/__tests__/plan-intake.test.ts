import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { isPackaged: false } }));

import { IPC_CHANNELS } from '../../../../shared/constants';
import type { FeatureProofread } from '../../../ai/runners/roadmap-feature-proofread';
import { parseFeatureProofread } from '../../../ai/runners/roadmap-feature-proofread';
import { keepNewerRefinements } from '../feature-persistence';
import { createPlanIntake, newlyPlannedFeatureIds } from '../plan-intake';

let dir = '';
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function setup(features: Array<Record<string, unknown>>) {
  dir = mkdtempSync(path.join(tmpdir(), 'intake-'));
  const roadmapDir = path.join(dir, '.malvy', 'roadmap');
  mkdirSync(roadmapDir, { recursive: true });
  const file = path.join(roadmapDir, 'roadmap.json');
  writeFileSync(file, JSON.stringify({ features }));
  const read = () => JSON.parse(readFileSync(file, 'utf-8')).features as Array<Record<string, unknown>>;
  return { file, read };
}

const ready: FeatureProofread = {
  verdict: 'ready',
  note: 'Added an offline criterion',
  title: 'Better title',
  description: 'Clearer description',
  rationale: '',
  acceptanceCriteria: ['Works offline'],
  userStories: ['As a parent, I want X so that Y.'],
};

function intake(proofread: FeatureProofread | Error, read: () => Array<Record<string, unknown>>, file: string) {
  const emit = vi.fn();
  const convert = vi.fn(async (_p: string, featureId: string, status: string) => {
    const roadmap = JSON.parse(readFileSync(file, 'utf-8'));
    const f = roadmap.features.find((x: Record<string, unknown>) => x.id === featureId);
    f.status = status;
    f.linked_spec_id = '007-better-title';
    writeFileSync(file, JSON.stringify(roadmap));
    return { success: true as const, data: { specId: '007-better-title' } as never };
  });
  const service = createPlanIntake({
    getProjectPath: () => dir,
    runProofread: async () => {
      if (proofread instanceof Error) throw proofread;
      return proofread;
    },
    resolveModelId: () => 'm',
    convert,
    emit,
  });
  return { service, emit, convert, read };
}

describe('plan intake', () => {
  it('proofreads, creates the task and moves the feature to in_progress', async () => {
    const { file, read } = setup([{ id: 'f1', title: 'Old', status: 'planned' }]);
    const { service, emit, convert } = intake(ready, read, file);
    await service.run('p', 'f1');

    const f = read()[0];
    expect(f.title).toBe('Better title');
    expect(f.acceptance_criteria).toEqual(['Works offline']);
    expect(f.status).toBe('in_progress');
    expect(f.linked_spec_id).toBe('007-better-title');
    expect(convert).toHaveBeenCalledWith('p', 'f1', 'in_progress');
    expect(emit).toHaveBeenCalledWith(IPC_CHANNELS.TASK_REFINE_APPLIED, '007-better-title', 'p');
  });

  it('sends an obsolete feature back to under_review with the reason, without a task', async () => {
    const { file, read } = setup([{ id: 'f1', title: 'Old', status: 'planned' }]);
    const { service, convert } = intake({ ...ready, verdict: 'obsolete', note: 'Already in Shelf.cs' }, read, file);
    await service.run('p', 'f1');

    expect(read()[0].status).toBe('under_review');
    expect(read()[0].proofread_note).toContain('Already in Shelf.cs');
    expect(convert).not.toHaveBeenCalled();
  });

  it('keeps the feature planned with a note when the agent fails', async () => {
    const { file, read } = setup([{ id: 'f1', title: 'Old', status: 'planned' }]);
    const { service, convert } = intake(new Error('rate limited'), read, file);
    await service.run('p', 'f1');

    expect(read()[0].status).toBe('planned');
    expect(read()[0].proofread_note).toContain('rate limited');
    expect(convert).not.toHaveBeenCalled();
  });

  it('ignores features that are not planned or already have a task', async () => {
    const { file, read } = setup([{ id: 'f1', title: 'Old', status: 'planned', linked_spec_id: '001-x' }]);
    const { service, convert, emit } = intake(ready, read, file);
    await service.run('p', 'f1');
    expect(convert).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('newlyPlannedFeatureIds', () => {
  it('picks features moved into planned without a task', () => {
    const before = [
      { id: 'a', status: 'under_review' },
      { id: 'b', status: 'planned' },
      { id: 'c', status: 'under_review' },
    ];
    const after = [
      { id: 'a', status: 'planned' },
      { id: 'b', status: 'planned' },
      { id: 'c', status: 'planned', linked_spec_id: '001' },
      { id: 'd', status: 'planned' },
    ];
    expect(newlyPlannedFeatureIds(before, after)).toEqual(['a']);
  });
});

describe('keepNewerRefinements (intake)', () => {
  it("doesn't let a stale renderer save undo the intake", () => {
    const stored = [{ id: 'f1', status: 'in_progress', linked_spec_id: '007', intake_at: '2026-10-17T10:00:00Z' }];
    const incoming: Array<Record<string, unknown>> = [{ id: 'f1', status: 'planned' }];
    keepNewerRefinements(stored, incoming);
    expect(incoming[0]).toMatchObject({ status: 'in_progress', linked_spec_id: '007' });
  });
});

describe('parseFeatureProofread', () => {
  it('reads the last block and strips checkbox prefixes', () => {
    const text =
      '<feature_proofread>{"verdict":"ready","note":"ok","title":"T","description":"D","rationale":"","acceptance_criteria":["- [ ] A"],"user_stories":[]}</feature_proofread>';
    expect(parseFeatureProofread(text)?.acceptanceCriteria).toEqual(['A']);
  });

  it('rejects unknown verdicts and obsolete without a reason', () => {
    expect(parseFeatureProofread('<feature_proofread>{"verdict":"maybe","title":"T"}</feature_proofread>')).toBeNull();
    expect(parseFeatureProofread('<feature_proofread>{"verdict":"obsolete","note":""}</feature_proofread>')).toBeNull();
  });
});
