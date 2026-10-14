import { describe, expect, it } from 'vitest';
import { splitRefineOptions } from '../RefineFeaturePanel';

describe('splitRefineOptions', () => {
  it('splits the ranked options off the question', () => {
    const { body, options } = splitRefineOptions(
      'Both apps plot one line.\n\nWhat should the toggles start as?\n\n**Options:**\n1. All on, not remembered — a quick lens\n2. Remember per device — sticky choice\n3. Remember per user — synced\n'
    );
    expect(body).toBe('Both apps plot one line.\n\nWhat should the toggles start as?');
    expect(options).toEqual([
      { n: 1, text: 'All on, not remembered — a quick lens' },
      { n: 2, text: 'Remember per device — sticky choice' },
      { n: 3, text: 'Remember per user — synced' }
    ]);
  });

  it('leaves messages without an options block alone', () => {
    const text = 'Question?\n\n**Recommendation:** yes — because';
    expect(splitRefineOptions(text)).toEqual({ body: text, options: [] });
  });
});
