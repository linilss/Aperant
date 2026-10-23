/**
 * Why a task stopped in Review with errors: what the QA report says is wrong
 * (unmet criteria, blocking findings, recommended fixes) plus "Fix with agent",
 * which sends those findings back to the fixer (same path as Request changes).
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Wand2 } from 'lucide-react';

import { buildFixFeedback, parseQaReport, type QaReportSummary } from '../../../shared/utils/qa-report';
import { submitReview } from '../../stores/task-store';
import { Button } from '../ui/button';
import type { Task } from '../../../shared/types';

function FindingList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <ul className="list-disc space-y-1 pl-4 text-sm">
        {items.map((item) => (
          <li key={item} className="break-words">
            {item.replace(/\*\*/g, '')}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TaskFailurePanel({ task }: { task: Task }) {
  const { t } = useTranslation(['tasks']);
  const [summary, setSummary] = useState<QaReportSummary | null>(null);
  const [fixing, setFixing] = useState(false);
  const failed = task.status === 'error' || (task.status === 'human_review' && (task.reviewReason === 'errors' || task.reviewReason === 'qa_rejected'));

  useEffect(() => {
    if (!failed) return;
    let cancelled = false;
    void window.electronAPI.getTaskQaReport(task.id).then((result) => {
      if (!cancelled) setSummary(result.success && result.data ? parseQaReport(result.data) : null);
    });
    return () => {
      cancelled = true;
    };
  }, [failed, task.id, task.updatedAt]);

  if (!failed) return null;
  const hasFindings = !!summary && summary.blocking.length + summary.unmet.length + summary.recommended.length > 0;

  const fix = async () => {
    setFixing(true);
    try {
      const feedback = hasFindings && summary
        ? buildFixFeedback(summary)
        : `${t('tasks:failure.genericFix')}${task.errorMessage ? `\n\nError:\n${task.errorMessage}` : ''}`;
      await submitReview(task.id, false, feedback);
    } finally {
      setFixing(false);
    }
  };

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-destructive">{t('tasks:failure.title')}</p>
          {!hasFindings && (
            <p className="text-xs text-muted-foreground">{t(task.errorMessage ? 'tasks:failure.seeError' : 'tasks:failure.noReport')}</p>
          )}
        </div>
        <Button size="sm" className="shrink-0 gap-1.5" onClick={() => void fix()} disabled={fixing}>
          {fixing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
          {t('tasks:failure.fixWithAgent')}
        </Button>
      </div>
      {summary && (
        <>
          <FindingList title={t('tasks:failure.blocking')} items={summary.blocking} />
          <FindingList title={t('tasks:failure.unmet')} items={summary.unmet} />
          <FindingList title={t('tasks:failure.recommended')} items={summary.recommended} />
        </>
      )}
    </div>
  );
}
