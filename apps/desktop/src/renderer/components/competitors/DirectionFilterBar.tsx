import { useTranslation } from 'react-i18next';
import { Compass } from 'lucide-react';
import { cn } from '../../lib/utils';
import { DirectionTag } from './DirectionTagChips';
import { UNTAGGED_FILTER, toggleDirectionFilter } from '../moscow/direction-filter';
import type { StrategicDirection } from '../../../shared/types/competitors';

interface DirectionFilterBarProps {
  directions: StrategicDirection[];
  /** Selected direction ids / UNTAGGED_FILTER; empty = all directions */
  selected: string[];
  onChange: (selected: string[]) => void;
  /** At least one item carries direction tags */
  isTagged: boolean;
  /** Shown instead of the filter when directions exist but nothing is tagged yet */
  untaggedHint: string;
  ariaLabel: string;
  className?: string;
}

const chipClass = (active: boolean) =>
  cn(
    'inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs transition-colors',
    active
      ? 'border-primary bg-primary/10 text-primary'
      : 'border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground'
  );

/**
 * Direction filter chips (All / each ranked direction / Untagged), shared by
 * MoSCoW and Ideation. Renders a subtle hint when nothing is tagged yet and
 * nothing at all when the project has no directions.
 */
export function DirectionFilterBar({
  directions,
  selected,
  onChange,
  isTagged,
  untaggedHint,
  ariaLabel,
  className,
}: DirectionFilterBarProps) {
  const { t } = useTranslation('common');
  if (directions.length === 0) return null;

  if (!isTagged) {
    return (
      <p className={cn('flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground', className)}>
        <Compass className="h-3.5 w-3.5 shrink-0" />
        {untaggedHint}
      </p>
    );
  }

  return (
    <div
      role="toolbar"
      aria-label={ariaLabel}
      className={cn('flex shrink-0 items-center gap-1.5 overflow-x-auto', className)}
    >
      <button
        type="button"
        aria-pressed={selected.length === 0}
        onClick={() => onChange([])}
        className={chipClass(selected.length === 0)}
      >
        {t('roadmap.moscow.directions.all')}
      </button>
      {directions.map((direction, i) => {
        const active = selected.includes(direction.id);
        return (
          <button
            key={direction.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(toggleDirectionFilter(selected, direction.id))}
            className={cn('rounded-full', active && 'ring-2 ring-primary ring-offset-1 ring-offset-background')}
          >
            <DirectionTag direction={direction} rank={i + 1} className="py-0.5 text-xs" />
          </button>
        );
      })}
      <button
        type="button"
        aria-pressed={selected.includes(UNTAGGED_FILTER)}
        onClick={() => onChange(toggleDirectionFilter(selected, UNTAGGED_FILTER))}
        className={chipClass(selected.includes(UNTAGGED_FILTER))}
      >
        {t('roadmap.moscow.directions.untagged')}
      </button>
    </div>
  );
}
