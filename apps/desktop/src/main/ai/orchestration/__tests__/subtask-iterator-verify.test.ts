import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionResult } from '../../session/types';
import { iterateSubtasks } from '../subtask-iterator';

const completed = { outcome: 'completed' } as unknown as SessionResult;

describe('iterateSubtasks verify gate', () => {
  let specDir: string;

  beforeEach(async () => {
    specDir = await mkdtemp(join(tmpdir(), 'iter-verify-'));
    await writeFile(join(specDir, 'implementation_plan.json'), JSON.stringify({
      phases: [{ name: 'P1', subtasks: [{ id: 's1', description: 'do it', status: 'pending' }] }],
    }));
  });

  afterEach(async () => {
    await rm(specDir, { recursive: true, force: true });
  });

  const readStatus = async () => {
    const plan = JSON.parse(await readFile(join(specDir, 'implementation_plan.json'), 'utf-8'));
    return plan.phases[0].subtasks[0].status as string;
  };

  it('retries a subtask until the verify command passes', async () => {
    const runSubtaskSession = vi.fn().mockResolvedValue(completed);
    const verifySubtask = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const result = await iterateSubtasks({
      specDir, projectDir: specDir, maxRetries: 3, autoContinueDelayMs: 0,
      runSubtaskSession, verifySubtask,
    });

    expect(runSubtaskSession).toHaveBeenCalledTimes(2);
    expect(runSubtaskSession.mock.calls[1][1]).toBe(2);
    expect(result.stuckSubtasks).toEqual([]);
    expect(await readStatus()).toBe('completed');
  });

  it('marks the subtask stuck after maxRetries failing verifies', async () => {
    const runSubtaskSession = vi.fn().mockResolvedValue(completed);
    const verifySubtask = vi.fn().mockResolvedValue(false);

    const result = await iterateSubtasks({
      specDir, projectDir: specDir, maxRetries: 3, autoContinueDelayMs: 0,
      runSubtaskSession, verifySubtask,
    });

    expect(runSubtaskSession).toHaveBeenCalledTimes(3);
    expect(result.stuckSubtasks).toEqual(['s1']);
    expect(await readStatus()).toBe('pending');
  });
});
