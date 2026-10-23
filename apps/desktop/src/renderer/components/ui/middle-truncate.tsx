import { cn } from '../../lib/utils';

/** Longest tail kept intact; longer tails keep only their last TAIL_FALLBACK characters */
const MAX_TAIL = 28;
const TAIL_FALLBACK = 16;

/**
 * Splits a path into a head (may be cut) and a tail that always stays visible.
 * The tail is the last path segment (with its slash) when short enough, otherwise its last characters.
 */
export function splitForMiddleTruncate(text: string): { head: string; tail: string } {
  const slash = text.lastIndexOf('/');
  const tailStart =
    slash > 0 && text.length - slash <= MAX_TAIL ? slash : Math.max(0, text.length - TAIL_FALLBACK);
  return { head: text.slice(0, tailStart), tail: text.slice(tailStart) };
}

interface MiddleTruncateProps {
  text: string;
  className?: string;
  /** Tooltip; defaults to the full text */
  title?: string;
}

/**
 * Single-line text that ellipsizes in the middle ("apps/desk…/CLAUDE.md"): the head is
 * CSS-truncated while the tail stays visible. Pure CSS, so it reacts to any container width.
 */
export function MiddleTruncate({ text, className, title }: MiddleTruncateProps) {
  const { head, tail } = splitForMiddleTruncate(text);
  return (
    <span className={cn('flex min-w-0 whitespace-nowrap', className)} title={title ?? text}>
      {head && <span className="min-w-0 truncate">{head}</span>}
      <span className={cn(head ? 'shrink-0' : 'min-w-0 truncate')}>{tail}</span>
    </span>
  );
}
