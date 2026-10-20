import { describe, expect, it } from 'vitest';

import { parseTaskGroups } from '../task-consolidate';
import { buildConsolidatedDescription } from '../../../../shared/utils/task-consolidation';

const tasks = ['012-tz', '013-tz-ui', '014-idem', '015-queue', '009-remind'].map((specId) => ({ specId, title: specId, spec: `# ${specId}\nBody of ${specId}` }));

describe('parseTaskGroups', () => {
  it('keeps every task exactly once: unknown ids dropped, duplicates keep their first group, leftovers stand alone', () => {
    const text =
      '<task_groups>[{"title":"Time zone","specIds":["012-tz","013-tz-ui","ghost"],"reason":"same field"},' +
      '{"title":"Offline","specIds":["014-idem","015-queue","012-tz"]}]</task_groups>';
    const groups = parseTaskGroups(text, tasks);
    expect(groups?.map((g) => g.specIds)).toEqual([['012-tz', '013-tz-ui'], ['014-idem', '015-queue'], ['009-remind']]);
  });

  it('returns null without a block', () => {
    expect(parseTaskGroups('no groups here', tasks)).toBeNull();
  });
});

describe('buildConsolidatedDescription', () => {
  it('lists the parts in build order with their specs', () => {
    const specs = new Map(tasks.map((t) => [t.specId, { title: t.title, spec: t.spec }]));
    const text = buildConsolidatedDescription({ title: 'Time zone', summary: 'One field', specIds: ['012-tz', '013-tz-ui'], reason: '' }, specs);
    expect(text.indexOf('Part 1: 012-tz')).toBeLessThan(text.indexOf('Part 2: 013-tz-ui'));
    expect(text).toContain('Body of 013-tz-ui');
    expect(text.startsWith('# Time zone')).toBe(true);
  });
});
