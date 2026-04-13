import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  Loader2,
  AlertCircle,
  Settings,
  GitPullRequest,
  ArrowRight,
  ExternalLink,
  Sparkles,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  XCircle,
  MessageCircle,
  AlertTriangle,
  GitMerge,
  ThumbsUp,
} from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import { useProjectStore } from '../stores/project-store';
import { useProjectEnvStore } from '../stores/project-env-store';
import {
  useADOPRReviewStore,
  type AzureDevOpsPullRequest,
  type ADOPRReviewResult,
  type ADOPRReviewFinding,
  type ADOPRReviewProgress,
  type ADOPRNewCommitsCheck,
} from '../stores/azure-devops';

type PRFilterState = 'active' | 'completed' | 'all';

const FILTER_TABS: { label: string; value: PRFilterState }[] = [
  { label: 'Active', value: 'active' },
  { label: 'All', value: 'all' },
  { label: 'Completed', value: 'completed' }
];

export interface AzureDevOpsPRsProps {
  onOpenSettings: () => void;
}

export function AzureDevOpsPRs({ onOpenSettings }: AzureDevOpsPRsProps) {
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId);
  const azureDevOpsEnabled = useProjectEnvStore((state) => state.envConfig?.azureDevOpsEnabled ?? false);
  const reviewStore = useADOPRReviewStore();

  const [pullRequests, setPullRequests] = useState<AzureDevOpsPullRequest[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterState, setFilterState] = useState<PRFilterState>('active');
  const [expandedPRId, setExpandedPRId] = useState<number | null>(null);

  // Per-PR action state: tracks loading and error for post/approve/merge
  const [actionState, setActionState] = useState<Record<number, {
    isPosting?: boolean;
    isApproving?: boolean;
    isMerging?: boolean;
    actionError?: string | null;
    postSuccess?: boolean;
    approveSuccess?: boolean;
    mergeSuccess?: boolean;
  }>>({});

  const setAction = (pullRequestId: number, patch: typeof actionState[number]) => {
    setActionState(prev => ({ ...prev, [pullRequestId]: { ...prev[pullRequestId], ...patch } }));
  };

  const fetchPRs = async (state: PRFilterState) => {
    if (!selectedProjectId) return;
    setIsLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI.getAzureDevOpsPullRequests(selectedProjectId, state);
      if (result.success && result.data) {
        setPullRequests(result.data);
      } else {
        setError(result.error ?? 'Failed to load pull requests');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  // Set up IPC listeners for review events
  useEffect(() => {
    if (!selectedProjectId || !azureDevOpsEnabled) return;

    const cleanupProgress = window.electronAPI.onAzureDevOpsPRReviewProgress(
      (projectId: string, progress: ADOPRReviewProgress) => {
        if (projectId !== selectedProjectId) return;
        reviewStore.setProgress(projectId, progress);
      }
    );

    const cleanupComplete = window.electronAPI.onAzureDevOpsPRReviewComplete(
      (projectId: string, result: ADOPRReviewResult) => {
        if (projectId !== selectedProjectId) return;
        reviewStore.setResult(projectId, result);
      }
    );

    const cleanupError = window.electronAPI.onAzureDevOpsPRReviewError(
      (projectId: string, pullRequestId: number, error: string) => {
        if (projectId !== selectedProjectId) return;
        reviewStore.setError(projectId, pullRequestId, error);
      }
    );

    return () => {
      cleanupProgress();
      cleanupComplete();
      cleanupError();
    };
  }, [selectedProjectId, azureDevOpsEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedProjectId || !azureDevOpsEnabled) return;
    fetchPRs(filterState);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, azureDevOpsEnabled, filterState]);

  if (!azureDevOpsEnabled) {
    return <NotConnectedState onOpenSettings={onOpenSettings} />;
  }

  const handleFilterChange = (state: PRFilterState) => {
    setFilterState(state);
  };

  const handleRefresh = () => {
    fetchPRs(filterState);
  };

  const handleOpenPR = (webUrl: string) => {
    window.electronAPI.openExternal(webUrl);
  };

  const handleToggleExpand = (pullRequestId: number) => {
    setExpandedPRId(prev => prev === pullRequestId ? null : pullRequestId);
  };

  const handleRunReview = useCallback((pullRequestId: number) => {
    if (!selectedProjectId) return;
    reviewStore.startReview(selectedProjectId, pullRequestId);
    window.electronAPI.reviewAzureDevOpsPR(selectedProjectId, pullRequestId);
  }, [selectedProjectId, reviewStore]);

  const handleRunFollowup = useCallback((pullRequestId: number) => {
    if (!selectedProjectId) return;
    reviewStore.startReview(selectedProjectId, pullRequestId);
    window.electronAPI.reviewAzureDevOpsPRFollowup(selectedProjectId, pullRequestId);
  }, [selectedProjectId, reviewStore]);

  const handlePostReview = useCallback(async (pullRequestId: number) => {
    if (!selectedProjectId) return;
    setAction(pullRequestId, { isPosting: true, actionError: null, postSuccess: false });
    const result = await window.electronAPI.postAzureDevOpsPRReview(selectedProjectId, pullRequestId);
    if (result.success) {
      setAction(pullRequestId, { isPosting: false, postSuccess: true });
    } else {
      setAction(pullRequestId, { isPosting: false, actionError: result.error ?? 'Failed to post review' });
    }
  }, [selectedProjectId]);

  const handleApprove = useCallback(async (pullRequestId: number) => {
    if (!selectedProjectId) return;
    setAction(pullRequestId, { isApproving: true, actionError: null, approveSuccess: false });
    const result = await window.electronAPI.approveAzureDevOpsPR(selectedProjectId, pullRequestId, 10);
    if (result.success) {
      setAction(pullRequestId, { isApproving: false, approveSuccess: true });
    } else {
      setAction(pullRequestId, { isApproving: false, actionError: result.error ?? 'Failed to approve PR' });
    }
  }, [selectedProjectId]);

  const handleMerge = useCallback(async (pullRequestId: number) => {
    if (!selectedProjectId) return;
    setAction(pullRequestId, { isMerging: true, actionError: null, mergeSuccess: false });
    const result = await window.electronAPI.mergeAzureDevOpsPR(selectedProjectId, pullRequestId);
    if (result.success) {
      setAction(pullRequestId, { isMerging: false, mergeSuccess: true });
      // Refresh PR list so completed PR moves to correct filter tab
      await fetchPRs(filterState);
    } else {
      setAction(pullRequestId, { isMerging: false, actionError: result.error ?? 'Failed to merge PR' });
    }
  }, [selectedProjectId, filterState]);

  const filteredPRs = filterState === 'all'
    ? pullRequests
    : pullRequests.filter((pr) => pr.status === filterState);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <GitPullRequest className="h-5 w-5 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold">Azure DevOps Pull Requests</h2>
            <p className="text-xs text-muted-foreground">
              {filteredPRs.length} {filterState === 'all' ? 'total' : filterState}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={isLoading}
            aria-label="Refresh"
          >
            <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenSettings}
            aria-label="Open settings"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-border shrink-0">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => handleFilterChange(tab.value)}
            className={cn(
              'px-3 py-1 rounded-md text-xs font-medium transition-colors',
              filterState === tab.value
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && filteredPRs.length === 0 ? (
          <LoadingState />
        ) : error ? (
          <ErrorState error={error} onRetry={handleRefresh} />
        ) : filteredPRs.length === 0 ? (
          <EmptyState filterState={filterState} />
        ) : (
          <ul className="divide-y divide-border">
            {filteredPRs.map((pr) => (
              <PRRow
                key={pr.pullRequestId}
                pr={pr}
                projectId={selectedProjectId ?? ''}
                isExpanded={expandedPRId === pr.pullRequestId}
                onToggleExpand={() => handleToggleExpand(pr.pullRequestId)}
                onOpen={() => handleOpenPR(pr.webUrl)}
                onRunReview={() => handleRunReview(pr.pullRequestId)}
                onRunFollowup={() => handleRunFollowup(pr.pullRequestId)}
                onPostReview={() => handlePostReview(pr.pullRequestId)}
                onApprove={() => handleApprove(pr.pullRequestId)}
                onMerge={() => handleMerge(pr.pullRequestId)}
                actionState={actionState[pr.pullRequestId] ?? {}}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// --- Sub-components ---

interface PRActionState {
  isPosting?: boolean;
  isApproving?: boolean;
  isMerging?: boolean;
  actionError?: string | null;
  postSuccess?: boolean;
  approveSuccess?: boolean;
  mergeSuccess?: boolean;
}

interface PRRowProps {
  pr: AzureDevOpsPullRequest;
  projectId: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onOpen: () => void;
  onRunReview: () => void;
  onRunFollowup: () => void;
  onPostReview: () => void;
  onApprove: () => void;
  onMerge: () => void;
  actionState: PRActionState;
}

function PRRow({
  pr,
  projectId,
  isExpanded,
  onToggleExpand,
  onOpen,
  onRunReview,
  onRunFollowup,
  onPostReview,
  onApprove,
  onMerge,
  actionState,
}: PRRowProps) {
  const reviewEntry = useADOPRReviewStore(state => state.getReview(projectId, pr.pullRequestId));

  return (
    <li>
      {/* Row header — clickable to expand */}
      <button
        type="button"
        onClick={onToggleExpand}
        className="w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50 group"
      >
        <GitPullRequest className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <span className="text-sm font-medium leading-snug">{pr.title}</span>
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Review verdict badge if available */}
              {reviewEntry?.result && !reviewEntry.isReviewing && (
                <ReviewVerdictBadge overallStatus={reviewEntry.result.overallStatus} />
              )}
              {/* Reviewing spinner */}
              {reviewEntry?.isReviewing && (
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-blue-500/10 text-blue-500 border border-blue-500/20">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Reviewing
                </span>
              )}
              <PRStatusBadge status={pr.status} />
              {/* External link icon — stops propagation so it doesn't toggle expand */}
              <span
                role="button"
                tabIndex={0}
                aria-label="Open in browser"
                onClick={(e) => { e.stopPropagation(); onOpen(); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onOpen(); } }}
                className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </span>
              {isExpanded
                ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
            </div>
          </div>

          {/* Branch info */}
          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-mono truncate max-w-[120px]">{stripRefPrefix(pr.sourceBranch)}</span>
            <ArrowRight className="h-3 w-3 shrink-0" />
            <span className="font-mono truncate max-w-[120px]">{stripRefPrefix(pr.targetBranch)}</span>
          </div>

          {/* Meta */}
          <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
            <span>#{pr.pullRequestId}</span>
            <span>{pr.repositoryName}</span>
            <span>by {pr.createdBy}</span>
            <span>{formatDate(pr.creationDate)}</span>
            {pr.reviewers.length > 0 && (
              <span>{pr.reviewers.length} reviewer{pr.reviewers.length !== 1 ? 's' : ''}</span>
            )}
          </div>
        </div>
      </button>

      {/* Expanded detail panel */}
      {isExpanded && (
        <PRDetailPanel
          pr={pr}
          reviewEntry={reviewEntry}
          onRunReview={onRunReview}
          onRunFollowup={onRunFollowup}
          onPostReview={onPostReview}
          onApprove={onApprove}
          onMerge={onMerge}
          actionState={actionState}
        />
      )}
    </li>
  );
}

interface PRDetailPanelProps {
  pr: AzureDevOpsPullRequest;
  reviewEntry: {
    pullRequestId: number;
    isReviewing: boolean;
    progress: ADOPRReviewProgress | null;
    result: ADOPRReviewResult | null;
    error: string | null;
    newCommitsCheck: ADOPRNewCommitsCheck | null;
  } | null;
  onRunReview: () => void;
  onRunFollowup: () => void;
  onPostReview: () => void;
  onApprove: () => void;
  onMerge: () => void;
  actionState: PRActionState;
}

function PRDetailPanel({
  pr,
  reviewEntry,
  onRunReview,
  onRunFollowup,
  onPostReview,
  onApprove,
  onMerge,
  actionState,
}: PRDetailPanelProps) {
  const isReviewing = reviewEntry?.isReviewing ?? false;
  const progress = reviewEntry?.progress ?? null;
  const result = reviewEntry?.result ?? null;
  const reviewError = reviewEntry?.error ?? null;
  const newCommitsCheck = reviewEntry?.newCommitsCheck ?? null;

  return (
    <div className="border-t border-border bg-muted/30 px-4 py-4 space-y-4">
      {/* PR description */}
      {pr.description && (
        <div>
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">{pr.description}</p>
        </div>
      )}

      {/* New commits warning */}
      {newCommitsCheck?.hasNewCommits && result && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          <div className="flex items-center gap-2 text-xs text-amber-600">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>
              {newCommitsCheck.commitCount} new commit{newCommitsCheck.commitCount !== 1 ? 's' : ''} since last review
              {newCommitsCheck.latestCommitMessage && `: "${newCommitsCheck.latestCommitMessage}"`}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onRunFollowup}
            disabled={isReviewing}
            className="h-6 text-xs shrink-0 border-amber-500/30 hover:bg-amber-500/10"
          >
            Run Follow-up
          </Button>
        </div>
      )}

      {/* Review section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">AI Review</h3>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5">
            {!isReviewing && !result && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRunReview}
                className="h-7 text-xs gap-1.5"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Run AI Review
              </Button>
            )}
            {result && !isReviewing && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onPostReview}
                  disabled={result.hasPostedFindings || actionState.postSuccess || actionState.isPosting}
                  className="h-7 text-xs gap-1.5"
                  title={result.hasPostedFindings || actionState.postSuccess ? 'Review already posted' : 'Post review findings to PR'}
                >
                  {actionState.isPosting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (result.hasPostedFindings || actionState.postSuccess) ? (
                    <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <MessageCircle className="h-3.5 w-3.5" />
                  )}
                  {result.hasPostedFindings || actionState.postSuccess ? 'Posted' : 'Post Review'}
                </Button>
                {pr.status === 'active' && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onApprove}
                      disabled={actionState.isApproving || actionState.approveSuccess}
                      className="h-7 text-xs gap-1.5"
                    >
                      {actionState.isApproving ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : actionState.approveSuccess ? (
                        <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <ThumbsUp className="h-3.5 w-3.5" />
                      )}
                      {actionState.approveSuccess ? 'Approved' : 'Approve'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onMerge}
                      disabled={actionState.isMerging || actionState.mergeSuccess}
                      className="h-7 text-xs gap-1.5"
                    >
                      {actionState.isMerging ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : actionState.mergeSuccess ? (
                        <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <GitMerge className="h-3.5 w-3.5" />
                      )}
                      {actionState.mergeSuccess ? 'Merged' : 'Merge'}
                    </Button>
                  </>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onRunReview}
                  className="h-7 text-xs gap-1.5"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Re-review
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Action error */}
        {actionState.actionError && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
            <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
            <p className="text-xs text-destructive">{actionState.actionError}</p>
          </div>
        )}

        {/* Reviewing progress */}
        {isReviewing && (
          <ReviewProgress progress={progress} />
        )}

        {/* Review error */}
        {reviewError && !isReviewing && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
            <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
            <p className="text-xs text-destructive">{reviewError}</p>
          </div>
        )}

        {/* Review result */}
        {result && !isReviewing && (
          <ReviewResult result={result} />
        )}

        {/* No review yet */}
        {!result && !isReviewing && !reviewError && (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <Sparkles className="h-8 w-8 text-muted-foreground/30 mb-2" />
            <p className="text-xs text-muted-foreground">No AI review yet. Click "Run AI Review" to analyze this PR.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewProgress({ progress }: { progress: ADOPRReviewProgress | null }) {
  const phaseLabels: Record<ADOPRReviewProgress['phase'], string> = {
    fetching: 'Fetching PR data',
    analyzing: 'Analyzing changes',
    generating: 'Generating review',
    complete: 'Complete',
  };

  const progressValue = progress?.progress ?? 0;
  const label = progress ? phaseLabels[progress.phase] : 'Starting...';
  const message = progress?.message ?? '';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-muted-foreground">{Math.round(progressValue)}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${progressValue}%` }}
        />
      </div>
      {message && (
        <p className="text-xs text-muted-foreground truncate">{message}</p>
      )}
    </div>
  );
}

function ReviewResult({ result }: { result: ADOPRReviewResult }) {
  const [showAllFindings, setShowAllFindings] = useState(false);

  const criticalAndHigh = result.findings.filter(f => f.severity === 'critical' || f.severity === 'high');
  const others = result.findings.filter(f => f.severity !== 'critical' && f.severity !== 'high');
  const visibleFindings = showAllFindings ? result.findings : [...criticalAndHigh, ...others.slice(0, 3 - criticalAndHigh.length)].slice(0, 5);
  const hasMore = result.findings.length > visibleFindings.length;

  return (
    <div className="space-y-3">
      {/* Verdict */}
      <div className="rounded-md border border-border bg-background px-3 py-2.5 space-y-1.5">
        <div className="flex items-center gap-2">
          <ReviewVerdictBadge overallStatus={result.overallStatus} size="md" />
          <span className="text-xs font-medium">{result.verdict}</span>
        </div>
        {result.verdictReasoning && (
          <p className="text-xs text-muted-foreground leading-relaxed">{result.verdictReasoning}</p>
        )}
      </div>

      {/* Summary */}
      {result.summary && (
        <p className="text-xs text-muted-foreground leading-relaxed">{result.summary}</p>
      )}

      {/* Findings */}
      {result.findings.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">
            Findings ({result.findings.length})
          </h4>
          <ul className="space-y-1.5">
            {visibleFindings.map((finding) => (
              <FindingRow key={finding.id} finding={finding} />
            ))}
          </ul>
          {hasMore && (
            <button
              type="button"
              onClick={() => setShowAllFindings(true)}
              className="text-xs text-primary hover:underline"
            >
              Show {result.findings.length - visibleFindings.length} more finding{result.findings.length - visibleFindings.length !== 1 ? 's' : ''}
            </button>
          )}
          {showAllFindings && result.findings.length > 5 && (
            <button
              type="button"
              onClick={() => setShowAllFindings(false)}
              className="text-xs text-primary hover:underline"
            >
              Show fewer
            </button>
          )}
        </div>
      )}

      {result.findings.length === 0 && (
        <div className="flex items-center gap-2 text-xs text-green-600">
          <CheckCircle className="h-3.5 w-3.5" />
          <span>No findings — looks good!</span>
        </div>
      )}
    </div>
  );
}

function FindingRow({ finding }: { finding: ADOPRReviewFinding }) {
  const severityConfig: Record<ADOPRReviewFinding['severity'], { className: string; label: string }> = {
    critical: { className: 'bg-red-500/10 text-red-600 border-red-500/20', label: 'Critical' },
    high:     { className: 'bg-orange-500/10 text-orange-600 border-orange-500/20', label: 'High' },
    medium:   { className: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20', label: 'Medium' },
    low:      { className: 'bg-muted text-muted-foreground border-border', label: 'Low' },
  };

  const { className, label } = severityConfig[finding.severity];

  return (
    <li className="rounded-md border border-border bg-background px-3 py-2 space-y-1">
      <div className="flex items-start gap-2">
        <span className={cn('inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium border shrink-0 mt-0.5', className)}>
          {label}
        </span>
        <span className="text-xs font-medium leading-snug">{finding.title}</span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{finding.description}</p>
      <p className="text-[10px] font-mono text-muted-foreground">
        {finding.file}:{finding.line}
      </p>
      {finding.suggestedFix && (
        <p className="text-xs text-muted-foreground italic">{finding.suggestedFix}</p>
      )}
    </li>
  );
}

function ReviewVerdictBadge({
  overallStatus,
  size = 'sm',
}: {
  overallStatus: ADOPRReviewResult['overallStatus'];
  size?: 'sm' | 'md';
}) {
  const config: Record<ADOPRReviewResult['overallStatus'], { label: string; className: string; icon: React.ReactNode }> = {
    approve: {
      label: 'Approve',
      className: 'bg-green-500/10 text-green-600 border-green-500/20',
      icon: <CheckCircle className="h-3 w-3" />,
    },
    request_changes: {
      label: 'Changes Requested',
      className: 'bg-red-500/10 text-red-600 border-red-500/20',
      icon: <XCircle className="h-3 w-3" />,
    },
    comment: {
      label: 'Comment',
      className: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
      icon: <MessageCircle className="h-3 w-3" />,
    },
  };

  const { label, className, icon } = config[overallStatus];
  const textSize = size === 'sm' ? 'text-[10px]' : 'text-xs';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium border',
        textSize,
        className
      )}
    >
      {icon}
      {label}
    </span>
  );
}

function PRStatusBadge({ status }: { status: AzureDevOpsPullRequest['status'] }) {
  const config: Record<AzureDevOpsPullRequest['status'], { label: string; className: string }> = {
    active: {
      label: 'Active',
      className: 'bg-green-500/10 text-green-600 border-green-500/20'
    },
    completed: {
      label: 'Completed',
      className: 'bg-blue-500/10 text-blue-500 border-blue-500/20'
    },
    abandoned: {
      label: 'Abandoned',
      className: 'bg-muted text-muted-foreground border-border'
    }
  };

  const { label, className } = config[status];

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border',
        className
      )}
    >
      {label}
    </span>
  );
}

function NotConnectedState({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
      <GitPullRequest className="h-12 w-12 text-muted-foreground/40" />
      <div className="space-y-1">
        <p className="text-sm font-medium">Azure DevOps not connected</p>
        <p className="text-xs text-muted-foreground">
          Enable the Azure DevOps integration in settings to view pull requests.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onOpenSettings} className="gap-2">
        <Settings className="h-3.5 w-3.5" />
        Open Settings
      </Button>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 px-8 text-center">
      <AlertCircle className="h-8 w-8 text-destructive" />
      <p className="text-sm text-destructive">{error}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function EmptyState({ filterState }: { filterState: PRFilterState }) {
  const messages: Record<PRFilterState, string> = {
    active: 'No active pull requests found.',
    completed: 'No completed pull requests found.',
    all: 'No pull requests found.'
  };

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-8">
      <GitPullRequest className="h-8 w-8 text-muted-foreground/40 mb-3" />
      <p className="text-sm text-muted-foreground">{messages[filterState]}</p>
    </div>
  );
}

/** Strip the Azure DevOps `refs/heads/` prefix from branch names. */
function stripRefPrefix(branch: string): string {
  return branch.replace(/^refs\/heads\//, '');
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
