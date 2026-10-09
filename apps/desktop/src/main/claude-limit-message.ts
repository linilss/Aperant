/**
 * Parser for the usage-limit lines printed by the Claude Code CLI.
 *
 * Current CLI (2.1.x) composes: `You've hit your ${label}${suffixes}` where
 *   - label is one of "session limit", "weekly limit", "Opus limit", "Sonnet limit",
 *     "Fable limit", "usage limit", "limit", "monthly spend limit", "team's shared budget", ...
 *   - suffixes are " · "-separated, e.g. " · resets 3pm (Europe/Stockholm)",
 *     " · resets Oct 12, 3pm (Europe/Stockholm)", " · your session limit resets 3pm",
 *     " · progress saved".
 *
 * Older CLI versions printed: `Limit reached · resets Dec 17 at 6am (Europe/Oslo)`
 * (optionally prefixed, e.g. "5-hour limit reached · resets 3pm").
 *
 * Pure module (no Electron / profile-manager imports) so it can be shared by the
 * terminal output parser and the SDK/CLI rate-limit detector.
 */

/** Which limit was hit, as far as the message tells us */
export type ClaudeLimitKind =
  | 'session'
  | 'weekly'
  | 'opus'
  | 'sonnet'
  | 'fable'
  | 'usage_credit'
  | 'spend'
  | 'unknown';

export interface ClaudeLimitMessage {
  /** Limit kind derived from the label (or the old-format prefix) */
  kind: ClaudeLimitKind;
  /** The raw label, e.g. "session limit" (new format) or "5-hour" / "" (old format) */
  label: string;
  /** Reset time string as printed, e.g. "3pm (Europe/Stockholm)"; undefined if not printed */
  resetTime?: string;
  /**
   * Rate-limit window: 'session' (5-hour) or 'weekly' (7-day, incl. per-model weekly limits).
   * Undefined when the label doesn't say; callers fall back to classifying the reset string.
   */
  window?: 'session' | 'weekly';
  /** Which message format matched */
  format: 'hit-your' | 'limit-reached';
}

// CSI / OSC escape sequences — terminal output may carry colour codes inside the line
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally strips ANSI escapes
const ANSI_PATTERN = /\x1b\[[?!>]?[0-9;]*[a-zA-Z]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g;

/** "You've hit your <label>" — label runs until the first " · " separator or end of line */
const HIT_YOUR_PATTERN = /You(?:'|’)ve hit your ([^\n·•∙]+?)[ \t]*(?=[·•∙]|\r?\n|$)([^\n]*)/m;

/** " · resets <time>" or " · your <label> resets <time>", up to the next separator / EOL */
const RESETS_SUFFIX_PATTERN = /[·•∙]\s*(?:your\s+[^\n·•∙]*?\s+)?resets\s+([^\n·•∙]+)/i;

/** Old format: "[prefix ]Limit reached · resets <time>" */
const LIMIT_REACHED_PATTERN = /(?:^|[^\w-])((?:[\w-]+[ \t]+)?)limit reached\s*[·•∙]\s*resets\s+([^\n·•∙]+)/im;

/** Labels that are not account usage limits a profile switch would help with */
const IGNORED_LABELS = /^fast limit$/i;

function labelToKind(label: string): ClaudeLimitKind {
  const l = label.toLowerCase().trim();
  if (l === 'session limit' || l === '5-hour' || l === '5-hour limit' || l === 'session') return 'session';
  if (l === 'weekly limit' || l === 'weekly') return 'weekly';
  if (l.startsWith('opus')) return 'opus';
  if (l.startsWith('sonnet')) return 'sonnet';
  if (l.startsWith('fable')) return 'fable';
  if (l === 'usage credit limit') return 'usage_credit';
  if (l.includes('spend limit') || l.includes('budget') || l.includes('monthly usage limit')) return 'spend';
  return 'unknown';
}

function kindToWindow(kind: ClaudeLimitKind): 'session' | 'weekly' | undefined {
  switch (kind) {
    case 'session':
      return 'session';
    case 'weekly':
    case 'opus':
    case 'sonnet':
    case 'fable':
      return 'weekly';
    default:
      return undefined;
  }
}

function cleanReset(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Parse a Claude Code usage-limit message out of arbitrary CLI / terminal output.
 * Returns null when no limit message is present.
 */
export function parseClaudeLimitMessage(output: string): ClaudeLimitMessage | null {
  if (!output) return null;
  const text = output.replace(ANSI_PATTERN, '');

  const hit = text.match(HIT_YOUR_PATTERN);
  if (hit) {
    const label = hit[1].trim();
    if (!IGNORED_LABELS.test(label)) {
      const kind = labelToKind(label);
      const resetMatch = hit[2]?.match(RESETS_SUFFIX_PATTERN);
      return {
        kind,
        label,
        resetTime: cleanReset(resetMatch?.[1]),
        window: kindToWindow(kind),
        format: 'hit-your',
      };
    }
  }

  const reached = text.match(LIMIT_REACHED_PATTERN);
  if (reached) {
    const label = reached[1].trim();
    const kind = label ? labelToKind(label) : 'unknown';
    return {
      kind,
      label,
      resetTime: cleanReset(reached[2]),
      window: kindToWindow(kind),
      format: 'limit-reached',
    };
  }

  return null;
}
