import { useMemo, useState } from 'react';
import { Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { cn } from '../../../lib/utils';
import type { DocProposal, ProjectSummary } from '../../../../shared/types';
import { ProjectSummaryContent } from '../index/ProjectSummaryCard';
import { sideBySideDiff, type DiffCell } from './line-diff';

/** Path of the project summary proposal (relative to .malvy/docs) */
const PROJECT_SUMMARY_PATH = 'project_summary.json';

function parseSummary(content: string): ProjectSummary | null {
  try {
    const parsed = JSON.parse(content) as ProjectSummary;
    return parsed && typeof parsed.overview === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

interface ProposalReviewProps {
  proposals: DocProposal[];
  onApprove: (proposals: DocProposal[]) => Promise<void>;
  onReject: (path: string) => void;
  onClose: () => void;
  error: string | null;
}

function Cell({ cell }: { cell: DiffCell | null }) {
  return (
    <div
      className={cn(
        'flex min-h-[1.25rem] gap-2 px-2',
        cell?.kind === 'removed' && 'bg-destructive/10 text-destructive',
        cell?.kind === 'added' && 'bg-success/10 text-success',
        !cell && 'bg-muted/30'
      )}
    >
      <span className="w-8 shrink-0 select-none text-right text-muted-foreground/60">{cell?.lineNo ?? ''}</span>
      <span className="whitespace-pre-wrap break-all">{cell?.text ?? ''}</span>
    </div>
  );
}

function ProposalCard({
  proposal,
  busy,
  onApprove,
  onReject,
}: {
  proposal: DocProposal;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const { t } = useTranslation('context');
  const after = proposal.action === 'delete' ? '' : proposal.content;
  const rows = useMemo(() => sideBySideDiff(proposal.before, after), [proposal.before, after]);
  const summary = useMemo(
    () => (proposal.path === PROJECT_SUMMARY_PATH ? parseSummary(proposal.content) : null),
    [proposal.path, proposal.content]
  );

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 max-md:flex-wrap max-md:px-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant={proposal.action === 'delete' ? 'destructive' : 'outline'} className="text-xs">
              {t(`review.actions.${proposal.action}`)}
            </Badge>
            {summary && (
              <Badge variant="info" className="text-xs">
                {t('review.summaryItem')}
              </Badge>
            )}
            <span className="truncate font-mono text-sm">.malvy/docs/{proposal.path}</span>
          </div>
          {proposal.reason && <p className="text-xs text-muted-foreground">{proposal.reason}</p>}
          {proposal.appliedPointerIds.length > 0 && (
            <p className="text-xs text-primary">
              👉 {t('review.pointersApplied', { count: proposal.appliedPointerIds.length })}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={onReject} disabled={busy}>
            <X className="mr-1 h-3.5 w-3.5" />
            {t('review.reject')}
          </Button>
          <Button size="sm" onClick={onApprove} disabled={busy}>
            <Check className="mr-1 h-3.5 w-3.5" />
            {t('review.approve')}
          </Button>
        </div>
      </div>
      {summary ? (
        <div className="p-4">
          <ProjectSummaryContent summary={summary} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 border-b border-border text-xs font-medium text-muted-foreground">
            <div className="px-4 py-1.5">{t('review.before')}</div>
            <div className="border-l border-border px-4 py-1.5">{t('review.after')}</div>
          </div>
          <div className="max-h-96 overflow-auto font-mono text-xs leading-5">
            {rows.length === 0 ? (
              <p className="px-4 py-2 text-muted-foreground">{t('review.empty')}</p>
            ) : (
              rows.map((row) => (
                <div key={`${row.left?.lineNo ?? '-'}:${row.right?.lineNo ?? '-'}`} className="grid grid-cols-2">
                  <Cell cell={row.left} />
                  <div className="border-l border-border">
                    <Cell cell={row.right} />
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Per-file review of optimizer proposals with side-by-side diffs */
export function ProposalReview({ proposals, onApprove, onReject, onClose, error }: ProposalReviewProps) {
  const { t } = useTranslation('context');
  const [busy, setBusy] = useState(false);

  const approve = async (items: DocProposal[]) => {
    setBusy(true);
    try {
      await onApprove(items);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 p-6 max-md:p-4">
      <div className="flex items-center justify-between gap-3 max-md:flex-wrap">
        <div>
          <h3 className="text-base font-semibold text-foreground">{t('review.title')}</h3>
          <p className="text-xs text-muted-foreground">{t('review.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            {t('review.close')}
          </Button>
          <Button size="sm" onClick={() => approve(proposals)} disabled={busy || proposals.length === 0}>
            <Check className="mr-1 h-3.5 w-3.5" />
            {t('review.approveAll')}
          </Button>
        </div>
      </div>
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      {proposals.map((proposal) => (
        <ProposalCard
          key={proposal.path}
          proposal={proposal}
          busy={busy}
          onApprove={() => approve([proposal])}
          onReject={() => onReject(proposal.path)}
        />
      ))}
    </div>
  );
}
