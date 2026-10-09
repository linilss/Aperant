/**
 * Tests for parseClaudeLimitMessage.
 * Sample strings mirror what Claude Code CLI 2.1.295 composes:
 *   `You've hit your ${label}${" · resets " + time}${" · progress saved"?}`
 * with labels from its { five_hour: "session limit", seven_day: "weekly limit",
 * seven_day_opus: "Opus limit", seven_day_sonnet: "Sonnet limit",
 * seven_day_overage_included: "Fable limit", overage: "usage credit limit" } map,
 * plus the older "Limit reached · resets …" format.
 */
import { describe, expect, it } from 'vitest';
import { parseClaudeLimitMessage } from '../claude-limit-message';

describe('parseClaudeLimitMessage', () => {
  describe('current "You\'ve hit your …" format', () => {
    it.each([
      ["You've hit your session limit · resets 3pm (Europe/Stockholm)", 'session', 'session limit', '3pm (Europe/Stockholm)', 'session'],
      ["You've hit your weekly limit · resets Oct 12, 3pm (Europe/Stockholm)", 'weekly', 'weekly limit', 'Oct 12, 3pm (Europe/Stockholm)', 'weekly'],
      ["You've hit your Opus limit · resets Oct 12, 3pm (Europe/Stockholm)", 'opus', 'Opus limit', 'Oct 12, 3pm (Europe/Stockholm)', 'weekly'],
      ["You've hit your Sonnet limit · resets Oct 12, 3pm (Europe/Stockholm) · progress saved", 'sonnet', 'Sonnet limit', 'Oct 12, 3pm (Europe/Stockholm)', 'weekly'],
      ["You've hit your Fable limit · resets Oct 12, 3:30pm (Europe/Stockholm)", 'fable', 'Fable limit', 'Oct 12, 3:30pm (Europe/Stockholm)', 'weekly'],
      ["You've hit your usage credit limit · resets Nov 1 (Europe/Stockholm)", 'usage_credit', 'usage credit limit', 'Nov 1 (Europe/Stockholm)', undefined],
      ["You've hit your usage limit · resets 11pm (Europe/Stockholm)", 'unknown', 'usage limit', '11pm (Europe/Stockholm)', undefined],
      ["You've hit your limit · resets 11pm (Europe/Stockholm) · progress saved", 'unknown', 'limit', '11pm (Europe/Stockholm)', undefined],
    ])('parses %s', (input, kind, label, resetTime, window) => {
      expect(parseClaudeLimitMessage(input)).toEqual({ kind, label, resetTime, window, format: 'hit-your' });
    });

    it('parses the reset from a "your <limit> resets" suffix after other suffixes', () => {
      const result = parseClaudeLimitMessage(
        "You've hit your monthly spend limit · raise it at https://claude.ai/settings/usage · your session limit resets 3pm (Europe/Stockholm)"
      );
      expect(result).toMatchObject({ kind: 'spend', label: 'monthly spend limit', resetTime: '3pm (Europe/Stockholm)' });
    });

    it('returns no reset time when none is printed', () => {
      expect(parseClaudeLimitMessage("You've hit your session limit")).toEqual({
        kind: 'session',
        label: 'session limit',
        resetTime: undefined,
        window: 'session',
        format: 'hit-your',
      });
    });

    it('accepts a curly apostrophe and surrounding terminal output', () => {
      const output = "some output\r\n  ⎿  You’ve hit your weekly limit · resets Oct 12, 3pm (Europe/Stockholm)\r\n> ";
      expect(parseClaudeLimitMessage(output)).toMatchObject({ kind: 'weekly', resetTime: 'Oct 12, 3pm (Europe/Stockholm)' });
    });

    it('strips ANSI colour codes', () => {
      const output = "\x1b[38;5;203mYou've hit your session limit\x1b[39m \x1b[2m· resets 3pm (Europe/Stockholm)\x1b[22m";
      expect(parseClaudeLimitMessage(output)).toMatchObject({ kind: 'session', resetTime: '3pm (Europe/Stockholm)' });
    });

    it('ignores the fast-mode cooldown message', () => {
      expect(parseClaudeLimitMessage("You've hit your fast limit · resets in 5m")).toBeNull();
    });
  });

  describe('old "Limit reached · resets …" format', () => {
    it.each([
      ['Limit reached · resets Dec 17 at 6am (Europe/Oslo)', 'unknown', '', 'Dec 17 at 6am (Europe/Oslo)', undefined],
      ['Limit reached • resets 11:59pm', 'unknown', '', '11:59pm', undefined],
      ['5-hour limit reached · resets 3pm (Europe/Stockholm)', 'session', '5-hour', '3pm (Europe/Stockholm)', 'session'],
      ['Weekly limit reached · resets Oct 12, 3pm', 'weekly', 'Weekly', 'Oct 12, 3pm', 'weekly'],
      ['Opus weekly limit reached · resets Oct 12, 3pm', 'weekly', 'weekly', 'Oct 12, 3pm', 'weekly'],
    ])('parses %s', (input, kind, label, resetTime, window) => {
      expect(parseClaudeLimitMessage(input)).toEqual({ kind, label, resetTime, window, format: 'limit-reached' });
    });
  });

  it('returns null for unrelated output', () => {
    expect(parseClaudeLimitMessage('')).toBeNull();
    expect(parseClaudeLimitMessage('Task completed successfully')).toBeNull();
    expect(parseClaudeLimitMessage('The rate limiter limits requests')).toBeNull();
  });
});
