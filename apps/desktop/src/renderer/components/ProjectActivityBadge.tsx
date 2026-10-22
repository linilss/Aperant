import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { cn } from '../lib/utils';
import type { ProjectActivity } from '../../shared/types';

/** Spinner while something runs in the project, a count while tasks wait for the user */
export function ProjectActivityBadge({ activity, className }: { activity?: ProjectActivity; className?: string }) {
  const { t } = useTranslation('common');
  if (!activity || (activity.running === 0 && activity.needsYou === 0)) return null;
  return (
    <span className={cn('flex shrink-0 items-center gap-1', className)}>
      {activity.running > 0 && (
        <Loader2
          className="h-3 w-3 animate-spin text-primary"
          aria-label={t('projectActivity.running', { count: activity.running })}
        >
          <title>{t('projectActivity.running', { count: activity.running })}</title>
        </Loader2>
      )}
      {activity.needsYou > 0 && (
        <span
          role="img"
          className="rounded-full bg-warning/20 px-1.5 text-[10px] font-semibold leading-4 tabular-nums text-warning"
          title={t('projectActivity.needsYou', { count: activity.needsYou })}
          aria-label={t('projectActivity.needsYou', { count: activity.needsYou })}
        >
          {activity.needsYou}
        </span>
      )}
    </span>
  );
}
