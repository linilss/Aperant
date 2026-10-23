import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useToast } from '../../hooks/use-toast';
import { Separator } from '../ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { ScrollArea } from '../ui/scroll-area';
import { TooltipProvider } from '../ui/tooltip';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Progress } from '../ui/progress';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import {
  Play,
  Square,
  CheckCircle2,
  RotateCcw,
  Trash2,
  Loader2,
  AlertTriangle,
  Pencil,
  X,
  GitPullRequest,
  GitMerge,
  Sparkles,
  GitBranch,
  RefreshCw,
  Rocket,
} from 'lucide-react';
import { Input } from '../ui/input';
import { cn } from '../../lib/utils';
import { calculateProgress } from '../../lib/utils';
import { stopTask, submitReview, recoverStuckTask, deleteTask, useTaskStore, startTaskOrQueue } from '../../stores/task-store';
import { useProjectStore } from '../../stores/project-store';
import { useDeployDialogStore } from '../../stores/deploy-dialog-store';
import { getTaskBranchName } from '../../../shared/utils/task-branch';
import { TASK_STATUS_LABELS } from '../../../shared/constants';
import { TaskEditDialog } from '../TaskEditDialog';
import { useTaskDetail } from './hooks/useTaskDetail';
import { RefineTerminalTab } from './RefineTerminalTab';
import { StopTaskButton } from '../StopTaskButton';
import { TaskMetadata } from './TaskMetadata';
import { TaskWarnings } from './TaskWarnings';
import { TaskSubtasks } from './TaskSubtasks';
import { TaskLogs } from './TaskLogs';
import { TaskFiles } from './TaskFiles';
import { TaskReview } from './TaskReview';
import { TaskFailurePanel } from './TaskFailurePanel';
import { CollapsibleTraceSection } from './AgentTracePanel';
import type { Task, WorktreeCreatePROptions } from '../../../shared/types';

interface TaskDetailModalProps {
  open: boolean;
  task: Task | null;
  onOpenChange: (open: boolean) => void;
  onSwitchToTerminals?: () => void;
  onOpenInbuiltTerminal?: (id: string, cwd: string) => void;
}

export function TaskDetailModal({ open, task, onOpenChange, onSwitchToTerminals, onOpenInbuiltTerminal }: TaskDetailModalProps) {
  // Don't render anything if no task
  if (!task) {
    return null;
  }

  return (
    <TaskDetailModalContent
      open={open}
      task={task}
      onOpenChange={onOpenChange}
      onSwitchToTerminals={onSwitchToTerminals}
      onOpenInbuiltTerminal={onOpenInbuiltTerminal}
    />
  );
}

// Feature flag for Files tab (enabled by default, can be disabled via localStorage)
const isFilesTabEnabled = () => {
  const flag = localStorage.getItem('use_files_tab');
  return flag === null || flag === 'true'; // Enabled by default
};

// Separate component to use hooks only when task exists
function TaskDetailModalContent({ open, task, onOpenChange, onSwitchToTerminals, onOpenInbuiltTerminal }: { open: boolean; task: Task; onOpenChange: (open: boolean) => void; onSwitchToTerminals?: () => void; onOpenInbuiltTerminal?: (id: string, cwd: string) => void }) {
  const { t } = useTranslation(['tasks', 'deploy']);
  const { toast } = useToast();
  const state = useTaskDetail({ task });
  const activeProject = useProjectStore(s => s.getActiveProject());
  const showFilesTab = isFilesTabEnabled();
  const [refineTerminalMode, setRefineTerminalMode] = useState<false | 'interactive' | 'auto'>(false);
  const [refineCompleted, setRefineCompleted] = useState(false);
  const [showRefineBranchModal, setShowRefineBranchModal] = useState(false);
  const [refineBranchInput, setRefineBranchInput] = useState('');
  const [pendingRefineMode, setPendingRefineMode] = useState<'interactive' | 'auto'>('interactive');
  const [isSyncingWorktree, setIsSyncingWorktree] = useState(false);
  const [showRebaseBranchModal, setShowRebaseBranchModal] = useState(false);
  const [rebaseBranchInput, setRebaseBranchInput] = useState('');
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [baseBranchInput, setBaseBranchInput] = useState('');
  const progressPercent = calculateProgress(task.subtasks);
  const completedSubtasks = task.subtasks.filter(s => s.status === 'completed').length;
  const totalSubtasks = task.subtasks.length;

  useEffect(() => {
    let cancelled = false;
    window.electronAPI?.taskRefineGetSession(task.id).then((result) => {
      if (cancelled) return;
      if (result?.success && result.data) {
        const session = (result.data as { session: { completedPhases: string[] } }).session;
        setRefineCompleted(session?.completedPhases?.length >= 4);
      }
    }).catch(() => {});
    // A refine run still going in main (dialog reopened): show its tab again so it can be re-attached
    window.electronAPI?.taskRefineGetStatus?.(task.id).then((result) => {
      if (cancelled || !result?.success || !result.data?.isRunning) return;
      const mode = result.data.autoMode ? 'auto' : 'interactive';
      setRefineTerminalMode((current) => current || mode);
    }).catch(() => {
      // No status: the Refine buttons still start a run
    });
    return () => { cancelled = true; };
  }, [task.id]);

  // Event Handlers
  const handleStartStop = async () => {
    if (state.isRunning && !state.isStuck) {
      stopTask(task.id);
    } else if (state.isIncomplete) {
      // Resume — validate plan and start directly without branch prompt
      const isValid = await state.reloadPlanForIncompleteTask();
      if (!isValid) {
        toast({
          title: 'Cannot Resume Task',
          description: 'Failed to load implementation plan. Please try again or check the task files.',
          variant: 'destructive',
          duration: 5000,
        });
        return;
      }
      const result = await startTaskOrQueue(task.id);
      if (!result.success) {
        toast({ title: t('tasks:wizard.errors.startFailed'), description: result.error, variant: 'destructive' });
      } else if (result.action === 'queued') {
        toast({ title: t('tasks:queue.movedToQueue') });
      }
    } else if (task.status === 'backlog' || task.status === 'in_progress') {
      // Show branch confirmation modal before starting
      setBaseBranchInput(task.metadata?.baseBranch || activeProject?.settings?.mainBranch || 'main');
      setShowBranchModal(true);
    } else {
      const result = await startTaskOrQueue(task.id);
      if (!result.success) {
        toast({ title: t('tasks:wizard.errors.startFailed'), description: result.error, variant: 'destructive' });
      } else if (result.action === 'queued') {
        toast({ title: t('tasks:queue.movedToQueue') });
      }
    }
  };

  const handleConfirmBranch = async () => {
    setShowBranchModal(false);
    // Persist baseBranch to task metadata before starting
    await window.electronAPI.updateTask(task.id, {
      metadata: { ...task.metadata, baseBranch: baseBranchInput || activeProject?.settings?.mainBranch || 'main' },
    });
    const result = await startTaskOrQueue(task.id);
    if (!result.success) {
      toast({ title: t('tasks:wizard.errors.startFailed'), description: result.error, variant: 'destructive' });
    } else if (result.action === 'queued') {
      toast({ title: t('tasks:queue.movedToQueue') });
    }
  };

  const handleStartRefine = (mode: 'interactive' | 'auto') => {
    setPendingRefineMode(mode);
    setRefineBranchInput(task.metadata?.baseBranch || activeProject?.settings?.mainBranch || 'main');
    setShowRefineBranchModal(true);
  };

  const handleConfirmRefineBranch = async () => {
    setShowRefineBranchModal(false);
    await window.electronAPI.updateTask(task.id, {
      metadata: { ...task.metadata, baseBranch: refineBranchInput || activeProject?.settings?.mainBranch || 'main' },
    });
    setRefineTerminalMode(pendingRefineMode);
    state.setActiveTab('refine');
  };

  const handleRecover = async () => {
    state.setIsRecovering(true);
    const result = await recoverStuckTask(task.id, { autoRestart: true });
    if (result.success) {
      state.setIsStuck(false);
      state.setHasCheckedRunning(false);
    }
    state.setIsRecovering(false);
  };

  const handleReject = async () => {
    // Allow submission if there's text feedback OR images attached
    if (!state.feedback.trim() && state.feedbackImages.length === 0) {
      return;
    }
    state.setIsSubmitting(true);
    await submitReview(task.id, false, state.feedback, state.feedbackImages);
    state.setIsSubmitting(false);
    state.setFeedback('');
    state.setFeedbackImages([]);
  };

  const handleDelete = async () => {
    state.setIsDeleting(true);
    state.setDeleteError(null);
    const result = await deleteTask(task.id);
    if (result.success) {
      state.setShowDeleteDialog(false);
      onOpenChange(false);
    } else {
      state.setDeleteError(result.error || 'Failed to delete task');
    }
    state.setIsDeleting(false);
  };

  const handleReset = async () => {
    state.setIsResetting(true);
    state.setResetError(null);
    try {
      const result = await window.electronAPI.resetTask(task.id);
      if (result.success) {
        state.setShowResetDialog(false);
        onOpenChange(false);
      } else {
        state.setResetError(result.error || 'Failed to reset task');
      }
    } catch (error) {
      state.setResetError(error instanceof Error ? error.message : 'Failed to reset task');
    } finally {
      state.setIsResetting(false);
    }
  };

  const handleMerge = async () => {
    state.setIsMerging(true);
    state.setWorkspaceError(null);
    try {
      const result = await window.electronAPI.mergeWorktree(task.id, { noCommit: state.stageOnly });
      if (result.success && result.data?.success) {
        if (state.stageOnly && result.data.staged) {
          state.setWorkspaceError(null);
          state.setStagedSuccess(result.data.message || 'Changes staged in main project');
          state.setStagedProjectPath(result.data.projectPath);
          state.setSuggestedCommitMessage(result.data.suggestedCommitMessage);
        } else {
          onOpenChange(false);
        }
      } else {
        state.setWorkspaceError(result.data?.message || result.error || 'Failed to merge changes');
      }
    } catch (error) {
      state.setWorkspaceError(error instanceof Error ? error.message : 'Unknown error during merge');
    } finally {
      state.setIsMerging(false);
    }
  };

  // Quick merge flow for pending_merge tasks (Merge button)
  const handleQuickMergeConfirm = async () => {
    state.setShowMergeInfoDialog(false);
    state.setIsMerging(true);
    state.setWorkspaceError(null);
    try {
      const result = await window.electronAPI.mergeWorktree(task.id, { quickMerge: true });
      if (result.success && result.data?.success) {
        state.setMergedTargetBranch(result.data.targetBranch ?? null);
        state.setShowPushDialog(true);
      } else {
        state.setWorkspaceError(result.data?.message || result.error || 'Failed to merge');
      }
    } catch (error) {
      state.setWorkspaceError(error instanceof Error ? error.message : 'Unknown error during merge');
    } finally {
      state.setIsMerging(false);
    }
  };

  const handleQuickMergePush = async (push: boolean) => {
    state.setShowPushDialog(false);
    if (push && state.mergedTargetBranch) {
      try {
        await window.electronAPI.postMergePush(task.id, state.mergedTargetBranch);
      } catch { /* non-fatal */ }
    }
    state.setShowCleanupDialog(true);
  };

  const handleQuickMergeCleanup = async (cleanup: boolean) => {
    state.setShowCleanupDialog(false);
    if (cleanup) {
      try {
        await window.electronAPI.postMergeCleanup(task.id);
      } catch { /* non-fatal */ }
    }
    onOpenChange(false);
  };

  const handleSyncWorktree = () => {
    setRebaseBranchInput(task.metadata?.baseBranch || activeProject?.settings?.mainBranch || 'main');
    setShowRebaseBranchModal(true);
  };

  const handleConfirmRebase = async () => {
    setShowRebaseBranchModal(false);
    setIsSyncingWorktree(true);
    const result = await window.electronAPI.syncWorktree(task.id, rebaseBranchInput || activeProject?.settings?.mainBranch || 'main');
    setIsSyncingWorktree(false);
    if (result.success && result.data) {
      toast({
        title: result.data.success ? 'Worktree rebased' : 'Rebase failed',
        description: result.data.message + (result.data.hadConflicts ? ' (conflicts resolved by AI)' : ''),
        variant: result.data.success ? 'default' : 'destructive',
      });
    } else {
      toast({ title: 'Rebase failed', description: result.error, variant: 'destructive' });
    }
  };

  const handleMergeButtonClick = async () => {
    state.setWorkspaceError(null);
    try {
      const info = await window.electronAPI.getMergeInfo(task.id);
      if (info.success && info.data) {
        state.setMergeInfo(info.data);
        state.setShowMergeInfoDialog(true);
      } else {
        state.setWorkspaceError(info.error || 'Could not determine merge info');
      }
    } catch (error) {
      state.setWorkspaceError(error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const handleDiscard = async () => {
    state.setIsDiscarding(true);
    state.setWorkspaceError(null);
    const result = await window.electronAPI.discardWorktree(task.id);
    if (result.success && result.data?.success) {
      state.setShowDiscardDialog(false);
      onOpenChange(false);
    } else {
      state.setWorkspaceError(result.data?.message || result.error || 'Failed to discard changes');
    }
    state.setIsDiscarding(false);
  };

  const handleCreatePR = async (options: WorktreeCreatePROptions) => {
    state.setIsCreatingPR(true);
    try {
      const result = await window.electronAPI.createWorktreePR(task.id, options);
      if (result.success && result.data) {
        // Update single task in store with new status and prUrl (more efficient than reloading all tasks)
        if (result.data.success && result.data.prUrl && !result.data.alreadyExists) {
          // PR created ≠ merged — stay in pending_merge until the branch lands
          useTaskStore.getState().updateTask(task.id, {
            status: 'pending_merge',
            metadata: { ...task.metadata, prUrl: result.data.prUrl }
          });
        }
        return result.data;
      }
      // Propagate IPC error; let CreatePRDialog use its i18n fallback
      return { success: false, error: result.error, prUrl: undefined, alreadyExists: false };
    } catch (error) {
      // Propagate actual error message; let CreatePRDialog handle i18n fallback for undefined
      return { success: false, error: error instanceof Error ? error.message : undefined, prUrl: undefined, alreadyExists: false };
    } finally {
      state.setIsCreatingPR(false);
    }
  };

  const handleClose = () => {
    // Show toast notification if task is running
    if (state.isRunning && !state.isStuck) {
      toast({
        title: t('tasks:notifications.backgroundTaskTitle'),
        description: t('tasks:notifications.backgroundTaskDescription'),
        duration: 4000,
      });
    }
    onOpenChange(false);
  };

  // Helper function to get status badge variant
  const getStatusBadgeVariant = (status: string, isStuck: boolean) => {
    if (isStuck) return 'warning';
    switch (status) {
      case 'done':
        return 'success';
      case 'human_review':
        return 'purple';
      case 'pending_merge':
        return 'success';
      case 'in_progress':
        return 'info';
      default:
        return 'secondary';
    }
  };

  // Render primary action button based on state
  const renderPrimaryAction = () => {
    if (state.isStuck) {
      return (
        <Button
          variant="warning"
          onClick={handleRecover}
          disabled={state.isRecovering}
        >
          {state.isRecovering ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Recovering...
            </>
          ) : (
            <>
              <RotateCcw className="mr-2 h-4 w-4" />
              Recover Task
            </>
          )}
        </Button>
      );
    }

    if (state.isIncomplete) {
      return (
        <Button variant="default" onClick={handleStartStop} disabled={state.isLoadingPlan}>
          {state.isLoadingPlan ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading Plan...
            </>
          ) : (
            <>
              <Play className="mr-2 h-4 w-4" />
              Resume Task
            </>
          )}
        </Button>
      );
    }

    if (state.isRunning && !state.isStuck) {
      return <StopTaskButton taskId={task.id} size="default" />;
    }

    if (task.status === 'backlog' || task.status === 'in_progress') {
      return (
        <Button
          variant={state.isRunning ? 'destructive' : 'default'}
          onClick={handleStartStop}
        >
          {state.isRunning ? (
            <>
              <Square className="mr-2 h-4 w-4" />
              Stop Task
            </>
          ) : (
            <>
              <Play className="mr-2 h-4 w-4" />
              Start Task
            </>
          )}
        </Button>
      );
    }

    if (task.status === 'pending_merge') {
      return (
        <div className="flex items-center gap-3">
          {task.metadata?.prUrl && (
            <button
              type="button"
              onClick={() => {
                if (task.metadata?.prUrl) {
                  window.electronAPI?.openExternal(task.metadata.prUrl);
                }
              }}
              className="text-sm flex items-center gap-2 text-info cursor-pointer hover:underline bg-transparent border-none p-0"
            >
              <GitPullRequest className="h-4 w-4" />
              <span className="font-medium">View PR</span>
            </button>
          )}
          <Button
            variant="outline"
            onClick={handleSyncWorktree}
            disabled={isSyncingWorktree || state.isMerging}
          >
            {isSyncingWorktree ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Rebasing...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Rebase
              </>
            )}
          </Button>
          <Button
            variant="default"
            onClick={handleMergeButtonClick}
            disabled={state.isMerging || isSyncingWorktree}
            className="bg-teal-600 hover:bg-teal-700 text-white"
          >
            {state.isMerging ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Merging...
              </>
            ) : (
              <>
                <GitMerge className="mr-2 h-4 w-4" />
                Merge
              </>
            )}
          </Button>
          {state.workspaceError && (
            <p className="text-xs text-destructive max-w-xs truncate">{state.workspaceError}</p>
          )}
        </div>
      );
    }

    if (task.status === 'done' && task.metadata?.prUrl) {
      return (
        <div className="flex items-center gap-4">
          <div className="completion-state text-sm flex items-center gap-2 text-success">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-medium">{t('tasks:status.complete')}</span>
          </div>
           {task.metadata?.prUrl && (
             <button
               type="button"
               onClick={() => {
                 if (task.metadata?.prUrl) {
                   window.electronAPI?.openExternal(task.metadata.prUrl);
                 }
               }}
               className="completion-state text-sm flex items-center gap-2 text-info cursor-pointer hover:underline bg-transparent border-none p-0"
             >
              <GitPullRequest className="h-5 w-5" />
              <span className="font-medium">{t(TASK_STATUS_LABELS[task.status])}</span>
            </button>
          )}
        </div>
      );
    }

    if (task.status === 'done') {
      return (
        <div className="completion-state text-sm flex items-center gap-2 text-success">
          <CheckCircle2 className="h-5 w-5" />
          <span className="font-medium">{t('tasks:status.complete')}</span>
        </div>
      );
    }

    return null;
  };


  return (
    <TooltipProvider delayDuration={300}>
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <DialogPrimitive.Portal>
          {/* Semi-transparent overlay - can see background content */}
          <DialogPrimitive.Overlay
            className={cn(
              'fixed inset-0 z-50 bg-black/60',
              'data-[state=open]:animate-in data-[state=closed]:animate-out',
              'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0'
            )}
          />

          {/* Full-height centered modal content */}
          <DialogPrimitive.Content
            className={cn(
              'fixed left-[50%] top-4 z-50',
              'translate-x-[-50%]',
              'w-[95vw] max-w-5xl h-[calc(100vh-32px)]',
              'bg-card border border-border rounded-xl',
              'shadow-2xl overflow-hidden flex flex-col',
              'data-[state=open]:animate-in data-[state=closed]:animate-out',
              'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
              'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
              'duration-200',
              // Phone (LAN web UI): full-screen inside the safe area
              'max-md:inset-x-0 max-md:top-[env(safe-area-inset-top)] max-md:bottom-[env(safe-area-inset-bottom)]',
              'max-md:translate-x-0 max-md:w-full max-md:max-w-none max-md:h-auto max-md:rounded-none max-md:border-0'
            )}
          >
            {/* Header */}
            <div className="p-5 pb-4 border-b border-border shrink-0 max-md:p-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0 overflow-hidden">
                  <DialogPrimitive.Title className="text-xl font-semibold leading-tight text-foreground truncate max-md:text-lg max-md:whitespace-normal max-md:line-clamp-2">
                    {task.title}
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Description asChild>
                    <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-xs font-mono">
                        {task.specId}
                      </Badge>
                      {state.isStuck ? (
                        <Badge variant="warning" className="text-xs flex items-center gap-1 animate-pulse">
                          <AlertTriangle className="h-3 w-3" />
                          Stuck
                        </Badge>
                      ) : state.isIncomplete ? (
                        <Badge variant="warning" className="text-xs flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            Incomplete
                          </Badge>
                      ) : (
                        <>
                           <Badge
                             variant={getStatusBadgeVariant(task.status, state.isStuck)}
                             className={cn('text-xs', (task.status === 'in_progress' && !state.isStuck) && 'status-running')}
                           >
                             {t(TASK_STATUS_LABELS[task.status])}
                           </Badge>
                          {task.status === 'human_review' && task.reviewReason && (
                            <Badge
                              variant={task.reviewReason === 'completed' ? 'success' : task.reviewReason === 'errors' ? 'destructive' : 'warning'}
                              className="text-xs"
                            >
                              {task.reviewReason === 'completed' ? 'Completed' :
                               task.reviewReason === 'errors' ? 'Has Errors' :
                               task.reviewReason === 'plan_review' ? 'Approve Plan' :
                               task.reviewReason === 'stopped' ? 'Stopped' : 'QA Issues'}
                            </Badge>
                          )}
                        </>
                      )}
                      {/* Compact progress indicator */}
                      {totalSubtasks > 0 && (
                        <span className="text-xs text-muted-foreground ml-1">
                          {completedSubtasks}/{totalSubtasks} subtasks
                        </span>
                      )}
                    </div>
                  </DialogPrimitive.Description>
                  {window.DEBUG && (
                    <div className="mt-1 text-[11px] text-muted-foreground font-mono">
                      status={task.status} reviewReason={task.reviewReason ?? 'none'} phase={task.executionProgress?.phase ?? 'none'} reviewRequired={task.metadata?.requireReviewBeforeCoding ? 'true' : 'false'}
                      <br />
                      projectId={activeProject?.id ?? 'none'} projectName={activeProject?.name ?? 'none'}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0 electron-no-drag">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="hover:bg-primary/10 hover:text-primary transition-colors"
                    onClick={() => state.setIsEditDialogOpen(true)}
                    disabled={state.isRunning && !state.isStuck}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <DialogPrimitive.Close asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="hover:bg-muted transition-colors"
                    >
                      <X className="h-5 w-5" />
                      <span className="sr-only">Close</span>
                    </Button>
                  </DialogPrimitive.Close>
                </div>
              </div>

              {/* Progress bar - only show when running or has progress */}
              {(state.isRunning || completedSubtasks > 0) && totalSubtasks > 0 && (
                <div className="mt-3 flex items-center gap-3">
                  <Progress value={progressPercent} className="h-1.5 flex-1" />
                  <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">{progressPercent}%</span>
                </div>
              )}

              {/* Warnings - compact inline */}
              {(state.isStuck || state.isIncomplete) && (
                <div className="mt-3">
                  <TaskWarnings
                    isStuck={state.isStuck}
                    isIncomplete={state.isIncomplete}
                    isRecovering={state.isRecovering}
                    taskProgress={state.taskProgress}
                    onRecover={handleRecover}
                    onResume={handleStartStop}
                  />
                </div>
              )}

              {/* What the user has to do next (Review column) */}
              {task.status === 'human_review' && task.reviewReason && task.reviewReason !== 'errors' && task.reviewReason !== 'qa_rejected' && (
                <p className="mt-3 rounded-lg border border-border bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
                  {t(`tasks:reviewReason.${task.reviewReason === 'plan_review' ? 'approvePlan' : task.reviewReason}Hint`)}
                </p>
              )}

              {/* What QA found and a one-click fix */}
              <TaskFailurePanel task={task} />

              {/* Error details banner */}
              {task.reviewReason === 'errors' && task.errorMessage && (
                <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
                  <p className="text-sm font-medium text-destructive mb-1">Error</p>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">{task.errorMessage}</p>
                </div>
              )}
            </div>

            {/* Body - Single Column with Tabs */}
            <div className="flex-1 min-h-0 overflow-hidden">
              <Tabs value={state.activeTab} onValueChange={state.setActiveTab} className="flex flex-col h-full">
                <TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent px-5 h-auto shrink-0 max-md:overflow-x-auto max-md:px-2 max-md:[scrollbar-width:none]">
                  <TabsTrigger
                    value="overview"
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2.5 text-sm max-md:shrink-0 max-md:px-3"
                  >
                    Overview
                  </TabsTrigger>
                  <TabsTrigger
                    value="subtasks"
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2.5 text-sm max-md:shrink-0 max-md:px-3"
                  >
                    Subtasks ({task.subtasks.length})
                  </TabsTrigger>
                  <TabsTrigger
                    value="logs"
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2.5 text-sm max-md:shrink-0 max-md:px-3"
                  >
                    Logs
                  </TabsTrigger>
                  {showFilesTab && (
                    <TabsTrigger
                      value="files"
                      className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2.5 text-sm max-md:shrink-0 max-md:px-3"
                    >
                      {t('tasks:files.tab')}
                    </TabsTrigger>
                  )}
                  {refineTerminalMode && (
                    <TabsTrigger
                      value="refine"
                      className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2.5 text-sm max-md:shrink-0 max-md:px-3"
                    >
                      Refine
                    </TabsTrigger>
                  )}
                </TabsList>

                {/* Overview Tab */}
                <TabsContent value="overview" className="flex-1 min-h-0 overflow-hidden mt-0">
                  <ScrollArea className="h-full">
                    <div className="p-5 space-y-5 overflow-x-hidden max-w-full">
                      {/* Metadata */}
                      <TaskMetadata task={task} />

                      <CollapsibleTraceSection task={task} modelId={task.metadata?.phaseModels?.coding} />

                      {/* Human Review Section */}
                      {state.needsReview && (
                        <>
                          <Separator />
                          <TaskReview
                            task={task}
                            feedback={state.feedback}
                            isSubmitting={state.isSubmitting}
                            worktreeStatus={state.worktreeStatus}
                            worktreeDiff={state.worktreeDiff}
                            isLoadingWorktree={state.isLoadingWorktree}
                            isMerging={state.isMerging}
                            isDiscarding={state.isDiscarding}
                            showDiscardDialog={state.showDiscardDialog}
                            showDiffDialog={state.showDiffDialog}
                            workspaceError={state.workspaceError}
                            stageOnly={state.stageOnly}
                            stagedSuccess={state.stagedSuccess}
                            stagedProjectPath={state.stagedProjectPath}
                            suggestedCommitMessage={state.suggestedCommitMessage}
                            mergePreview={state.mergePreview}
                            isLoadingPreview={state.isLoadingPreview}
                            showConflictDialog={state.showConflictDialog}
                            onFeedbackChange={state.setFeedback}
                            onReject={handleReject}
                            images={state.feedbackImages}
                            onImagesChange={state.setFeedbackImages}
                            onMerge={handleMerge}
                            onDiscard={handleDiscard}
                            onShowDiscardDialog={state.setShowDiscardDialog}
                            onShowDiffDialog={state.setShowDiffDialog}
                            onStageOnlyChange={state.setStageOnly}
                            onShowConflictDialog={state.setShowConflictDialog}
                            onLoadMergePreview={state.loadMergePreview}
                            onClose={handleClose}
                            onSwitchToTerminals={onSwitchToTerminals}
                            onOpenInbuiltTerminal={onOpenInbuiltTerminal}
                            onReviewAgain={state.handleReviewAgain}
                            showPRDialog={state.showPRDialog}
                            isCreatingPR={state.isCreatingPR}
                            onShowPRDialog={state.setShowPRDialog}
                            onCreatePR={handleCreatePR}
                          />
                        </>
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>

                {/* Subtasks Tab */}
                <TabsContent value="subtasks" className="flex-1 min-h-0 overflow-hidden mt-0">
                  <TaskSubtasks task={task} />
                </TabsContent>

                {/* Logs Tab */}
                <TabsContent value="logs" className="flex-1 min-h-0 overflow-hidden mt-0">
                  <TaskLogs
                    task={task}
                    phaseLogs={state.phaseLogs}
                    isLoadingLogs={state.isLoadingLogs}
                    expandedPhases={state.expandedPhases}
                    isStuck={state.isStuck}
                    logsEndRef={state.logsEndRef}
                    logsContainerRef={state.logsContainerRef}
                    onLogsScroll={state.handleLogsScroll}
                    onTogglePhase={state.togglePhase}
                  />
                </TabsContent>

                {/* Files Tab */}
                {showFilesTab && (
                  <TabsContent value="files" className="flex-1 min-h-0 overflow-hidden mt-0">
                    <TaskFiles task={task} />
                  </TabsContent>
                )}

                {refineTerminalMode && (
                  <TabsContent value="refine" className="flex-1 min-h-0 overflow-hidden mt-0">
                    <RefineTerminalTab
                      taskId={task.id}
                      taskTitle={task.title}
                      taskDescription={task.description || ''}
                      autoMode={refineTerminalMode === 'auto'}
                      isActive={state.activeTab === 'refine'}
                    />
                  </TabsContent>
                )}
              </Tabs>
            </div>

            {/* Footer - Actions */}
            <div className="flex items-center gap-3 px-5 py-3 border-t border-border shrink-0 max-md:flex-wrap max-md:gap-2 max-md:px-3">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                onClick={() => state.setShowDeleteDialog(true)}
                disabled={state.isRunning && !state.isStuck}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Task
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-warning hover:bg-warning/10"
                onClick={() => state.setShowResetDialog(true)}
                disabled={state.isRunning && !state.isStuck}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Reset Task
              </Button>
              <div className="flex-1" />
              {/* Refine buttons — visible for backlog/in_progress tasks when not running */}
              {(task.status === 'backlog' || task.status === 'in_progress') && !state.isRunning && (
                <>
                  {refineCompleted && (
                    <Badge variant="outline" className="text-success border-success/30 bg-success/10 gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Refined
                    </Badge>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleStartRefine('interactive')}
                    className="gap-1.5"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {refineCompleted ? 'Re-refine' : 'Refine'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleStartRefine('auto')}
                    className="gap-1.5"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {refineCompleted ? 'Re-auto-refine' : 'Auto-refine'}
                  </Button>
                </>
              )}
              {renderPrimaryAction()}
              {task.status === 'done' && task.metadata?.useWorktree !== false && !task.stagedInMainProject && !task.metadata?.prUrl && (
                <Button
                  variant="outline"
                  onClick={handleMerge}
                  disabled={state.isMerging}
                >
                  {state.isMerging ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Merging...
                    </>
                  ) : (
                    <>
                      <GitMerge className="mr-2 h-4 w-4" />
                      Merge
                    </>
                  )}
                </Button>
              )}
              {/* Deploy: merged (Done) tasks only; review/pending-merge tasks must be merged first */}
              {task.status === 'done' ? (
                <Button
                  variant="outline"
                  onClick={() => useDeployDialogStore.getState().openForTask(task)}
                  title={t('deploy:task.buttonTooltip')}
                >
                  <Rocket className="mr-2 h-4 w-4" />
                  {t('deploy:task.button')}
                </Button>
              ) : (task.status === 'human_review' || task.status === 'pending_merge') && (
                <span title={t('deploy:task.mergeFirst')}>
                  <Button variant="outline" disabled aria-label={t('deploy:task.mergeFirst')}>
                    <Rocket className="mr-2 h-4 w-4" />
                    {t('deploy:task.button')}
                  </Button>
                </span>
              )}
              <Button variant="outline" onClick={handleClose}>
                Close
              </Button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      {/* Edit Task Dialog */}
      <TaskEditDialog
        task={task}
        open={state.isEditDialogOpen}
        onOpenChange={state.setIsEditDialogOpen}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={state.showDeleteDialog} onOpenChange={state.setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {t('tasks:deleteDialog.title')}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-sm text-muted-foreground space-y-3">
                <p>
                  {t('tasks:deleteDialog.confirmMessage')} <strong className="text-foreground">"{task.title}"</strong>?
                </p>
                {state.isCheckingChanges && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('tasks:deleteDialog.checkingChanges')}
                  </div>
                )}
                {state.worktreeChangesInfo?.hasChanges && (
                  <div className="bg-amber-500/10 border border-amber-500/30 px-3 py-2 rounded-lg text-sm space-y-1">
                    <p className="font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                      <AlertTriangle className="h-4 w-4" />
                      {t('tasks:deleteDialog.uncommittedChanges', { count: state.worktreeChangesInfo.changedFileCount })}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {t('tasks:deleteDialog.uncommittedChangesHint')}
                    </p>
                  </div>
                )}
                <p className="text-destructive">
                  {t('tasks:deleteDialog.destructiveWarning')}
                </p>
                {state.deleteError && (
                  <p className="text-destructive bg-destructive/10 px-3 py-2 rounded-lg text-sm">
                    {state.deleteError}
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={state.isDeleting}>{t('tasks:deleteDialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={state.isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {state.isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('tasks:deleteDialog.deleting')}
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t('tasks:deleteDialog.deletePermanently')}
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset Task Confirmation Dialog */}
      <AlertDialog open={state.showResetDialog} onOpenChange={state.setShowResetDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-warning" />
              Reset task?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-sm text-muted-foreground space-y-3">
                <p>
                  This will delete the branch and worktree for <strong className="text-foreground">"{task.title}"</strong> and move it back to Planning so it can be run again from scratch.
                </p>
                <p className="text-warning">The spec and task description are kept. Only the branch and any uncommitted work will be lost.</p>
                {state.resetError && (
                  <p className="text-destructive bg-destructive/10 px-3 py-2 rounded-lg text-sm">{state.resetError}</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={state.isResetting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleReset(); }}
              disabled={state.isResetting}
              className="bg-warning text-warning-foreground hover:bg-warning/90"
            >
              {state.isResetting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Resetting...
                </>
              ) : (
                <>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Reset Task
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Branch Selection Dialog */}
      <AlertDialog open={showBranchModal} onOpenChange={setShowBranchModal}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-primary" />
              Start Task
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-sm text-muted-foreground space-y-3">
                <p>Which branch should development be based on?</p>
                <div className="space-y-1">
                  <label htmlFor="base-branch-input" className="text-xs font-medium text-foreground">
                    Base branch
                  </label>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground font-mono shrink-0">origin/</span>
                    <Input
                      id="base-branch-input"
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

      {/* Refine Branch Picker */}
      <AlertDialog open={showRefineBranchModal} onOpenChange={setShowRefineBranchModal}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-primary" />
              Refine Task
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-sm text-muted-foreground space-y-3">
                <p>Which branch should the AI explore when refining this task?</p>
                <div className="space-y-1">
                  <label htmlFor="refine-branch-input" className="text-xs font-medium text-foreground">
                    Base branch
                  </label>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground font-mono shrink-0">origin/</span>
                    <Input
                      id="refine-branch-input"
                      value={refineBranchInput}
                      onChange={(e) => setRefineBranchInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleConfirmRefineBranch(); } }}
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
              onClick={(e) => { e.preventDefault(); handleConfirmRefineBranch(); }}
              disabled={!refineBranchInput.trim()}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              {pendingRefineMode === 'auto' ? 'Auto-refine' : 'Refine'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rebase Branch Picker */}
      <AlertDialog open={showRebaseBranchModal} onOpenChange={setShowRebaseBranchModal}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-primary" />
              Rebase Worktree
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-sm text-muted-foreground space-y-3">
                <p>Merge the latest commits from a branch into this worktree.</p>
                <div className="space-y-1">
                  <label htmlFor="rebase-branch-input" className="text-xs font-medium text-foreground">
                    Source branch
                  </label>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground font-mono shrink-0">origin/</span>
                    <Input
                      id="rebase-branch-input"
                      value={rebaseBranchInput}
                      onChange={(e) => setRebaseBranchInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleConfirmRebase(); } }}
                      placeholder="dev"
                      className="h-8 font-mono text-sm"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Conflicts will be resolved automatically by AI if possible.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleConfirmRebase(); }}
              disabled={!rebaseBranchInput.trim()}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Rebase
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Merge Info / Confirmation Dialog */}
      <AlertDialog open={state.showMergeInfoDialog} onOpenChange={state.setShowMergeInfoDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <GitMerge className="h-5 w-5 text-teal-500" />
              Merge branch
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-sm text-muted-foreground space-y-3">
                {state.mergeInfo && (
                  <>
                    <div className="bg-muted rounded-lg px-3 py-2 font-mono text-xs space-y-1">
                      <div><span className="text-muted-foreground">from</span> <span className="text-foreground">{state.mergeInfo.sourceBranch}</span></div>
                      <div><span className="text-muted-foreground">into</span> <span className="text-foreground">{state.mergeInfo.targetBranch}</span></div>
                      {state.mergeInfo.commitsAhead > 0 && (
                        <div className="text-muted-foreground">{state.mergeInfo.commitsAhead} commit{state.mergeInfo.commitsAhead !== 1 ? 's' : ''} ahead</div>
                      )}
                    </div>
                    <p>The branch will be fetched, updated with the latest <span className="font-mono text-foreground">{state.mergeInfo.targetBranch}</span>, then merged.</p>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleQuickMergeConfirm(); }}
              className="bg-teal-600 hover:bg-teal-700 text-white"
            >
              <GitMerge className="mr-2 h-4 w-4" />
              Merge
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Push Dialog */}
      <AlertDialog open={state.showPushDialog} onOpenChange={() => {}}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Push to origin?</AlertDialogTitle>
            <AlertDialogDescription>
              Push <span className="font-mono">{state.mergedTargetBranch}</span> to origin/{state.mergedTargetBranch}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => handleQuickMergePush(false)}>Skip</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleQuickMergePush(true)}>Push</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cleanup Dialog */}
      <AlertDialog open={state.showCleanupDialog} onOpenChange={() => {}}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete branch?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <span className="font-mono">{state.mergeInfo?.sourceBranch ?? getTaskBranchName(task.specId, activeProject?.settings)}</span> locally and from remote?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => handleQuickMergeCleanup(false)}>Keep</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleQuickMergeCleanup(true)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </TooltipProvider>
  );
}
