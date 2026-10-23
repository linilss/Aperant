import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/nonexistent' }, screen: { getAllDisplays: () => [] } }));

import { isOnSomeDisplay } from '../window-state';

const laptop = { x: 0, y: 0, width: 1512, height: 982 };
const external = { x: 1512, y: -200, width: 2560, height: 1440 };

describe('isOnSomeDisplay', () => {
  it('accepts a window whose centre is on a connected display', () => {
    expect(isOnSomeDisplay({ x: 1700, y: 0, width: 1800, height: 1100 }, [laptop, external])).toBe(true);
  });

  it('rejects a window left on a display that is gone', () => {
    expect(isOnSomeDisplay({ x: 1700, y: 0, width: 1800, height: 1100 }, [laptop])).toBe(false);
  });
});
