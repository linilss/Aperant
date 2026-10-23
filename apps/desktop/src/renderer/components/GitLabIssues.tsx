import { useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useProjectStore } from "../stores/project-store";
import { useTaskStore } from "../stores/task-store";
import { useGitLabIssues, useGitLabInvestigation, useIssueFiltering } from "./gitlab-issues/hooks";
import {
  NotConnectedState,
  EmptyState,
  IssueListHeader,
  IssueList,
  IssueDetail,
  InvestigationDialog,
} from "./gitlab-issues/components";
import type { GitLabIssue } from "../../shared/types";
import type { GitLabIssuesProps } from "./gitlab-issues/types";
import { MobileBackBar } from './MobileNav';
import { useIsCompact } from '../hooks/useIsMobile';
import { PAGE_BODY, PAGE_ROOT, PAGE_STICKY } from './ui/page-header';
import { cn } from '../lib/utils';

export function GitLabIssues({ onOpenSettings, onNavigateToTask }: GitLabIssuesProps) {
  const { t } = useTranslation("gitlab");
  const projects = useProjectStore((state) => state.projects);
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId);
  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const tasks = useTaskStore((state) => state.tasks);

  const {
    syncStatus,
    isLoading,
    error,
    selectedIssueIid,
    selectedIssue,
    filterState,
    selectIssue,
    getFilteredIssues,
    getOpenIssuesCount,
    handleRefresh,
    handleFilterChange,
  } = useGitLabIssues(selectedProject?.id);

  const {
    investigationStatus,
    lastInvestigationResult,
    startInvestigation,
    resetInvestigationStatus,
  } = useGitLabInvestigation(selectedProject?.id);

  const { searchQuery, setSearchQuery, filteredIssues } = useIssueFiltering(getFilteredIssues());

  const [showInvestigateDialog, setShowInvestigateDialog] = useState(false);
  // Below lg (phones + narrow desktop): list and detail are shown one at a time
  const isCompact = useIsCompact();
  const [showMobileDetail, setShowMobileDetail] = useState(false);
  const showList = !isCompact || !showMobileDetail;
  const showDetail = !isCompact || showMobileDetail;
  const [selectedIssueForInvestigation, setSelectedIssueForInvestigation] =
    useState<GitLabIssue | null>(null);

  // Build a map of GitLab issue IIDs to task IDs for quick lookup
  const issueToTaskMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const task of tasks) {
      if (task.metadata?.gitlabIssueIid) {
        map.set(task.metadata.gitlabIssueIid, task.specId || task.id);
      }
    }
    return map;
  }, [tasks]);

  const handleInvestigate = useCallback((issue: GitLabIssue) => {
    setSelectedIssueForInvestigation(issue);
    setShowInvestigateDialog(true);
  }, []);

  const handleStartInvestigation = useCallback(
    (selectedNoteIds: number[]) => {
      if (selectedIssueForInvestigation) {
        startInvestigation(selectedIssueForInvestigation, selectedNoteIds);
      }
    },
    [selectedIssueForInvestigation, startInvestigation]
  );

  const handleCloseDialog = useCallback(() => {
    setShowInvestigateDialog(false);
    resetInvestigationStatus();
  }, [resetInvestigationStatus]);

  // Not connected state
  if (!syncStatus?.connected) {
    return <NotConnectedState error={syncStatus?.error || null} onOpenSettings={onOpenSettings} />;
  }

  return (
    <div className={PAGE_ROOT}>
      {/* Header + filters (hidden while a compact layout shows the detail on its own) */}
      {showList && (
        <IssueListHeader
          projectPath={syncStatus.projectPathWithNamespace ?? ""}
          openIssuesCount={getOpenIssuesCount()}
          isLoading={isLoading}
          searchQuery={searchQuery}
          filterState={filterState}
          onSearchChange={setSearchQuery}
          onFilterChange={handleFilterChange}
          onRefresh={handleRefresh}
        />
      )}

      {/* Content */}
      <div className={cn(PAGE_BODY, "flex")}>
        {/* Issue List */}
        {showList && (
          <div className="flex w-1/2 min-w-0 flex-col border-r border-border max-lg:w-full max-lg:border-r-0">
            <IssueList
              issues={filteredIssues}
              selectedIssueIid={selectedIssueIid}
              isLoading={isLoading}
              error={error}
              onSelectIssue={(issueIid) => {
                selectIssue(issueIid);
                setShowMobileDetail(true);
              }}
              onInvestigate={handleInvestigate}
            />
          </div>
        )}

        {/* Issue Detail */}
        {showDetail && (
          <div className="flex w-1/2 min-w-0 flex-col max-lg:w-full">
            {isCompact && (
              <div className={PAGE_STICKY}>
                <MobileBackBar onBack={() => setShowMobileDetail(false)} />
              </div>
            )}
            {selectedIssue ? (
              <IssueDetail
                issue={selectedIssue}
                onInvestigate={() => handleInvestigate(selectedIssue)}
                investigationResult={
                  lastInvestigationResult?.issueIid === selectedIssue.iid
                    ? lastInvestigationResult
                    : null
                }
                linkedTaskId={issueToTaskMap.get(selectedIssue.iid)}
                onViewTask={onNavigateToTask}
              />
            ) : (
              <EmptyState message={t("empty.selectIssue")} />
            )}
          </div>
        )}
      </div>

      {/* Investigation Dialog */}
      <InvestigationDialog
        open={showInvestigateDialog}
        onOpenChange={setShowInvestigateDialog}
        selectedIssue={selectedIssueForInvestigation}
        investigationStatus={investigationStatus}
        onStartInvestigation={handleStartInvestigation}
        onClose={handleCloseDialog}
        projectId={selectedProject?.id}
      />
    </div>
  );
}
