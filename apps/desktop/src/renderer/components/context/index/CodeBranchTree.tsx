import { useMemo } from 'react';
import { AlertCircle, Check, Clock, FileText, Loader2, Minus, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge, type BadgeProps } from '../../ui/badge';
import { Button } from '../../ui/button';
import { cn } from '../../../lib/utils';
import { MiddleTruncate } from '../../ui/middle-truncate';
import type {
  BranchProgressEvent,
  ClaudeDocFile,
  CodeBranch,
  CodeBranchStatus,
  DocPointer,
} from '../../../../shared/types';
import { buildBranchRows, docPathForBranch, pointerCountForBranch } from './branch-utils';

const STATUS_VARIANT: Record<CodeBranchStatus, BadgeProps['variant']> = {
  documented: 'success',
  team: 'info',
  missing: 'muted',
  stale: 'warning',
  over_budget: 'warning',
};

/** Deeper branches stop indenting so names keep room on narrow screens */
const MAX_INDENT_DEPTH = 4;

export function branchRowId(branch: string): string {
  return `code-branch-${branch || 'root'}`;
}

function ProgressIcon({ progress }: { progress: BranchProgressEvent }) {
  const { t } = useTranslation('context');
  const label = t(`index.progress.${progress.status}`, { error: progress.error ?? '' });
  const className = 'h-3.5 w-3.5 shrink-0';
  switch (progress.status) {
    case 'queued':
      return <Clock className={cn(className, 'text-muted-foreground')} aria-label={label} />;
    case 'running':
      return <Loader2 className={cn(className, 'animate-spin text-primary')} aria-label={label} />;
    case 'done':
      return <Check className={cn(className, 'text-success')} aria-label={label} />;
    case 'skipped':
      return <Minus className={cn(className, 'text-muted-foreground')} aria-label={label} />;
    case 'error':
      return <AlertCircle className={cn(className, 'text-destructive')} aria-label={label} />;
  }
}

interface CodeBranchTreeProps {
  branches: CodeBranch[];
  docs: ClaudeDocFile[];
  pointers: DocPointer[];
  progress: Record<string, BranchProgressEvent>;
  optimizerRunning: boolean;
  highlighted: string | null;
  onOpenDoc: (docPath: string) => void;
  onDocument: (branch: string) => void;
}

export function CodeBranchTree({
  branches,
  docs,
  pointers,
  progress,
  optimizerRunning,
  highlighted,
  onOpenDoc,
  onDocument,
}: CodeBranchTreeProps) {
  const { t } = useTranslation('context');
  const rows = useMemo(() => buildBranchRows(branches), [branches]);

  if (rows.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('index.noBranches')}</p>;
  }

  return (
    <ul className="divide-y divide-border">
      {rows.map(({ branch, depth }) => {
        const path = branch.relativePath;
        const name = path.slice(path.lastIndexOf('/') + 1);
        const rowProgress = progress[path];
        const docPath = docPathForBranch(branch, docs);
        const pointerCount = pointerCountForBranch(path, pointers);
        return (
          <li
            key={path || '(root)'}
            id={branchRowId(path)}
            className={cn(
              'group flex items-center gap-3 py-1.5 pr-3 transition-colors hover:bg-muted/40 max-md:gap-2 max-md:pr-1',
              highlighted === path && 'bg-primary/10'
            )}
            style={{ paddingLeft: `${0.75 + Math.min(depth, MAX_INDENT_DEPTH) * 1}rem` }}
          >
            <span className="flex w-4 shrink-0 justify-center">
              {rowProgress ? (
                <span title={t(`index.progress.${rowProgress.status}`, { error: rowProgress.error ?? '' })}>
                  <ProgressIcon progress={rowProgress} />
                </span>
              ) : null}
            </span>

            {path ? (
              <span className="min-w-0 flex-1" title={path}>
                <span className="block truncate font-mono text-sm font-medium text-foreground">{name}</span>
                {path !== name && (
                  <MiddleTruncate text={path} title={path} className="font-mono text-xs text-muted-foreground" />
                )}
              </span>
            ) : (
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{t('index.root')}</span>
            )}

            <Badge
              variant={STATUS_VARIANT[branch.status]}
              className="shrink-0 text-[11px] max-md:text-xs"
              title={t(`index.statusHint.${branch.status}`)}
            >
              {t(`index.status.${branch.status}`)}
            </Badge>

            <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground max-md:hidden">
              {t('index.files', { count: branch.sourceFileCount })}
            </span>
            <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground max-md:hidden">
              {pointerCount > 0 ? t('index.pointers', { count: pointerCount }) : ''}
            </span>

            <span className="flex shrink-0 gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 max-md:h-10 max-md:min-w-10"
                disabled={!docPath}
                onClick={() => docPath && onOpenDoc(docPath)}
                title={t('index.openDoc')}
                aria-label={t('index.openDoc')}
              >
                <FileText className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 max-md:h-10 max-md:min-w-10"
                disabled={optimizerRunning}
                onClick={() => onDocument(path)}
                title={t('index.documentBranch')}
                aria-label={t('index.documentBranch')}
              >
                <Sparkles className="h-3.5 w-3.5" />
              </Button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
