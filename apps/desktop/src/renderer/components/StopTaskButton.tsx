import { useTranslation } from 'react-i18next';
import { ChevronDown, Loader2, ShieldCheck, Square } from 'lucide-react';

import { stopTask } from '../stores/task-store';
import { useSafeStopStore } from '../stores/safe-stop-store';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';

/**
 * Stop for a running task, with a choice: Safe stop (after the current subtask,
 * so nothing is left half-edited) or Stop now.
 */
export function StopTaskButton({ taskId, size = 'sm', className }: { taskId: string; size?: 'sm' | 'default'; className?: string }) {
  const { t } = useTranslation(['tasks']);
  const safeStopping = useSafeStopStore((s) => !!s.pending[taskId]);
  const requestSafeStop = useSafeStopStore((s) => s.request);
  const icon = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="destructive" size={size} className={className} onClick={(e) => e.stopPropagation()}>
          {safeStopping ? <Loader2 className={`mr-1.5 ${icon} animate-spin`} /> : <Square className={`mr-1.5 ${icon}`} />}
          {safeStopping ? t('stop.stopping') : t('actions.stop')}
          <ChevronDown className={`ml-1 ${icon}`} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        {!safeStopping && (
          <DropdownMenuItem onClick={() => requestSafeStop(taskId)}>
            <ShieldCheck className="mr-2 h-4 w-4" />
            <div>
              <div>{t('stop.safe')}</div>
              <div className="text-xs text-muted-foreground">{t('stop.safeHint')}</div>
            </div>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => stopTask(taskId)}>
          <Square className="mr-2 h-4 w-4" />
          <div>
            <div>{t('stop.now')}</div>
            <div className="text-xs text-muted-foreground">{t('stop.nowHint')}</div>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
