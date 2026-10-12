/**
 * @vitest-environment jsdom
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefineRunStatus } from '../../../../shared/types';

vi.mock('../../Terminal', () => ({
  Terminal: ({ id }: { id: string }) => <div data-testid="refine-terminal">{id}</div>,
}));
vi.mock('../RefinePhaseBar', () => ({
  RefinePhaseBar: ({ phases, currentPhaseIndex }: { phases: Array<{ label: string }>; currentPhaseIndex: number }) => (
    <div data-testid="phase-bar">{phases[currentPhaseIndex]?.label}</div>
  ),
}));
vi.mock('../../../stores/project-store', () => ({
  useProjectStore: (selector: (s: unknown) => unknown) =>
    selector({ getActiveProject: () => ({ id: 'p1', path: '/project' }) }),
}));

import { RefineTerminalTab } from '../RefineTerminalTab';
import { useTerminalStore } from '../../../stores/terminal-store';
import { terminalBufferManager } from '../../../lib/terminal-buffer-manager';

const runningStatus: RefineRunStatus = {
  taskId: 't1',
  isRunning: true,
  autoMode: false,
  terminalId: 'refine-t1',
  startedAt: '2026-10-12T10:00:00.000Z',
  currentPhase: 'grill',
  currentPhaseIndex: 2,
  phases: [
    { name: 'understand', label: 'Understand', status: 'completed' },
    { name: 'prd', label: 'Write PRD', status: 'completed' },
    { name: 'grill', label: 'Grill', status: 'active' },
    { name: 'plan', label: 'Plan', status: 'pending' },
    { name: 'proofread', label: 'Proofread', status: 'pending' },
  ],
  outputTail: 'earlier output\r\n',
};

function mockApi(status: RefineRunStatus | null, session: unknown = null) {
  const api = {
    taskRefineGetStatus: vi.fn().mockResolvedValue({ success: true, data: status }),
    taskRefineGetSession: vi.fn().mockResolvedValue({ success: true, data: session }),
    taskRefineTerminalStart: vi.fn(),
    taskRefineResetSession: vi.fn().mockResolvedValue({ success: true }),
    taskRefineSkipPhase: vi.fn(),
    onTaskRefinePhaseChange: vi.fn(() => () => undefined),
  };
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  return api;
}

async function renderTab() {
  render(<RefineTerminalTab taskId="t1" taskTitle="Task" taskDescription="" autoMode={false} isActive />);
  // Let the status/session lookups resolve, then run the autostart delay
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
}

describe('RefineTerminalTab', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useTerminalStore.setState({ terminals: [], activeTerminalId: null });
    terminalBufferManager.clear('refine-t1');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not start a new run when one is already running for the task', async () => {
    const api = mockApi(runningStatus);

    await renderTab();

    expect(api.taskRefineTerminalStart).not.toHaveBeenCalled();
    expect(screen.getByTestId('refine-terminal').textContent).toBe('refine-t1');
    // Shows the run's current phase
    expect(screen.getByTestId('phase-bar').textContent).toBe('Grill');
  });

  it('re-attaches even when a previous session with completed phases exists', async () => {
    const api = mockApi(runningStatus, { session: { completedPhases: ['understand', 'prd'], mode: 'interactive' } });

    await renderTab();

    expect(api.taskRefineTerminalStart).not.toHaveBeenCalled();
    expect(screen.queryByText('Previous Refine Session Found')).toBeNull();
    expect(screen.getByTestId('phase-bar').textContent).toBe('Grill');
  });

  it('replays the run output into a terminal that has none', async () => {
    mockApi(runningStatus);

    await renderTab();

    expect(terminalBufferManager.get('refine-t1')).toBe('earlier output\r\n');
  });

  it('keeps the existing terminal history instead of replaying', async () => {
    mockApi(runningStatus);
    terminalBufferManager.set('refine-t1', 'local history');

    await renderTab();

    expect(terminalBufferManager.get('refine-t1')).toBe('local history');
  });

  it('autostarts when nothing is running for the task', async () => {
    const api = mockApi(null);

    await renderTab();

    expect(api.taskRefineTerminalStart).toHaveBeenCalledTimes(1);
    expect(api.taskRefineTerminalStart).toHaveBeenCalledWith('t1', false);
  });

  it('autostarts when the last run has finished', async () => {
    const api = mockApi({ ...runningStatus, isRunning: false });

    await renderTab();

    expect(api.taskRefineTerminalStart).toHaveBeenCalledTimes(1);
  });
});
