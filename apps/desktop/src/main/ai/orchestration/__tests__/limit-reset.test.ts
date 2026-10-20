import { describe, expect, it } from 'vitest';

import { parseLimitReset } from '../pause-handler';

// Wed 2026-10-21 14:20 local time
const now = new Date(2026, 9, 21, 14, 20);

describe('parseLimitReset', () => {
  it('reads the CLI "resets 3pm" line as the next 15:00', () => {
    expect(parseLimitReset("You've hit your session limit · resets 3pm (Europe/Stockholm)", now)).toEqual(new Date(2026, 9, 21, 15, 0));
  });

  it('rolls a past time over to tomorrow', () => {
    expect(parseLimitReset('limit · resets 9:30am', now)).toEqual(new Date(2026, 9, 22, 9, 30));
  });

  it('reads a weekday for weekly limits', () => {
    expect(parseLimitReset("You've hit your weekly limit · resets Mon 9am", now)).toEqual(new Date(2026, 9, 26, 9, 0));
  });

  it('reads an epoch after "|" and an ISO time', () => {
    const at = new Date(2026, 9, 21, 18, 0);
    expect(parseLimitReset(`Claude AI usage limit reached|${Math.floor(at.getTime() / 1000)}`, now)).toEqual(at);
    expect(parseLimitReset('resets_at 2026-10-22T08:00:00Z', now)).toEqual(new Date('2026-10-22T08:00:00Z'));
  });

  it('returns null when the message says nothing about the reset', () => {
    expect(parseLimitReset('429 Too Many Requests', now)).toBeNull();
  });
});
