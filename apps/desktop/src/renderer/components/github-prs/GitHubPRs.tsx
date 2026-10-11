import { useCallback, useEffect, useState } from "react";
import { GitPullRequest, RefreshCw, ExternalLink, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useProjectStore } from "../../stores/project-store";
import { useGitHubPRs, usePRFiltering } from "./hooks";
import { PRList, PRDetail, PRFilterBar } from "./components";
import { Button } from "../ui/button";
import { ResizablePanels } from "../ui/resizable-panels";
import { MobileBackBar } from "../MobileNav";
import { useIsCompact } from "../../hooks/useIsMobile";
import { Badge } from "../ui/badge";
import { PageHeader, PAGE_BODY, PAGE_ROOT, PAGE_STICKY } from "../ui/page-header";
import { cn } from "../../lib/utils";

interface GitHubPRsProps {
  onOpenSettings?: () => void;
  isActive?: boolean;
}

function NotConnectedState({
  error,
  onOpenSettings,
  t,
}: {
  error: string | null;
  onOpenSettings?: () => void;
  t: (key: string) => string;
}) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="text-center max-w-md">
        <GitPullRequest className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
        <h3 className="text-lg font-medium mb-2">{t("prReview.notConnected")}</h3>
        <p className="text-sm text-muted-foreground mb-4">{error || t("prReview.connectPrompt")}</p>
        {onOpenSettings && (
          <Button onClick={onOpenSettings} variant="outline">
            <Settings className="h-4 w-4 mr-2" />
            {t("prReview.openSettings")}
          </Button>
        )}
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center text-muted-foreground">
        <GitPullRequest className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>{message}</p>
      </div>
    </div>
  );
}

export function GitHubPRs({ onOpenSettings, isActive = false }: GitHubPRsProps) {
  const { t } = useTranslation("common");
  // Below lg (phones + narrow desktop): list and detail are shown one at a time
  const isCompact = useIsCompact();
  const [showMobileDetail, setShowMobileDetail] = useState(false);
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId);

  const {
    prs,
    isLoading,
    isLoadingMore,
    isLoadingPRDetails,
    error,
    selectedPRNumber,
    reviewResult,
    reviewProgress,
    startedAt,
    isReviewing,
    isExternalReview,
    previousReviewResult,
    reviewError,
    hasMore,
    selectPR,
    runReview,
    runFollowupReview,
    checkNewCommits,
    cancelReview,
    postReview,
    postComment,
    mergePR,
    assignPR,
    markReviewPosted,
    refresh,
    loadMore,
    isConnected,
    repoFullName,
    getReviewStateForPR,
    selectedPR,
  } = useGitHubPRs(selectedProjectId || undefined, { isActive });

  // Get newCommitsCheck for the selected PR (other values come from hook to ensure consistency)
  const selectedPRReviewState = selectedPRNumber ? getReviewStateForPR(selectedPRNumber) : null;
  const storedNewCommitsCheck = selectedPRReviewState?.newCommitsCheck ?? null;

  // PR filtering
  const {
    filteredPRs,
    contributors,
    filters,
    setSearchQuery,
    setContributors,
    setStatuses,
    setSortBy,
    clearFilters,
    hasActiveFilters,
  } = usePRFiltering(prs, getReviewStateForPR);

  // Sync UI state when PR list updates (e.g., after auto-refresh from review completion)
  // Following pattern from PRDetail.tsx for state syncing
  useEffect(() => {
    // Ensure selected PR is still valid after list updates
    // This prevents stale state if a PR was closed/merged while selected
    if (selectedPRNumber && prs.length > 0) {
      const selectedStillExists = prs.some(pr => pr.number === selectedPRNumber);
      if (!selectedStillExists) {
        // Selected PR was removed/closed, clear selection to prevent stale state
        selectPR(null);
      }
    }
  }, [prs, selectedPRNumber, selectPR]);

  const handleRunReview = useCallback(() => {
    if (selectedPRNumber) {
      runReview(selectedPRNumber);
    }
  }, [selectedPRNumber, runReview]);

  const handleRunFollowupReview = useCallback(() => {
    if (selectedPRNumber) {
      runFollowupReview(selectedPRNumber);
    }
  }, [selectedPRNumber, runFollowupReview]);

  const handleCheckNewCommits = useCallback(async () => {
    if (selectedPRNumber) {
      return await checkNewCommits(selectedPRNumber);
    }
    return { hasNewCommits: false, newCommitCount: 0 };
  }, [selectedPRNumber, checkNewCommits]);

  const handleCancelReview = useCallback(() => {
    if (selectedPRNumber) {
      cancelReview(selectedPRNumber);
    }
  }, [selectedPRNumber, cancelReview]);

  const handlePostReview = useCallback(
    async (
      selectedFindingIds?: string[],
      options?: { forceApprove?: boolean }
    ): Promise<boolean> => {
      if (selectedPRNumber && reviewResult) {
        return await postReview(selectedPRNumber, selectedFindingIds, options);
      }
      return false;
    },
    [selectedPRNumber, reviewResult, postReview]
  );

  const handlePostComment = useCallback(
    async (body: string): Promise<boolean> => {
      if (selectedPRNumber) {
        return await postComment(selectedPRNumber, body);
      }
      return false;
    },
    [selectedPRNumber, postComment]
  );

  const handleMergePR = useCallback(
    async (mergeMethod?: "merge" | "squash" | "rebase") => {
      if (selectedPRNumber) {
        await mergePR(selectedPRNumber, mergeMethod);
      }
    },
    [selectedPRNumber, mergePR]
  );

  const handleAssignPR = useCallback(
    async (username: string) => {
      if (selectedPRNumber) {
        await assignPR(selectedPRNumber, username);
      }
    },
    [selectedPRNumber, assignPR]
  );

  const handleGetLogs = useCallback(async () => {
    if (selectedProjectId && selectedPRNumber) {
      return await window.electronAPI.github.getPRLogs(selectedProjectId, selectedPRNumber);
    }
    return null;
  }, [selectedProjectId, selectedPRNumber]);

  const handleMarkReviewPosted = useCallback(async (prNumber: number) => {
    await markReviewPosted(prNumber);
  }, [markReviewPosted]);

  // Not connected state
  if (!isConnected) {
    return <NotConnectedState error={error} onOpenSettings={onOpenSettings} t={t} />;
  }

  const filterBar = (
    <PRFilterBar
      filters={filters}
      contributors={contributors}
      hasActiveFilters={hasActiveFilters}
      onSearchChange={setSearchQuery}
      onContributorsChange={setContributors}
      onStatusesChange={setStatuses}
      onSortChange={setSortBy}
      onClearFilters={clearFilters}
    />
  );

  const prList = (
    <PRList
      prs={filteredPRs}
      selectedPRNumber={selectedPRNumber}
      isLoading={isLoading}
      hasMore={hasMore}
      error={error}
      getReviewStateForPR={getReviewStateForPR}
      onSelectPR={(prNumber) => {
        selectPR(prNumber);
        setShowMobileDetail(true);
      }}
      onLoadMore={loadMore}
      isLoadingMore={isLoadingMore}
    />
  );

  const leftPanel = (
    <div className="flex flex-col h-full">
      {filterBar}
      {prList}
    </div>
  );

  const rightPanel = selectedPR ? (
      <PRDetail
        pr={selectedPR}
        projectId={selectedProjectId || ""}
        reviewResult={reviewResult}
        previousReviewResult={previousReviewResult}
        reviewProgress={reviewProgress}
        startedAt={startedAt}
        isReviewing={isReviewing}
        isExternalReview={isExternalReview}
        reviewError={reviewError}
        initialNewCommitsCheck={storedNewCommitsCheck}
        isActive={isActive}
        isLoadingFiles={isLoadingPRDetails}
        onRunReview={handleRunReview}
        onRunFollowupReview={handleRunFollowupReview}
        onCheckNewCommits={handleCheckNewCommits}
        onCancelReview={handleCancelReview}
        onPostReview={handlePostReview}
        onPostComment={handlePostComment}
        onMergePR={handleMergePR}
        onAssignPR={handleAssignPR}
        onGetLogs={handleGetLogs}
        onMarkReviewPosted={handleMarkReviewPosted}
      />
    ) : (
      <EmptyState message={t("prReview.selectPRToView")} />
    );

  const header = (
    <PageHeader
      icon={GitPullRequest}
      title={t("prReview.pullRequests")}
      titleAddon={
        <Badge variant="outline" className="shrink-0 text-xs">
          {prs.length} {t("prReview.open")}
        </Badge>
      }
      subtitle={
        repoFullName && (
          <a
            href={`https://github.com/${repoFullName}/pulls`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex max-w-full items-center gap-1 hover:text-foreground"
          >
            <span className="truncate">{repoFullName}</span>
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        )
      }
      actions={[
        {
          id: "refresh",
          label: t("buttons.refresh"),
          icon: RefreshCw,
          iconOnly: true,
          busy: isLoading,
          disabled: isLoading,
          onClick: refresh,
        },
      ]}
    />
  );

  // Below lg: list (with header + pinned filters) or detail (with back bar), one at a time
  if (isCompact) {
    return (
      <div className={PAGE_ROOT}>
        {showMobileDetail ? (
          <>
            <div className={PAGE_STICKY}>
              <MobileBackBar onBack={() => setShowMobileDetail(false)} />
            </div>
            <div className={cn(PAGE_BODY, "flex flex-col")}>{rightPanel}</div>
          </>
        ) : (
          <>
            {header}
            <div className={PAGE_STICKY}>{filterBar}</div>
            <div className={cn(PAGE_BODY, "flex flex-col")}>{prList}</div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={PAGE_ROOT}>
      {header}
      <ResizablePanels
        defaultLeftWidth={50}
        minLeftWidth={30}
        maxLeftWidth={70}
        storageKey="github-prs-panel-width"
        leftPanel={leftPanel}
        rightPanel={rightPanel}
      />
    </div>
  );
}
