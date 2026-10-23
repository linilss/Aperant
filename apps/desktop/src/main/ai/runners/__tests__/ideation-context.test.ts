import { describe, it, expect, vi } from 'vitest';
import {
  IDEATION_CONTEXT_CAP,
  buildKanbanContextSection,
  buildRoadmapContextSection,
  ideationContextOptions,
  selectKanbanContextTasks,
} from '../ideation-context';

describe('buildRoadmapContextSection', () => {
  it('is empty without features', () => {
    expect(buildRoadmapContextSection([])).toBe('');
    expect(buildRoadmapContextSection([{ id: 'f-1' }])).toBe('');
  });

  it('lists title + priority + status with truncated one-line descriptions', () => {
    const section = buildRoadmapContextSection([
      { title: 'Offline\nmode', priority: 'must', status: 'planned', description: `Sync ${'a'.repeat(200)}` },
      { title: 'Export', description: '' },
    ]);
    expect(section).toContain('do not propose ideas already covered');
    expect(section).toContain('names the feature it improves');
    expect(section).toContain('- [must/planned] Offline mode — Sync ');
    expect(section).toContain('- [?/under_review] Export\n');
    const offlineLine = section.split('\n').find((l) => l.includes('Offline mode')) ?? '';
    expect(offlineLine.length).toBeLessThan(130);
    expect(offlineLine.endsWith('…')).toBe(true);
  });

  it(`caps the list at ${IDEATION_CONTEXT_CAP} and says how many were left out`, () => {
    const features = Array.from({ length: IDEATION_CONTEXT_CAP + 5 }, (_, i) => ({ title: `F${i}` }));
    const section = buildRoadmapContextSection(features);
    expect(section.split('\n').filter((l) => l.startsWith('- [')).length).toBe(IDEATION_CONTEXT_CAP);
    expect(section).toContain('(+5 more not listed)');
  });
});

describe('buildKanbanContextSection', () => {
  it('is empty without tasks', () => {
    expect(buildKanbanContextSection([])).toBe('');
  });

  it('lists title + status, capped', () => {
    const tasks = Array.from({ length: IDEATION_CONTEXT_CAP + 2 }, (_, i) => ({ title: `T${i}`, status: 'backlog' }));
    const section = buildKanbanContextSection(tasks);
    expect(section).toContain('EXISTING TASKS');
    expect(section).toContain('- [backlog] T0');
    expect(section).not.toContain(`T${IDEATION_CONTEXT_CAP}\n`);
    expect(section).toContain('(+2 more not listed)');
  });
});

describe('selectKanbanContextTasks', () => {
  it('drops archived tasks and lists unfinished ones first', () => {
    const result = selectKanbanContextTasks([
      { title: 'Shipped', status: 'done' },
      { title: 'Old', status: 'backlog', metadata: { archivedAt: '2026-01-01' } },
      { title: 'Doing', status: 'in_progress' },
    ]);
    expect(result).toEqual([
      { title: 'Doing', status: 'in_progress' },
      { title: 'Shipped', status: 'done' },
    ]);
  });
});

describe('ideationContextOptions', () => {
  const tasks = [{ title: 'Doing', status: 'in_progress' }];

  it('passes both toggles through and loads tasks when the kanban toggle is on', () => {
    const getTasks = vi.fn(() => tasks);
    expect(ideationContextOptions({ includeRoadmapContext: false, includeKanbanContext: true }, getTasks)).toEqual({
      includeRoadmapContext: false,
      includeKanbanContext: true,
      existingTasks: tasks,
    });
    expect(getTasks).toHaveBeenCalledOnce();
  });

  it('does not load tasks when the kanban toggle is off', () => {
    const getTasks = vi.fn(() => tasks);
    expect(ideationContextOptions({ includeRoadmapContext: true, includeKanbanContext: false }, getTasks)).toEqual({
      includeRoadmapContext: true,
      includeKanbanContext: false,
    });
    expect(getTasks).not.toHaveBeenCalled();
  });

  it('defaults both toggles to on (older saved configs)', () => {
    const options = ideationContextOptions({}, () => tasks);
    expect(options.includeRoadmapContext).toBe(true);
    expect(options.includeKanbanContext).toBe(true);
  });

  it('runs without tasks when loading them fails', () => {
    const options = ideationContextOptions({ includeKanbanContext: true }, () => {
      throw new Error('boom');
    });
    expect(options.existingTasks).toEqual([]);
  });
});
