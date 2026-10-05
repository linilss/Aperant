import { describe, it, expect } from 'vitest';
import {
  IDEATION_TYPE_FILES,
  ideationTypeFileName,
  mergeIdeationIdeas,
} from '../ideation-consolidation';
import type { RawIdea } from '../../ipc-handlers/ideation/types';

/** Build a minimal raw idea; only id and type matter to the merge */
function idea(id: string, type: string, title = id): RawIdea {
  return { id, type, title } as unknown as RawIdea;
}

describe('ideationTypeFileName', () => {
  it('follows the <type>_ideas.json convention by default', () => {
    expect(ideationTypeFileName('code_improvements')).toBe('code_improvements_ideas.json');
    expect(ideationTypeFileName('security_hardening')).toBe('security_hardening_ideas.json');
  });

  it('uses the real filename for ui_ux_improvements, which breaks the convention', () => {
    // The prompt writes ui_ux_ideas.json; deriving from the type looked for
    // ui_ux_improvements_ideas.json and always came up empty.
    expect(ideationTypeFileName('ui_ux_improvements')).toBe('ui_ux_ideas.json');
  });

  it('falls back to the convention for an unknown type', () => {
    expect(ideationTypeFileName('brand_new_type')).toBe('brand_new_type_ideas.json');
  });

  it('covers every type the map declares', () => {
    for (const [type, fileName] of Object.entries(IDEATION_TYPE_FILES)) {
      expect(ideationTypeFileName(type)).toBe(fileName);
    }
  });
});

describe('mergeIdeationIdeas', () => {
  it('keeps existing ideas when a run produced nothing', () => {
    const existing = [idea('ci-001', 'code_improvements')];
    expect(mergeIdeationIdeas(existing, new Map())).toEqual(existing);
  });

  it('writes a run into an empty project', () => {
    const generated = new Map([['code_improvements', [idea('ci-001', 'code_improvements')]]]);
    expect(mergeIdeationIdeas([], generated)).toHaveLength(1);
  });

  it('replaces only the regenerated type and preserves the others', () => {
    const existing = [
      idea('ci-001', 'code_improvements', 'old code idea'),
      idea('uiux-001', 'ui_ux_improvements', 'kept ui idea'),
    ];
    const generated = new Map([
      ['code_improvements', [idea('ci-001', 'code_improvements', 'new code idea')]],
    ]);

    const merged = mergeIdeationIdeas(existing, generated);

    expect(merged.map((i) => (i as unknown as { title: string }).title)).toEqual([
      'kept ui idea',
      'new code idea',
    ]);
  });

  it('never produces duplicate ids when a rerun reuses per-type sequential ids', () => {
    // The agent emits ci-001..ci-00N on every run, so appending would collide
    const existing = [idea('ci-001', 'code_improvements'), idea('ci-002', 'code_improvements')];
    const generated = new Map([
      ['code_improvements', [idea('ci-001', 'code_improvements'), idea('ci-002', 'code_improvements')]],
    ]);

    const merged = mergeIdeationIdeas(existing, generated);
    const ids = merged.map((i) => (i as unknown as { id: string }).id);

    expect(merged).toHaveLength(2);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('merges several regenerated types at once', () => {
    const existing = [
      idea('ci-001', 'code_improvements'),
      idea('uiux-001', 'ui_ux_improvements'),
      idea('sec-001', 'security_hardening'),
    ];
    const generated = new Map([
      ['code_improvements', [idea('ci-001', 'code_improvements')]],
      ['ui_ux_improvements', [idea('uiux-001', 'ui_ux_improvements'), idea('uiux-002', 'ui_ux_improvements')]],
    ]);

    const merged = mergeIdeationIdeas(existing, generated);
    const byType = merged.reduce<Record<string, number>>((acc, i) => {
      const type = (i as unknown as { type: string }).type;
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});

    expect(byType).toEqual({
      security_hardening: 1,
      code_improvements: 1,
      ui_ux_improvements: 2,
    });
  });

  it('drops a type whose rerun legitimately returned no ideas', () => {
    const existing = [idea('ci-001', 'code_improvements'), idea('uiux-001', 'ui_ux_improvements')];
    const generated = new Map([['code_improvements', []]]);

    const merged = mergeIdeationIdeas(existing, generated);

    expect(merged).toHaveLength(1);
    expect((merged[0] as unknown as { type: string }).type).toBe('ui_ux_improvements');
  });

  it('tolerates stored ideas with no type field', () => {
    const existing = [{ id: 'orphan-1' } as unknown as RawIdea];
    const generated = new Map([['code_improvements', [idea('ci-001', 'code_improvements')]]]);

    expect(mergeIdeationIdeas(existing, generated)).toHaveLength(2);
  });
});
