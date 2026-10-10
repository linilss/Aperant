import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Sparkles, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '../../lib/utils';
import { loadBranches, startDocsOptimizer, stopDocsOptimizer, useContextStore } from '../../stores/context-store';
import type { ProjectIndex } from '../../../shared/types';
import { branchForPath, documentedCount } from './index/branch-utils';
import { branchRowId, CodeBranchTree } from './index/CodeBranchTree';
import { DetectedStack } from './index/DetectedStack';
import { CoreValuesCard } from './index/CoreValuesCard';
import { ProjectSummaryCard } from './index/ProjectSummaryCard';

interface ProjectIndexTabProps {
  projectId: string;
  projectIndex: ProjectIndex | null;
  indexLoading: boolean;
  indexError: string | null;
  onRefresh: () => void;
  /** "N doc files · M pointers · last optimized <date>" line */
  docsSummary: string;
  /** Open a doc file (project-relative path) in the Docs tab */
  onOpenDoc: (docPath: string) => void;
  /** Switch to the Docs tab to review optimizer proposals */
  onReview: () => void;
}

export function ProjectIndexTab({
  projectId,
  projectIndex,
  indexLoading,
  indexError,
  onRefresh,
  docsSummary,
  onOpenDoc,
  onReview,
}: ProjectIndexTabProps) {
  const { t } = useTranslation('context');
  const branches = useContextStore((s) => s.branches);
  const branchesLoading = useContextStore((s) => s.branchesLoading);
  const docs = useContextStore((s) => s.docs);
  const pointers = useContextStore((s) => s.pointers);
  const projectSummary = useContextStore((s) => s.projectSummary);
  const optimizerRunning = useContextStore((s) => s.optimizerRunning);
  const optimizerError = useContextStore((s) => s.optimizerError);
  const branchProgress = useContextStore((s) => s.branchProgress);
  const proposals = useContextStore((s) => s.proposals);

  const [highlighted, setHighlighted] = useState<string | null>(null);

  // Clear the key-module highlight after a moment
  useEffect(() => {
    if (highlighted === null) return;
    const timer = setTimeout(() => setHighlighted(null), 2000);
    return () => clearTimeout(timer);
  }, [highlighted]);

  const documented = useMemo(() => documentedCount(branches), [branches]);
  const passCounts = useMemo(() => {
    const events = Object.values(branchProgress);
    const finished = events.filter((e) => e.status === 'done' || e.status === 'skipped' || e.status === 'error');
    return { done: finished.length, total: events.length };
  }, [branchProgress]);
  const branchFor = useCallback((path: string) => branchForPath(path, branches), [branches]);

  const showBranch = useCallback((branch: string) => {
    setHighlighted(branch);
    document.getElementById(branchRowId(branch))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const optimizeAll = useCallback(() => startDocsOptimizer(projectId), [projectId]);
  const documentBranch = useCallback(
    (branch: string) =>
      startDocsOptimizer(projectId, branch === '' ? { branches: [], includeRoot: true } : { branches: [branch] }),
    [projectId]
  );

  return (
    <ScrollArea className="h-full" viewportClassName="max-md:[&>div]:!block">
      <div className="space-y-6 p-6 max-md:p-4">
        <p className="text-xs text-muted-foreground">{docsSummary}</p>

        {/* Optimizer status — kept above the summary card so it is visible without scrolling */}
        {optimizerRunning && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 px-4 py-2 text-sm">
            <span className="flex items-center gap-2 text-foreground">
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-primary" />
              {t('index.running', passCounts)}
            </span>
            <Button variant="outline" size="sm" onClick={() => stopDocsOptimizer(projectId)}>
              <Square className="mr-1.5 h-3.5 w-3.5" />
              {t('index.stop')}
            </Button>
          </div>
        )}

        {optimizerError && !optimizerRunning && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            <p className="font-medium">{t('optimizer.failed')}</p>
            <p className="whitespace-pre-line break-words text-xs text-destructive/80">{optimizerError}</p>
          </div>
        )}

        {proposals && proposals.length > 0 && !optimizerRunning && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 px-4 py-2 text-sm">
            <span className="text-foreground">{t('index.reviewReady', { count: proposals.length })}</span>
            <Button size="sm" onClick={onReview}>
              {t('index.review')}
            </Button>
          </div>
        )}

        {proposals && proposals.length === 0 && !optimizerRunning && !optimizerError && (
          <div className="rounded-md border border-border bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
            {t('index.noChanges')}
          </div>
        )}

        <CoreValuesCard projectId={projectId} />

        <ProjectSummaryCard
          summary={projectSummary}
          optimizerRunning={optimizerRunning}
          onOptimize={optimizeAll}
          branchFor={branchFor}
          onShowBranch={showBranch}
        />

        {/* Code branches */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4 max-md:flex-wrap max-md:gap-2">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground">{t('index.title')}</h2>
              <p className="truncate text-xs text-muted-foreground max-md:whitespace-normal">
                {t('index.coverage', { documented, total: branches.length })} · {t('index.subtitle')}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="max-md:h-10 max-md:min-w-10"
                onClick={() => loadBranches(projectId)}
                disabled={branchesLoading}
                title={t('index.rescan')}
                aria-label={t('index.rescan')}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', branchesLoading && 'animate-spin')} />
              </Button>
              {optimizerRunning ? (
                <Button variant="outline" size="sm" className="max-md:h-10" onClick={() => stopDocsOptimizer(projectId)}>
                  <Square className="mr-1.5 h-3.5 w-3.5" />
                  {t('index.stop')}
                </Button>
              ) : (
                <Button size="sm" className="max-md:h-10" onClick={optimizeAll}>
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  {t('index.optimizeAll')}
                </Button>
              )}
            </div>
          </div>

          <Card className="overflow-hidden">
            <CodeBranchTree
              branches={branches}
              docs={docs}
              pointers={pointers}
              progress={branchProgress}
              optimizerRunning={optimizerRunning}
              highlighted={highlighted}
              onOpenDoc={onOpenDoc}
              onDocument={documentBranch}
            />
          </Card>
        </div>

        <DetectedStack
          projectIndex={projectIndex}
          indexLoading={indexLoading}
          indexError={indexError}
          onRefresh={onRefresh}
        />
      </div>
    </ScrollArea>
  );
}
