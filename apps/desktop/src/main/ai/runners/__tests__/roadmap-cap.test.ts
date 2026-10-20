import { describe, expect, it } from 'vitest';


import { capNewFeatures, MAX_NEW_FEATURES } from '../roadmap';

const f = (id: string, title = id) => ({ id, title });

describe('capNewFeatures', () => {
  it('keeps at most MAX_NEW_FEATURES new features, in the AI order', () => {
    const generated = Array.from({ length: 9 }, (_, i) => f(`n${i}`));
    expect(capNewFeatures(generated, []).map((x) => x.id)).toEqual(['n0', 'n1', 'n2', 'n3', 'n4'].slice(0, MAX_NEW_FEATURES));
  });

  it("doesn't count features the AI repeated from the kept ones", () => {
    const kept = [f('k1', 'Offline mode')];
    const generated = [f('k1'), f('x', 'offline mode'), f('a'), f('b')];
    expect(capNewFeatures(generated, kept).map((x) => x.id)).toEqual(['a', 'b']);
  });
});
