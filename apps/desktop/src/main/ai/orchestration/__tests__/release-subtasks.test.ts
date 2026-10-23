import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RELEASE_SKIP_REASON, skipReleaseSubtasks, skipReleaseSubtasksInFile } from '../release-subtasks';

// Subtasks from a real Trainr plan, plus ordinary work
const trainrPlan = () => ({
  phases: [
    {
      name: 'Backend',
      subtasks: [
        { id: '1.1', title: 'Add workout history endpoint', description: 'Update docs/api.md and the controller', status: 'pending' },
        { id: '1.2', title: 'Run backend tests', description: 'dotnet test (Postgres container must be running)', status: 'pending' },
      ],
    },
    {
      name: 'Release',
      subtasks: [
        {
          id: '2.1',
          title: 'Deploy backend',
          description: './deploy.sh then scripts/smoke-prod.sh (deploy backend first, backward-compatible API)',
          status: 'pending',
        },
        { id: '2.2', title: 'Ship iOS build', description: 'apple/deploy-ios.sh; wait for VALID build in TestFlight.', status: 'pending' },
        {
          id: '2.3',
          title: 'Push',
          description: 'Commit and push to main; report deployed version and TestFlight build',
          status: 'in_progress',
        },
      ],
    },
  ],
});

describe('skipReleaseSubtasks', () => {
  it('closes the release subtasks with a reason and leaves code work alone', () => {
    const plan = trainrPlan();
    expect(skipReleaseSubtasks(plan)).toEqual(['2.1', '2.2', '2.3']);

    for (const subtask of plan.phases[1].subtasks) {
      expect(subtask).toMatchObject({ status: 'completed', skipped: true, skip_reason: RELEASE_SKIP_REASON });
    }
    for (const subtask of plan.phases[0].subtasks) {
      expect(subtask.status).toBe('pending');
      expect(subtask).not.toHaveProperty('skipped');
    }
  });

  it('is idempotent', () => {
    const plan = trainrPlan();
    skipReleaseSubtasks(plan);
    expect(skipReleaseSubtasks(plan)).toEqual([]);
  });
});

describe('skipReleaseSubtasksInFile', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('rewrites implementation_plan.json only when something changed', async () => {
    dir = await mkdtemp(join(tmpdir(), 'release-subtasks-'));
    const planPath = join(dir, 'implementation_plan.json');
    await writeFile(planPath, JSON.stringify(trainrPlan()));

    expect(await skipReleaseSubtasksInFile(planPath)).toEqual(['2.1', '2.2', '2.3']);
    const written = JSON.parse(await readFile(planPath, 'utf-8'));
    expect(written.phases[1].subtasks[0].skip_reason).toBe(RELEASE_SKIP_REASON);
    expect(await skipReleaseSubtasksInFile(planPath)).toEqual([]);
  });

  it('is non-fatal for a missing file', async () => {
    expect(await skipReleaseSubtasksInFile('/nonexistent/implementation_plan.json')).toEqual([]);
  });
});
