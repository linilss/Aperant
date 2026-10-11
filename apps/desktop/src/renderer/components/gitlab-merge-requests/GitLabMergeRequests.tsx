import { useState, useEffect } from 'react';
import { Plus, AlertCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { MergeRequestList } from './components/MergeRequestList';
import { MRDetail } from './components/MRDetail';
import { CreateMergeRequestDialog } from './components/CreateMergeRequestDialog';
import { useGitLabMRs } from './hooks/useGitLabMRs';
import { initializeMRReviewListeners } from '../../stores/gitlab';
import { useTranslation } from 'react-i18next';
import { MobileBackBar } from '../MobileNav';
import { useIsCompact } from '../../hooks/useIsMobile';
import { PAGE_BODY, PAGE_ROOT, PAGE_STICKY } from '../ui/page-header';
import { cn } from '../../lib/utils';

interface GitLabMergeRequestsProps {
  projectId: string;
  onOpenSettings?: () => void;
}

export function GitLabMergeRequests({ projectId, onOpenSettings }: GitLabMergeRequestsProps) {
  const [stateFilter, setStateFilter] = useState<'opened' | 'closed' | 'merged' | 'all'>('opened');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const { t } = useTranslation(['gitlab', 'common']);
  // Below lg (phones + narrow desktop): list and detail are shown one at a time
  const isCompact = useIsCompact();
  const [showMobileDetail, setShowMobileDetail] = useState(false);
  const showList = !isCompact || !showMobileDetail;
  const showDetail = !isCompact || showMobileDetail;

  // Initialize MR review listeners on mount
  useEffect(() => {
    initializeMRReviewListeners();
  }, []);

  // Use the new hook for MR state management
  const {
    mergeRequests,
    isLoading,
    error,
    selectedMR,
    selectedMRIid,
    reviewResult,
    reviewProgress,
    isReviewing,
    selectMR,
    refresh,
    runReview,
    runFollowupReview,
    checkNewCommits,
    cancelReview,
    postReview,
    postNote,
    mergeMR,
    assignMR,
    approveMR,
  } = useGitLabMRs(projectId, { stateFilter });

  const handleCreateSuccess = async (mrIid: number) => {
    // Refresh the list and select the newly created MR
    await refresh();
    selectMR(mrIid);
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <p className="text-sm text-muted-foreground text-center">{error}</p>
        <Button variant="outline" onClick={refresh} className="mt-4">
          {t('common:buttons.retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className={PAGE_ROOT}>
      <div className={cn(PAGE_BODY, 'flex')}>
        {/* List Panel */}
        {showList && (
          <div className="flex w-1/2 min-w-0 flex-col border-r border-border max-lg:w-full max-lg:border-r-0">
            <MergeRequestList
              mergeRequests={mergeRequests}
              isLoading={isLoading}
              selectedMrIid={selectedMRIid}
              onSelectMr={(mr) => {
                selectMR(mr.iid);
                setShowMobileDetail(true);
              }}
              onRefresh={refresh}
              stateFilter={stateFilter}
              onStateFilterChange={setStateFilter}
            />
            <div className="p-2 border-t border-border">
              <Button
                onClick={() => setShowCreateDialog(true)}
                className="w-full gap-2 max-md:h-10"
                size="sm"
              >
                <Plus className="h-4 w-4" />
                {t('mergeRequests.newMR')}
              </Button>
            </div>
          </div>
        )}

        {/* Detail Panel */}
        {showDetail && (
          <div className="flex min-w-0 flex-1 flex-col">
            {isCompact && (
              <div className={PAGE_STICKY}>
                <MobileBackBar onBack={() => setShowMobileDetail(false)} />
              </div>
            )}
            {selectedMR ? (
              <MRDetail
                mr={selectedMR}
                reviewResult={reviewResult}
                reviewProgress={reviewProgress}
                isReviewing={isReviewing}
                onRunReview={() => runReview(selectedMR.iid)}
                onRunFollowupReview={() => runFollowupReview(selectedMR.iid)}
                onCheckNewCommits={() => checkNewCommits(selectedMR.iid)}
                onCancelReview={() => cancelReview(selectedMR.iid)}
                onPostReview={(selectedFindingIds) => postReview(selectedMR.iid, selectedFindingIds)}
                onPostNote={(body) => postNote(selectedMR.iid, body)}
                onMergeMR={(mergeMethod) => mergeMR(selectedMR.iid, mergeMethod)}
                onAssignMR={(userIds) => assignMR(selectedMR.iid, userIds)}
                onApproveMR={() => approveMR(selectedMR.iid)}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center p-8 text-center text-muted-foreground">
                {t('mergeRequests.selectMR')}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <CreateMergeRequestDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        projectId={projectId}
        onSuccess={handleCreateSuccess}
      />
    </div>
  );
}
