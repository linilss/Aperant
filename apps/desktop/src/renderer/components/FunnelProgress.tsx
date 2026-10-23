import { useTranslation } from 'react-i18next';
import { CheckCircle2, Circle } from 'lucide-react';
import { cn } from '../lib/utils';
import type { FunnelProgress, FunnelStep } from '../../shared/types';

interface FunnelBarProps {
  progress: FunnelProgress | undefined;
  className?: string;
}

/**
 * Thin progress track (border grey) with the funnel's completed share filled in
 * the theme accent; turns green when every step is done. Height comes from
 * `className` (e.g. `h-0.5 group-hover:h-[3px]`).
 */
export function FunnelBar({ progress, className }: FunnelBarProps) {
  const { t } = useTranslation('common');
  const completed = progress?.completed ?? 0;
  const total = progress?.total ?? 0;
  const ratio = total > 0 ? completed / total : 0;
  const complete = total > 0 && completed === total;

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={completed}
      aria-label={t('funnel.ariaLabel', { completed, total })}
      className={cn('relative w-full overflow-hidden bg-border transition-[height] duration-150', className)}
    >
      <div
        className={cn(
          'absolute inset-y-0 left-0 transition-[width,background-color] duration-300',
          complete ? 'bg-success' : 'bg-primary'
        )}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  );
}

function stepDetail(step: FunnelStep, t: (key: string, opts?: Record<string, unknown>) => string): string | null {
  if (!step.detail || !step.done) return null;
  if (step.id === 'competitors' || step.id === 'roadmap' || step.id === 'ideation') {
    return t(`funnel.detail.${step.id}`, { count: Number(step.detail) });
  }
  if (step.id === 'design') return step.detail;
  return null;
}

/** "Funnel 4/6" heading + the six steps checked/unchecked (tab tooltip) */
export function FunnelStepList({ progress }: { progress: FunnelProgress }) {
  const { t } = useTranslation('common');
  const complete = progress.completed === progress.total;
  return (
    <div className="min-w-[11rem] space-y-1.5">
      <p className="flex items-center justify-between gap-3 text-xs font-semibold">
        <span>{t('funnel.title', { completed: progress.completed, total: progress.total })}</span>
        {complete && <span className="font-medium text-success">{t('funnel.complete')}</span>}
      </p>
      <ul className="space-y-1">
        {progress.steps.map((step) => {
          const detail = stepDetail(step, t);
          return (
            <li key={step.id} className="flex items-center gap-2 text-xs">
              {step.done ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
              ) : (
                <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
              )}
              <span className={cn(!step.done && 'text-muted-foreground')}>{t(`funnel.steps.${step.id}`)}</span>
              {detail && <span className="ml-auto truncate pl-2 text-[11px] text-muted-foreground">{detail}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
