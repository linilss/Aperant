import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import type { TestStatus } from '../../../shared/types/tests';

interface TestStatusBadgeProps {
  status: TestStatus;
  className?: string;
}

const STATUS_STYLES: Record<TestStatus, string> = {
  passed: 'bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30',
  failed: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30',
  skipped: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30',
  running: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30',
  unknown: 'bg-muted text-muted-foreground border-border',
};

const STATUS_DOTS: Record<TestStatus, string> = {
  passed: 'bg-green-500',
  failed: 'bg-red-500',
  skipped: 'bg-yellow-500',
  running: 'bg-blue-500 animate-pulse',
  unknown: 'bg-muted-foreground',
};

export function TestStatusBadge({ status, className }: TestStatusBadgeProps) {
  const { t } = useTranslation('tests');

  const labelKey =
    status === 'unknown' ? 'status.notRun' : `status.${status}` as const;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
        STATUS_STYLES[status],
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOTS[status])} />
      {t(labelKey)}
    </span>
  );
}
