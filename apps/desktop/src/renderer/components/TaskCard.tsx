import { useState, useEffect, useRef, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Square, Clock, Zap, Target, Shield, Gauge, Palette, FileCode, Bug, Wrench, Loader2, AlertTriangle, RotateCcw, Archive, GitPullRequest, GitBranch, RefreshCw, MoreVertical, Upload, Check, Sparkles, PauseCircle, Rocket, Lock } from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { cn, formatRelativeTime, sanitizeMarkdownForDisplay } from '../lib/utils';
import { PhaseProgressIndicator } from './PhaseProgressIndicator';
import {
  TASK_CATEGORY_LABELS,
  TASK_CATEGORY_COLORS,
  TASK_COMPLEXITY_COLORS,
  TASK_COMPLEXITY_LABELS,
  TASK_IMPACT_COLORS,
  TASK_IMPACT_LABELS,
  TASK_PRIORITY_COLORS,
  TASK_PRIORITY_LABELS,
  EXECUTION_PHASE_LABELS,
  EXECUTION_PHASE_BADGE_COLORS,
  TASK_STATUS_COLUMNS,
  TASK_STATUS_LABELS,
  JSON_ERROR_PREFIX,
  JSON_ERROR_TITLE_SUFFIX
} from '../../shared/constants';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog';
import { Input } from './ui/input';
import { stopTask, checkTaskRunning, recoverStuckTask, isIncompleteHumanReview, archiveTasks, hasRecentActivity, startTaskOrQueue, useTaskStore } from '../stores/task-store';
import { useProjectStore } from '../stores/project-store';
import { useToast } from '../hooks/use-toast';
import { useDeployDialogStore } from '../stores/deploy-dialog-store';
import { formatDeployedVersion, getLastDeployment, isAppStoreDeployment, isMergeOnly, isTaskNotLive } from '../../shared/utils/task-deployments';
import type { Task, TaskCategory, ReviewReason, TaskStatus } from '../../shared/types';

// Category icon mapping
const CategoryIcon: Record<TaskCategory, typeof Zap> = {
  feature: Target,
  bug_fix: Bug,
  refactoring: Wrench,
  documentation: FileCode,
  security: Shield,
  performance: Gauge,
  ui_ux: Palette,
  infrastructure: Wrench,
  testing: FileCode
};

// Catastrophic stuck detection interval (ms).
// XState handles all normal process-exit transitions via PROCESS_EXITED events.
// This is a last-resort safety net: if XState somehow fails to transition the task
// out of in_progress after the process dies, flag it as stuck after 60 seconds.
const STUCK_CHECK_INTERVAL_MS = 60_000;

interface TaskCardProps {
  task: Task;
  onClick: () => void;
  onStatusChange?: (newStatus: TaskStatus) => unknown;
  // Optional selectable mode props for multi-selection
  isSelectable?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
}

// Custom comparator for React.memo - only re-render when relevant task data changes
function taskCardPropsAreEqual(prevProps: TaskCardProps, nextProps: TaskCardProps): boolean {
  const prevTask = prevProps.task;
  const nextTask = nextProps.task;

  // Fast path: same reference (include selectable props)
  if (
    prevTask === nextTask &&
    prevProps.onClick === nextProps.onClick &&
    prevProps.onStatusChange === nextProps.onStatusChange &&
    prevProps.isSelectable === nextProps.isSelectable &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.onToggleSelect === nextProps.onToggleSelect
  ) {
    return true;
  }

  // Check selectable props first (cheap comparison)
  if (
    prevProps.isSelectable !== nextProps.isSelectable ||
    prevProps.isSelected !== nextProps.isSelected
  ) {
    return false;
  }

  // Compare only the fields that affect rendering
  const isEqual = (
    prevTask.id === nextTask.id &&
    prevTask.status === nextTask.status &&
    prevTask.title === nextTask.title &&
    prevTask.description === nextTask.description &&
    prevTask.updatedAt === nextTask.updatedAt &&
    prevTask.reviewReason === nextTask.reviewReason &&
    prevTask.executionProgress?.phase === nextTask.executionProgress?.phase &&
    prevTask.executionProgress?.phaseProgress === nextTask.executionProgress?.phaseProgress &&
    prevTask.subtasks.length === nextTask.subtasks.length &&
    prevTask.metadata?.fastMode === nextTask.metadata?.fastMode &&
    prevTask.metadata?.category === nextTask.metadata?.category &&
    prevTask.metadata?.complexity === nextTask.metadata?.complexity &&
    prevTask.metadata?.archivedAt === nextTask.metadata?.archivedAt &&
    prevTask.metadata?.prUrl === nextTask.metadata?.prUrl &&
    prevTask.metadata?.refined === nextTask.metadata?.refined &&
    prevTask.metadata?.deployments?.length === nextTask.metadata?.deployments?.length &&
    prevTask.metadata?.deployments?.at(-1)?.status === nextTask.metadata?.deployments?.at(-1)?.status &&
    prevTask.metadata?.mergedAt === nextTask.metadata?.mergedAt &&
    prevTask.metadata?.deployments?.at(-1)?.version === nextTask.metadata?.deployments?.at(-1)?.version &&
    // Check if any subtask statuses changed (compare all subtasks)
    prevTask.subtasks.every((s, i) => s.status === nextTask.subtasks[i]?.status)
  );

  // Only log when actually re-rendering (reduces noise significantly)
  if (window.DEBUG && !isEqual) {
    const changes: string[] = [];
    if (prevTask.status !== nextTask.status) changes.push(`status: ${prevTask.status} -> ${nextTask.status}`);
    if (prevTask.executionProgress?.phase !== nextTask.executionProgress?.phase) {
      changes.push(`phase: ${prevTask.executionProgress?.phase} -> ${nextTask.executionProgress?.phase}`);
    }
    if (prevTask.subtasks.length !== nextTask.subtasks.length) {
      changes.push(`subtasks: ${prevTask.subtasks.length} -> ${nextTask.subtasks.length}`);
    }
    console.log(`[TaskCard] Re-render: ${prevTask.id} | ${changes.join(', ') || 'other fields'}`);
  }

  return isEqual;
}

export const TaskCard = memo(function TaskCard({
  task,
  onClick,
  onStatusChange,
  isSelectable,
  isSelected,
  onToggleSelect
}: TaskCardProps) {
  const { t } = useTranslation(['tasks', 'errors', 'deploy']);
  const { toast } = useToast();
  const [isStuck, setIsStuck] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [isPushed, setIsPushed] = useState<boolean | null>(null);
  const [isPushing, setIsPushing] = useState(false);
  const stuckIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const isRunning = task.status === 'in_progress';
  const executionPhase = task.executionProgress?.phase;
  // A rate-limit-paused task is still in_progress but idle — don't show a spinning
  // phase badge for work that isn't happening, and don't let it look like it's running.
  const rateLimitPause = useTaskStore((state) => state.rateLimitPauses[task.id]);
  const hasActiveExecution = !rateLimitPause && executionPhase && executionPhase !== 'idle' && executionPhase !== 'complete' && executionPhase !== 'failed';

  // Coarse countdown to the reset the provider reported. Ticks every 30s — the
  // badge shows minutes/hours, so anything finer would just cause re-renders.
  const [rateLimitResetIn, setRateLimitResetIn] = useState<string | null>(null);
  const rateLimitResetAt = rateLimitPause?.resetAt ?? null;
  useEffect(() => {
    if (!rateLimitResetAt) {
      setRateLimitResetIn(null);
      return;
    }
    const update = () => {
      const remainingMs = new Date(rateLimitResetAt).getTime() - Date.now();
      if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
        setRateLimitResetIn(null);
        return;
      }
      const minutes = Math.ceil(remainingMs / 60_000);
      setRateLimitResetIn(minutes >= 60 ? `${Math.ceil(minutes / 60)}h` : `${minutes}m`);
    };
    update();
    const intervalId = setInterval(update, 30_000);
    return () => clearInterval(intervalId);
  }, [rateLimitResetAt]);

  // Check if task is in human_review but has no completed subtasks (crashed/incomplete)
  const isIncomplete = isIncompleteHumanReview(task);

  // Memoize expensive computations to avoid running on every render
  // Truncate description for card display - full description shown in modal
  // Handle JSON error tasks with i18n
  const sanitizedDescription = useMemo(() => {
    if (!task.description) return null;
    // Check for JSON error marker and use i18n
    if (task.description.startsWith(JSON_ERROR_PREFIX)) {
      const errorMessage = task.description.slice(JSON_ERROR_PREFIX.length);
      const translatedDesc = t('errors:task.jsonError.description', { error: errorMessage });
      return sanitizeMarkdownForDisplay(translatedDesc, 120);
    }
    return sanitizeMarkdownForDisplay(task.description, 120);
  }, [task.description, t]);

  // Memoize title with JSON error suffix handling
  const displayTitle = useMemo(() => {
    if (task.title.endsWith(JSON_ERROR_TITLE_SUFFIX)) {
      const baseName = task.title.slice(0, -JSON_ERROR_TITLE_SUFFIX.length);
      return `${baseName} ${t('errors:task.jsonError.titleSuffix')}`;
    }
    return task.title;
  }, [task.title, t]);

  // Memoize relative time (recalculates only when updatedAt changes)
  const relativeTime = useMemo(
    () => formatRelativeTime(task.updatedAt),
    [task.updatedAt]
  );

  // Memoize status menu items to avoid recreating on every render
  const statusMenuItems = useMemo(() => {
    if (!onStatusChange) return null;
    return TASK_STATUS_COLUMNS.filter(status => status !== task.status).map((status) => (
      <DropdownMenuItem
        key={status}
        onClick={() => onStatusChange(status)}
      >
        {t(TASK_STATUS_LABELS[status])}
      </DropdownMenuItem>
    ));
  }, [task.status, onStatusChange, t]);

  // Catastrophic stuck detection — last-resort safety net.
  // XState handles all normal transitions via PROCESS_EXITED events.
  // This only fires if XState somehow fails to transition after 60s with no activity.
  useEffect(() => {
    if (!isRunning) {
      setIsStuck(false);
      if (stuckIntervalRef.current) {
        clearInterval(stuckIntervalRef.current);
        stuckIntervalRef.current = null;
      }
      return;
    }

    stuckIntervalRef.current = setInterval(() => {
      // If any activity (status, progress, logs) was recorded recently, task is alive
      if (hasRecentActivity(task.id)) {
        setIsStuck(false);
        return;
      }

      // No activity for 60s — verify process is actually gone
      checkTaskRunning(task.id).then((actuallyRunning) => {
        // Re-check activity in case something arrived while the IPC was in flight
        if (hasRecentActivity(task.id)) {
          setIsStuck(false);
        } else {
          setIsStuck(!actuallyRunning);
        }
      });
    }, STUCK_CHECK_INTERVAL_MS);

    return () => {
      if (stuckIntervalRef.current) {
        clearInterval(stuckIntervalRef.current);
      }
    };
  }, [task.id, isRunning]);

  const [showBranchModal, setShowBranchModal] = useState(false);
  const [baseBranchInput, setBaseBranchInput] = useState('');

  const handleStartStop = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isRunning) {
      stopTask(task.id);
    } else if (task.status === 'backlog' || task.status === 'in_progress') {
      // Show branch confirmation before starting
      const activeProject = useProjectStore.getState().projects.find(
        p => p.id === task.projectId
      );
      setBaseBranchInput(task.metadata?.baseBranch || activeProject?.settings?.mainBranch || 'dev');
      setShowBranchModal(true);
    } else {
      const result = await startTaskOrQueue(task.id);
      if (!result.success) {
        toast({
          title: t('tasks:wizard.errors.startFailed'),
          description: result.error,
          variant: 'destructive',
        });
      } else if (result.action === 'queued') {
        toast({ title: t('tasks:queue.movedToQueue') });
      }
    }
  };

  const handleConfirmBranch = async () => {
    setShowBranchModal(false);
    await window.electronAPI.updateTask(task.id, {
      metadata: { ...task.metadata, baseBranch: baseBranchInput || 'dev' },
    });
    const result = await startTaskOrQueue(task.id);
    if (!result.success) {
      toast({
        title: t('tasks:wizard.errors.startFailed'),
        description: result.error,
        variant: 'destructive',
      });
    } else if (result.action === 'queued') {
      toast({ title: t('tasks:queue.movedToQueue') });
    }
  };

  const handleRecover = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsRecovering(true);
    // Auto-restart the task after recovery (no need to click Start again)
    const result = await recoverStuckTask(task.id, { autoRestart: true });
    if (result.success) {
      setIsStuck(false);
    }
    setIsRecovering(false);
  };

  const [isResumingRateLimit, setIsResumingRateLimit] = useState(false);

  /**
   * Skip the remaining rate-limit wait. Writes the RESUME sentinel the worker is
   * polling for; the pause badge clears when the file watcher sees the pause file
   * removed. Useful after switching to an account that still has capacity.
   */
  const handleResumeRateLimited = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsResumingRateLimit(true);
    const result = await window.electronAPI.resumePausedTask(task.id);
    setIsResumingRateLimit(false);
    if (!result.success) {
      toast({
        title: t('labels.resumeFailed'),
        description: result.error,
        variant: 'destructive'
      });
    }
  };

  const [isSyncing, setIsSyncing] = useState(false);

  const handleSyncWorktree = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsSyncing(true);
    const result = await window.electronAPI.syncWorktree(task.id);
    setIsSyncing(false);
    if (result.success && result.data) {
      toast({
        title: result.data.success ? 'Worktree synced' : 'Sync failed',
        description: result.data.message,
        variant: result.data.success ? 'default' : 'destructive',
      });
    } else {
      toast({ title: 'Sync failed', description: result.error, variant: 'destructive' });
    }
  };

  const hasWorktree = task.location === 'worktree' || ['in_progress', 'ai_review', 'human_review', 'pending_merge'].includes(task.status);

  const handleArchive = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const result = await archiveTasks(task.projectId, [task.id]);
    if (!result.success) {
      console.error('[TaskCard] Failed to archive task:', task.id, result.error);
    }
  };

  const lastDeployment = getLastDeployment(task);

  const deployStage = useDeployDialogStore((s) => s.inFlight[task.id]);
  const mergeOnly = useProjectStore((s) => isMergeOnly(s.projects.find((p) => p.id === task.projectId)?.settings));
  // Deploy is outward-facing: first click arms, second click merges (if needed) and deploys
  const [deployArmed, setDeployArmed] = useState(false);
  useEffect(() => {
    if (!deployArmed) return;
    const timer = setTimeout(() => setDeployArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [deployArmed]);

  const handleDeploy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!deployArmed) {
      setDeployArmed(true);
      return;
    }
    setDeployArmed(false);
    useDeployDialogStore.getState().deployTask(task);
  };

  const handleViewPR = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (task.metadata?.prUrl && window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(task.metadata.prUrl);
    }
  };

  // Check push status whenever task enters human_review
  useEffect(() => {
    if (task.status !== 'human_review') {
      setIsPushed(null);
      return;
    }
    window.electronAPI.getWorktreePushStatus(task.id, task.projectId).then((result) => {
      if (result.success && result.data) {
        setIsPushed(result.data.isPushed);
      }
    }).catch(() => setIsPushed(null));
  }, [task.id, task.projectId, task.status]);

  const handlePushBranch = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsPushing(true);
    try {
      const result = await window.electronAPI.pushWorktreeBranch(task.id, task.projectId);
      if (result.success) {
        setIsPushed(true);
        toast({ title: `Branch pushed` });
      } else {
        toast({ title: 'Push failed', description: result.error, variant: 'destructive' });
      }
    } catch (err) {
      toast({ title: 'Push failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setIsPushing(false);
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'in_progress':
        return 'info';
      case 'ai_review':
        return 'warning';
      case 'human_review':
        return 'purple';
      case 'done':
        return 'success';
      default:
        return 'secondary';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'in_progress':
        return t('labels.running');
      case 'ai_review':
        return t('labels.aiReview');
      case 'human_review':
        return t('labels.needsReview');
      case 'done':
        return t('status.complete');
      default:
        return t('labels.pending');
    }
  };

  const getReviewReasonLabel = (reason?: ReviewReason): { label: string; variant: 'success' | 'destructive' | 'warning' } | null => {
    if (!reason) return null;
    switch (reason) {
      case 'completed':
        return { label: t('reviewReason.completed'), variant: 'success' };
      case 'errors':
        return { label: t('reviewReason.hasErrors'), variant: 'destructive' };
      case 'qa_rejected':
        return { label: t('reviewReason.qaIssues'), variant: 'warning' };
      case 'plan_review':
        return { label: t('reviewReason.approvePlan'), variant: 'warning' };
      case 'stopped':
        return { label: t('reviewReason.stopped'), variant: 'warning' };
      default:
        return null;
    }
  };

  // When executionPhase is 'complete', always show 'completed' badge regardless of reviewReason
  // This ensures the user sees "Complete" when the task finished successfully
  const effectiveReviewReason: ReviewReason | undefined =
    executionPhase === 'complete' ? 'completed' : task.reviewReason;
  const reviewReasonInfo = task.status === 'human_review' ? getReviewReasonLabel(effectiveReviewReason) : null;

  const isArchived = !!task.metadata?.archivedAt;

  // Finished tasks deploy in one go: unmerged ones are merged first. Re-deploys stay available.
  // In merge-only projects the button just merges into the main branch.
  const needsMerge = task.status !== 'done';
  const deployLabel = deployStage
    ? t(deployStage === 'merging' ? 'deploy:task.merging' : 'deploy:task.deploying')
    : deployArmed
      ? t(mergeOnly ? 'deploy:task.confirmMergeOnly' : needsMerge ? 'deploy:task.confirmMerge' : 'deploy:task.confirmShort')
      : t(mergeOnly ? 'deploy:task.mergeButton' : 'deploy:task.button');
  const deployButton = mergeOnly && !needsMerge ? null : (
    <Button
      variant={deployArmed ? 'destructive' : needsMerge ? 'default' : 'outline'}
      size="sm"
      className="h-7 px-2.5 text-xs max-md:h-9 max-md:px-3"
      onClick={handleDeploy}
      disabled={!!deployStage}
      title={t(mergeOnly ? 'deploy:task.mergeOnlyTooltip' : needsMerge ? 'deploy:task.mergeAndDeployTooltip' : 'deploy:task.buttonTooltip')}
      aria-label={deployLabel}
    >
      {deployStage ? (
        <Loader2 className="h-3 w-3 animate-spin md:mr-1.5" />
      ) : mergeOnly ? (
        <GitBranch className="h-3 w-3 md:mr-1.5" />
      ) : (
        <Rocket className="h-3 w-3 md:mr-1.5" />
      )}
      <span className={deployArmed || deployStage ? undefined : 'max-md:hidden'}>{deployLabel}</span>
    </Button>
  );
  const canDeployFromReview = task.status === 'human_review' && effectiveReviewReason === 'completed';

  return (
    <>
    <Card
      className={cn(
        'card-surface task-card-enhanced cursor-pointer',
        isRunning && !isStuck && 'ring-2 ring-primary border-primary task-running-pulse',
        isStuck && 'ring-2 ring-warning border-warning task-stuck-pulse',
        isArchived && 'opacity-60 hover:opacity-80',
        isSelectable && isSelected && 'ring-2 ring-ring border-ring bg-accent/10'
      )}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className={isSelectable ? 'flex gap-3' : undefined}>
          {/* Checkbox for selectable mode - stops event propagation */}
          {isSelectable && (
            <div className="flex-shrink-0 pt-0.5">
              <Checkbox
                checked={isSelected}
                onCheckedChange={onToggleSelect}
                onClick={(e) => e.stopPropagation()}
                aria-label={t('tasks:actions.selectTask', { title: displayTitle })}
              />
            </div>
          )}

          <div className={isSelectable ? 'flex-1 min-w-0' : undefined}>
            {/* Title - full width, no wrapper */}
            <h3
              className="font-semibold text-sm text-foreground line-clamp-2 leading-snug"
              title={displayTitle}
            >
              {displayTitle}
            </h3>

        {/* Description - sanitized to handle markdown content (memoized) */}
        {sanitizedDescription && (
          <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
            {sanitizedDescription}
          </p>
        )}

        {/* Metadata badges */}
        {(task.metadata || isStuck || isIncomplete || hasActiveExecution || reviewReasonInfo || rateLimitPause) && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {/* Rate limit pause - the task is parked, not working, and holds no slot */}
            {rateLimitPause && (
              <Badge
                variant="outline"
                className="text-[11px] max-md:text-xs px-1.5 py-0.5 flex items-center gap-1 bg-warning/10 text-warning border-warning/30"
                title={
                  rateLimitPause.pinnedProfileName
                    ? t('labels.rateLimitedPinned', { account: rateLimitPause.pinnedProfileName })
                    : rateLimitPause.error
                }
              >
                {rateLimitPause.pinnedProfileName ? (
                  <Lock className="h-2.5 w-2.5" />
                ) : (
                  <PauseCircle className="h-2.5 w-2.5" />
                )}
                {rateLimitResetIn
                  ? t('labels.rateLimitedUntil', { time: rateLimitResetIn })
                  : t('labels.rateLimited')}
              </Badge>
            )}
            {/* Stuck indicator - highest priority */}
            {isStuck && (
              <Badge
                variant="outline"
                className="text-[11px] max-md:text-xs px-1.5 py-0.5 flex items-center gap-1 bg-warning/10 text-warning border-warning/30 badge-priority-urgent"
              >
                <AlertTriangle className="h-2.5 w-2.5" />
                {t('labels.stuck')}
              </Badge>
            )}
            {/* Incomplete indicator - task in human_review but no subtasks completed */}
            {isIncomplete && !isStuck && (
              <Badge
                variant="outline"
                className="text-[11px] max-md:text-xs px-1.5 py-0.5 flex items-center gap-1 bg-orange-500/10 text-orange-400 border-orange-500/30"
              >
                <AlertTriangle className="h-2.5 w-2.5" />
                {t('labels.incomplete')}
              </Badge>
            )}
            {/* Archived indicator - task has been released */}
            {task.metadata?.archivedAt && (
              <Badge
                variant="outline"
                className="text-[11px] max-md:text-xs px-1.5 py-0.5 flex items-center gap-1 bg-muted text-muted-foreground border-border"
              >
                <Archive className="h-2.5 w-2.5" />
                {t('status.archived')}
              </Badge>
            )}
            {/* Deployed indicator - last deploy started from the Deploy button */}
            {lastDeployment && <DeploymentBadge deployment={lastDeployment} />}
            {!mergeOnly && isTaskNotLive(task) && lastDeployment?.status !== 'running' && lastDeployment?.status !== 'failed' && (
              <Badge
                variant="outline"
                className="text-[11px] max-md:text-xs px-1.5 py-0.5 flex items-center gap-1 bg-warning/10 text-warning border-warning/30"
                title={t('deploy:task.notLiveTooltip')}
              >
                <AlertTriangle className="h-2.5 w-2.5" />
                {t('deploy:task.notLive')}
              </Badge>
            )}
            {/* Execution phase badge - shown when actively running */}
            {hasActiveExecution && executionPhase && !isStuck && !isIncomplete && (
              <Badge
                variant="outline"
                className={cn(
                  'text-[11px] max-md:text-xs px-1.5 py-0.5 flex items-center gap-1',
                  EXECUTION_PHASE_BADGE_COLORS[executionPhase]
                )}
              >
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                {EXECUTION_PHASE_LABELS[executionPhase]}
              </Badge>
            )}
             {/* Status badge - hide when execution phase badge is showing */}
             {!hasActiveExecution && (
               task.status === 'done' ? (
                    <Badge
                      variant={getStatusBadgeVariant(task.status)}
                      className="text-[11px] max-md:text-xs px-1.5 py-0.5"
                    >
                      {getStatusLabel(task.status)}
                    </Badge>
                  ) : (
                   <Badge
                     variant={isStuck ? 'warning' : isIncomplete ? 'warning' : getStatusBadgeVariant(task.status)}
                     className="text-[11px] max-md:text-xs px-1.5 py-0.5"
                   >
                     {isStuck ? t('labels.needsRecovery') : isIncomplete ? t('labels.needsResume') : getStatusLabel(task.status)}
                   </Badge>
                 )
             )}
            {/* Review reason badge - explains why task needs human review */}
            {reviewReasonInfo && !isStuck && !isIncomplete && (
              <Badge
                variant={reviewReasonInfo.variant}
                className="text-[11px] max-md:text-xs px-1.5 py-0.5"
              >
                {reviewReasonInfo.label}
              </Badge>
            )}
            {/* Fast Mode badge */}
            {task.metadata?.fastMode && (
              <Badge
                variant="outline"
                className="text-[11px] max-md:text-xs px-1.5 py-0.5 flex items-center gap-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
              >
                <Zap className="h-2.5 w-2.5" />
                {t('metadata.fastMode')}
              </Badge>
            )}
            {/* Refined badge */}
            {task.metadata?.refined && (
              <Badge
                variant="outline"
                className="text-[11px] max-md:text-xs px-1.5 py-0.5 flex items-center gap-1 bg-success/10 text-success border-success/30"
              >
                <Sparkles className="h-2.5 w-2.5" />
                {t('metadata.refined')}
              </Badge>
            )}
            {/* Category badge with icon */}
            {task.metadata?.category && TASK_CATEGORY_LABELS[task.metadata.category] && (
              <Badge
                variant="outline"
                className={cn('text-[11px] max-md:text-xs px-1.5 py-0', TASK_CATEGORY_COLORS[task.metadata.category])}
              >
                {CategoryIcon[task.metadata.category] && (
                  (() => {
                    const Icon = CategoryIcon[task.metadata.category!];
                    return <Icon className="h-2.5 w-2.5 mr-0.5" />;
                  })()
                )}
                {TASK_CATEGORY_LABELS[task.metadata.category]}
              </Badge>
            )}
            {/* Impact badge - high visibility for important tasks */}
            {task.metadata?.impact && (task.metadata.impact === 'high' || task.metadata.impact === 'critical') && TASK_IMPACT_LABELS[task.metadata.impact] && (
              <Badge
                variant="outline"
                className={cn('text-[11px] max-md:text-xs px-1.5 py-0', TASK_IMPACT_COLORS[task.metadata.impact])}
              >
                {TASK_IMPACT_LABELS[task.metadata.impact]}
              </Badge>
            )}
            {/* Complexity badge */}
            {task.metadata?.complexity && TASK_COMPLEXITY_LABELS[task.metadata.complexity] && (
              <Badge
                variant="outline"
                className={cn('text-[11px] max-md:text-xs px-1.5 py-0', TASK_COMPLEXITY_COLORS[task.metadata.complexity])}
              >
                {TASK_COMPLEXITY_LABELS[task.metadata.complexity]}
              </Badge>
            )}
            {/* Priority badge - only show urgent/high */}
            {task.metadata?.priority && (task.metadata.priority === 'urgent' || task.metadata.priority === 'high') && TASK_PRIORITY_LABELS[task.metadata.priority] && (
              <Badge
                variant="outline"
                className={cn('text-[11px] max-md:text-xs px-1.5 py-0', TASK_PRIORITY_COLORS[task.metadata.priority])}
              >
                {TASK_PRIORITY_LABELS[task.metadata.priority]}
              </Badge>
            )}
            {/* Security severity - always show */}
            {task.metadata?.securitySeverity && (
              <Badge
                variant="outline"
                className={cn('text-[11px] max-md:text-xs px-1.5 py-0', TASK_IMPACT_COLORS[task.metadata.securitySeverity])}
              >
                {task.metadata.securitySeverity} {t('metadata.severity')}
              </Badge>
            )}
          </div>
        )}

        {/* Progress section - Phase-aware with animations */}
        {(task.subtasks.length > 0 || hasActiveExecution || isRunning || isStuck) && (
          <div className="mt-4">
            <PhaseProgressIndicator
              phase={executionPhase}
              subtasks={task.subtasks}
              phaseProgress={task.executionProgress?.phaseProgress}
              isStuck={isStuck}
              isRunning={isRunning}
            />
          </div>
        )}

        {/* Footer */}
        {/* Wraps on narrow columns so the actions (incl. the ⋮ menu) stay inside the card */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-2 gap-y-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>{relativeTime}</span>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            {/* Action buttons */}
            {rateLimitPause ? (
              <Button
                variant="warning"
                size="sm"
                className="h-7 px-2.5"
                onClick={handleResumeRateLimited}
                disabled={isResumingRateLimit}
                title={t('labels.rateLimitedHint')}
              >
                {isResumingRateLimit ? (
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                ) : (
                  <Play className="mr-1.5 h-3 w-3" />
                )}
                {t('actions.resumeNow')}
              </Button>
            ) : isStuck ? (
              <Button
                variant="warning"
                size="sm"
                className="h-7 px-2.5"
                onClick={handleRecover}
                disabled={isRecovering}
              >
                {isRecovering ? (
                  <>
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    {t('labels.recovering')}
                  </>
                ) : (
                  <>
                    <RotateCcw className="mr-1.5 h-3 w-3" />
                    {t('actions.recover')}
                  </>
                )}
              </Button>
            ) : isIncomplete ? (
              <Button
                variant="default"
                size="sm"
                className="h-7 px-2.5"
                onClick={handleStartStop}
              >
                <Play className="mr-1.5 h-3 w-3" />
                {t('actions.resume')}
              </Button>
            ) : task.status === 'human_review' ? (
              <div className="flex items-center gap-1.5">
                {canDeployFromReview && deployButton}
                {hasWorktree && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={handleSyncWorktree}
                    disabled={isSyncing}
                    title="Merge latest base branch into this worktree"
                  >
                    {isSyncing ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                  </Button>
                )}
                {isPushed === true ? (
                  <span className="flex items-center gap-1 text-xs text-green-500 font-medium">
                    <Check className="h-3 w-3" />
                    Pushed
                  </span>
                ) : isPushed === false ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2.5 text-xs"
                    onClick={handlePushBranch}
                    disabled={isPushing}
                    title="Push branch to origin"
                  >
                    {isPushing ? (
                      <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    ) : (
                      <Upload className="mr-1.5 h-3 w-3" />
                    )}
                    {isPushing ? 'Pushing…' : 'Push'}
                  </Button>
                ) : null}
              </div>
            ) : task.status === 'done' && task.metadata?.prUrl ? (
              <div className="flex gap-1">
                {deployButton}
                {task.metadata?.prUrl && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 cursor-pointer"
                    onClick={handleViewPR}
                    title={t('tooltips.viewPR')}
                  >
                    <GitPullRequest className="h-3 w-3" />
                  </Button>
                )}
                {!task.metadata?.archivedAt && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 cursor-pointer"
                    onClick={handleArchive}
                    title={t('tooltips.archiveTask')}
                  >
                    <Archive className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ) : task.status === 'done' ? (
              <div className="flex items-center gap-1">
                {deployButton}
                {!task.metadata?.archivedAt && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2.5 hover:bg-muted-foreground/10 max-md:h-9"
                    onClick={handleArchive}
                    title={t('tooltips.archiveTask')}
                    aria-label={t('tooltips.archiveTask')}
                  >
                    <Archive className="h-3 w-3 md:mr-1.5" />
                    <span className="max-md:hidden">{t('actions.archive')}</span>
                  </Button>
                )}
              </div>
            ) : task.status === 'pending_merge' ? (
              <div className="flex items-center gap-1.5">
              {deployButton}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={handleSyncWorktree}
                disabled={isSyncing}
                title="Merge latest base branch into this worktree"
              >
                {isSyncing ? (
                  <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" />Rebasing...</>
                ) : (
                  <><RefreshCw className="mr-1.5 h-3 w-3" />Rebase</>
                )}
              </Button>
              </div>
            ) : (task.status === 'backlog' || task.status === 'in_progress') && (
              <Button
                variant={isRunning ? 'destructive' : 'default'}
                size="sm"
                className="h-7 px-2.5"
                onClick={handleStartStop}
              >
                {isRunning ? (
                  <>
                    <Square className="mr-1.5 h-3 w-3" />
                    {t('actions.stop')}
                  </>
                ) : (
                  <>
                    <Play className="mr-1.5 h-3 w-3" />
                    {t('actions.start')}
                  </>
                )}
              </Button>
            )}

            {/* Move to menu for keyboard accessibility */}
            {statusMenuItems && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 max-md:h-9 max-md:w-9"
                    onClick={(e) => e.stopPropagation()}
                    aria-label={t('actions.taskActions')}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuLabel>{t('actions.moveTo')}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {statusMenuItems}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
        {/* Close content wrapper for selectable mode */}
        </div>
        {/* Close flex container for selectable mode */}
        </div>
      </CardContent>
    </Card>

    {/* Branch selection modal */}
    <AlertDialog open={showBranchModal} onOpenChange={setShowBranchModal}>
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-primary" />
            Start Task
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-sm text-muted-foreground space-y-3">
              <p>Which branch should development be based on?</p>
              <div className="space-y-1">
                <label htmlFor={`base-branch-${task.id}`} className="text-xs font-medium text-foreground">
                  Base branch
                </label>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground font-mono shrink-0">origin/</span>
                  <Input
                    id={`base-branch-${task.id}`}
                    value={baseBranchInput}
                    onChange={(e) => setBaseBranchInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleConfirmBranch(); } }}
                    placeholder="dev"
                    className="h-8 font-mono text-sm"
                  />
                </div>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); handleConfirmBranch(); }}
            disabled={!baseBranchInput.trim()}
          >
            <Play className="mr-2 h-4 w-4" />
            Start Task
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}, taskCardPropsAreEqual);

/** Last deploy of a task: running, failed, or what shipped (TestFlight / web version) */
export function DeploymentBadge({ deployment }: { deployment: import('../../shared/types').TaskDeployment }) {
  const { t } = useTranslation(['deploy']);
  const time = formatRelativeTime(new Date(deployment.at));
  const version = formatDeployedVersion(deployment);
  const failed = deployment.status === 'failed';
  const running = deployment.status === 'running';
  const label = running
    ? t('deploy:task.deployingNow')
    : failed
      ? t('deploy:task.deployFailed', { time })
      : version
        ? t(isAppStoreDeployment(deployment) ? 'deploy:task.inTestFlight' : 'deploy:task.liveVersion', { version })
        : t('deploy:task.deployed', { time });
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-[11px] max-md:text-xs px-1.5 py-0.5 flex items-center gap-1',
        failed
          ? 'bg-destructive/10 text-destructive border-destructive/30'
          : running
            ? 'bg-info/10 text-info border-info/30'
            : 'bg-success/10 text-success border-success/30'
      )}
      title={[t('deploy:task.deployedTooltip', { time, script: deployment.script }), deployment.summary, deployment.reason]
        .filter(Boolean)
        .join('\n')}
    >
      {running ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Rocket className="h-2.5 w-2.5" />}
      {label}
    </Badge>
  );
}
