import { useState, useMemo, useEffect, useCallback, useRef, memo, Fragment, type ReactNode, type TouchEvent as ReactTouchEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useViewState } from '../contexts/ViewStateContext';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  pointerWithin,
  type CollisionDetection,
  KeyboardSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent
} from '@dnd-kit/core';
import { MouseAndPenSensor, TOUCH_DRAG_ACTIVATION } from '../lib/dnd-sensors';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { Plus, Inbox, Loader2, Eye, CheckCircle2, Archive, RefreshCw, GitPullRequest, GitMerge, X, Settings, ListPlus, ChevronLeft, ChevronRight, ChevronsRight, Lock, Unlock, Trash2, PauseCircle, Rocket, Combine } from 'lucide-react';
import { Checkbox } from './ui/checkbox';
import { ScrollArea } from './ui/scroll-area';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import type { LeadingColumn, TodoExtras } from './board/PlanStageColumns';
import { TaskCard } from './TaskCard';
import { ConsolidateTasksDialog } from './ConsolidateTasksDialog';
import { SortableTaskCard } from './SortableTaskCard';
import { QueueSettingsModal } from './QueueSettingsModal';
import { TASK_STATUS_COLUMNS, TASK_STATUS_LABELS } from '../../shared/constants';
import { cn } from '../lib/utils';
import { persistTaskStatus, forceCompleteTask, archiveTasks, deleteTasks, useTaskStore, isQueueAtCapacity, DEFAULT_MAX_PARALLEL_TASKS } from '../stores/task-store';
import { updateProjectSettings, useProjectStore } from '../stores/project-store';
import { isMergeOnly, isTaskNotLive } from '../../shared/utils/task-deployments';
import { useDeployDialogStore } from '../stores/deploy-dialog-store';
import { useKanbanSettingsStore, DEFAULT_COLUMN_WIDTH, MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH, COLLAPSED_COLUMN_WIDTH_REM, MIN_COLUMN_WIDTH_REM, MAX_COLUMN_WIDTH_REM, DEFAULT_COLUMN_WIDTH_REM, BASE_FONT_SIZE, pxToRem } from '../stores/kanban-settings-store';
import { useToast } from '../hooks/use-toast';
import { useIsMobile } from '../hooks/useIsMobile';
import { WorktreeCleanupDialog } from './WorktreeCleanupDialog';
import { BulkPRDialog } from './BulkPRDialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import type { Task, TaskStatus, TaskOrderState } from '../../shared/types';

/**
 * Prefer the card under the pointer over the column it sits in, so a drop lands
 * where it was released (reordering the queue); fall back to the nearest corners.
 */
const cardFirstCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const cards = hits.filter((c) => !VALID_DROP_COLUMNS.has(String(c.id)));
  if (cards.length > 0) return cards;
  return hits.length > 0 ? hits : closestCorners(args);
};

/** Columns the board shows: Queue lives inside In Progress, AI Review inside Review */
const BOARD_COLUMNS = TASK_STATUS_COLUMNS.filter((s) => s !== 'queue' && s !== 'ai_review');

// Type guard for valid drop column targets - preserves literal type from TASK_STATUS_COLUMNS
const VALID_DROP_COLUMNS = new Set<string>(TASK_STATUS_COLUMNS);
function isValidDropColumn(id: string): id is typeof TASK_STATUS_COLUMNS[number] {
  return VALID_DROP_COLUMNS.has(id);
}

/**
 * Get the visual column for a task status.
 * pr_created tasks are displayed in the 'pending_merge' column — PR created ≠ merged.
 * error tasks are displayed in the 'human_review' column (errors need human attention).
 * This is used to compare visual positions during drag-and-drop operations.
 */
/** The status group a task sorts in (before queue / ai_review are folded into their column) */
function getStatusGroup(status: TaskStatus): typeof TASK_STATUS_COLUMNS[number] {
  if (status === 'pr_created') return 'pending_merge';
  if (status === 'error') return 'human_review';
  return status;
}

function getVisualColumn(status: TaskStatus): typeof TASK_STATUS_COLUMNS[number] {
  if (status === 'pr_created') return 'pending_merge';
  // Queued tasks wait at the bottom of In Progress
  if (status === 'queue') return 'in_progress';
  // AI review runs at the top of Review
  if (status === 'ai_review') return 'human_review';
  if (status === 'error') return 'human_review';
  // pending_merge is a real column — pass through as-is
  return status;
}

interface KanbanBoardProps {
  tasks: Task[];
  /** Board project (falls back to the first task's) */
  projectId?: string;
  /** Planning-stage columns (ideas, roadmap) shown before the task columns */
  leadingColumns?: LeadingColumn[];
  /** Roadmap features waiting for their task, shown at the top of To do */
  todoExtras?: TodoExtras;
  /** Columns shown after the task columns (e.g. Dismissed) */
  trailingColumns?: LeadingColumn[];
  /** A dragged item that isn't a task (idea, feature) was dropped */
  onForeignDrop?: (activeId: string, target: { stage?: string; taskColumn?: TaskStatus }) => void;
  /** Drag preview for a non-task item */
  renderForeignOverlay?: (activeId: string) => ReactNode;
  onTaskClick: (task: Task) => void;
  onNewTaskClick?: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

interface DroppableColumnProps {
  status: TaskStatus;
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  onStatusChange: (taskId: string, newStatus: TaskStatus) => unknown;
  isOver: boolean;
  onAddClick?: () => void;
  onArchiveAll?: () => void;
  onQueueSettings?: () => void;
  onQueueAll?: () => void;
  maxParallelTasks?: number;
  archivedCount?: number;
  showArchived?: boolean;
  onToggleArchived?: () => void;
  // Selection props for human_review column
  selectedTaskIds?: Set<string>;
  onSelectAll?: () => void;
  onDeselectAll?: () => void;
  onToggleSelect?: (taskId: string) => void;
  // Collapse props
  isCollapsed?: boolean;
  onToggleCollapsed?: () => void;
  // Resize props
  columnWidth?: number;
  isResizing?: boolean;
  onResizeStart?: (startX: number) => void;
  onResizeEnd?: () => void;
  /** Planning column: consolidate related tasks into as few as possible, then queue them */
  onConsolidate?: () => void;
  /** Extra content above the task cards plus a header action (To do: planned features) */
  extras?: TodoExtras;
  // Lock props
  isLocked?: boolean;
  onToggleLocked?: () => void;
  /** Phone layout: full-width column whose list grows with the page (no inner scroller) */
  flat?: boolean;
}

/**
 * Compare two tasks arrays for meaningful changes.
 * Returns true if tasks are equivalent (should skip re-render).
 */
function tasksAreEquivalent(prevTasks: Task[], nextTasks: Task[]): boolean {
  if (prevTasks.length !== nextTasks.length) return false;
  if (prevTasks === nextTasks) return true;

  // Compare by ID and fields that affect rendering
  for (let i = 0; i < prevTasks.length; i++) {
    const prev = prevTasks[i];
    const next = nextTasks[i];
    if (
      prev.id !== next.id ||
      prev.status !== next.status ||
      prev.executionProgress?.phase !== next.executionProgress?.phase ||
      prev.updatedAt !== next.updatedAt
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Custom comparator for DroppableColumn memo.
 */
function droppableColumnPropsAreEqual(
  prevProps: DroppableColumnProps,
  nextProps: DroppableColumnProps
): boolean {
  // Quick checks first
  if (prevProps.status !== nextProps.status) return false;
  if (prevProps.isOver !== nextProps.isOver) return false;
  if (prevProps.onTaskClick !== nextProps.onTaskClick) return false;
  if (prevProps.onStatusChange !== nextProps.onStatusChange) return false;
  if (prevProps.onAddClick !== nextProps.onAddClick) return false;
  if (prevProps.onArchiveAll !== nextProps.onArchiveAll) return false;
  if (prevProps.onQueueSettings !== nextProps.onQueueSettings) return false;
  if (prevProps.onQueueAll !== nextProps.onQueueAll) return false;
  if (prevProps.maxParallelTasks !== nextProps.maxParallelTasks) return false;
  if (prevProps.archivedCount !== nextProps.archivedCount) return false;
  if (prevProps.showArchived !== nextProps.showArchived) return false;
  if (prevProps.onToggleArchived !== nextProps.onToggleArchived) return false;
  if (prevProps.onSelectAll !== nextProps.onSelectAll) return false;
  if (prevProps.onDeselectAll !== nextProps.onDeselectAll) return false;
  if (prevProps.onToggleSelect !== nextProps.onToggleSelect) return false;
  if (prevProps.isCollapsed !== nextProps.isCollapsed) return false;
  if (prevProps.onToggleCollapsed !== nextProps.onToggleCollapsed) return false;
  if (prevProps.columnWidth !== nextProps.columnWidth) return false;
  if (prevProps.isResizing !== nextProps.isResizing) return false;
  if (prevProps.onResizeStart !== nextProps.onResizeStart) return false;
  if (prevProps.onResizeEnd !== nextProps.onResizeEnd) return false;
  if (prevProps.isLocked !== nextProps.isLocked) return false;
  if (prevProps.onConsolidate !== nextProps.onConsolidate) return false;
  if (prevProps.extras !== nextProps.extras) return false;
  if (prevProps.onToggleLocked !== nextProps.onToggleLocked) return false;
  if (prevProps.flat !== nextProps.flat) return false;

  // Compare selection props
  const prevSelected = prevProps.selectedTaskIds;
  const nextSelected = nextProps.selectedTaskIds;
  if (prevSelected !== nextSelected) {
    if (!prevSelected || !nextSelected) return false;
    if (prevSelected.size !== nextSelected.size) return false;
    for (const id of prevSelected) {
      if (!nextSelected.has(id)) return false;
    }
  }

  // Deep compare tasks
  const tasksEqual = tasksAreEquivalent(prevProps.tasks, nextProps.tasks);

  // Only log when re-rendering (reduces noise)
  if (window.DEBUG && !tasksEqual) {
    console.log(`[DroppableColumn] Re-render: ${nextProps.status} column (${nextProps.tasks.length} tasks)`);
  }

  return tasksEqual;
}

/** Desktop: the column list scrolls inside the column. Phone (flat): it grows and the page scrolls. */
function ColumnListScroller({ flat, children }: { flat?: boolean; children: ReactNode }) {
  if (flat) return <div className="px-3 pb-3 pt-2">{children}</div>;
  return <ScrollArea className="h-full px-3 pb-3 pt-2">{children}</ScrollArea>;
}

/**
 * Pending Merge header rocket: merge every task oldest first (AI resolves conflicts),
 * run the verify command (AI fixes collisions), then deploy once. Two clicks to start.
 */
function DeployAllButton({ tasks }: { tasks: Task[] }) {
  const { t } = useTranslation(['deploy']);
  const projectId = tasks[0]?.projectId;
  const mergeOnly = useProjectStore((s) => isMergeOnly(s.projects.find((p) => p.id === projectId)?.settings));
  const batch = useDeployDialogStore((s) => (projectId ? s.batches[projectId] : undefined));
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);

  const label = batch
    ? t(`deploy:batch.step.${batch.step}`, { index: batch.index, total: batch.total })
    : armed
      ? t(mergeOnly ? 'deploy:batch.confirmMergeOnly' : 'deploy:batch.confirm', { count: tasks.length })
      : t(mergeOnly ? 'deploy:batch.mergeButton' : 'deploy:batch.button', { count: tasks.length });

  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <Button
          variant={armed ? 'destructive' : 'ghost'}
          size={armed || batch ? 'sm' : 'icon'}
          className={cn(
            'h-7 max-md:h-9',
            armed || batch ? 'px-2 text-xs' : 'w-7 max-md:w-9 hover:bg-primary/10 hover:text-primary'
          )}
          disabled={!!batch}
          aria-label={label}
          onClick={() => {
            if (!armed) {
              setArmed(true);
              return;
            }
            setArmed(false);
            useDeployDialogStore.getState().deployAll(tasks);
          }}
        >
          {batch ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
          {(armed || batch) && <span className="ml-1.5 whitespace-nowrap">{label}</span>}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{t(mergeOnly ? 'deploy:batch.mergeOnlyTooltip' : 'deploy:batch.tooltip')}</TooltipContent>
    </Tooltip>
  );
}

/** Done header: how many merged tasks are not live yet, and a rocket to deploy them (two clicks). */
function DeployNotLiveButton({ tasks }: { tasks: Task[] }) {
  const { t } = useTranslation(['deploy']);
  const mergeOnly = useProjectStore((s) => isMergeOnly(s.projects.find((p) => p.id === tasks[0]?.projectId)?.settings));
  const notLive = tasks.filter(isTaskNotLive);
  const projectId = tasks[0]?.projectId;
  const running = useDeployDialogStore((s) => (projectId ? s.runs[projectId] : undefined));
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);
  if (mergeOnly || (!running && notLive.length === 0)) return null;
  const label = running
    ? t(`deploy:runs.phase.${running.phase ?? 'running'}`, { step: running.currentStep ?? '' })
    : armed
      ? t('deploy:notLive.confirm', { count: notLive.length })
      : t('deploy:notLive.count', { count: notLive.length });
  return (
    <Button
      variant={armed ? 'destructive' : 'ghost'}
      size="sm"
      className={cn('h-7 px-2 text-xs max-md:h-9', !armed && !running && 'text-warning hover:bg-warning/10')}
      disabled={!!running}
      title={t('deploy:notLive.tooltip')}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        useDeployDialogStore.getState().deployTask(notLive[notLive.length - 1]);
      }}
    >
      {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
      <span className="ml-1.5 whitespace-nowrap">{label}</span>
    </Button>
  );
}

/** Horizontal swipe distance (px) that switches the phone column tab */
const SWIPE_THRESHOLD = 60;

type StatusColumn = typeof TASK_STATUS_COLUMNS[number];

const mobileTabStorageKey = (projectId: string) => `kanban-mobile-tab:${projectId}`;

function readStoredMobileTab(projectId: string | undefined): StatusColumn {
  if (projectId) {
    try {
      const stored = localStorage.getItem(mobileTabStorageKey(projectId));
      if (stored && isValidDropColumn(stored) && stored !== 'queue') return stored;
    } catch {
      // Storage unavailable (private mode etc.) — fall back to the first column
    }
  }
  return BOARD_COLUMNS[0];
}

function storeMobileTab(projectId: string | undefined, tab: StatusColumn) {
  if (!projectId) return;
  try {
    localStorage.setItem(mobileTabStorageKey(projectId), tab);
  } catch {
    // Best effort only
  }
}

// Empty state content for each column
const getEmptyStateContent = (status: TaskStatus, t: (key: string) => string): { icon: React.ReactNode; message: string; subtext?: string } => {
  switch (status) {
    case 'backlog':
      return {
        icon: <Inbox className="h-6 w-6 text-muted-foreground/50" />,
        message: t('kanban.emptyBacklog'),
        subtext: t('kanban.emptyBacklogHint')
      };
    case 'queue':
      return {
        icon: <Loader2 className="h-6 w-6 text-muted-foreground/50" />,
        message: t('kanban.emptyQueue'),
        subtext: t('kanban.emptyQueueHint')
      };
    case 'in_progress':
      return {
        icon: <Loader2 className="h-6 w-6 text-muted-foreground/50" />,
        message: t('kanban.emptyInProgress'),
        subtext: t('kanban.emptyInProgressHint')
      };
    case 'ai_review':
      return {
        icon: <Eye className="h-6 w-6 text-muted-foreground/50" />,
        message: t('kanban.emptyAiReview'),
        subtext: t('kanban.emptyAiReviewHint')
      };
    case 'human_review':
      return {
        icon: <Eye className="h-6 w-6 text-muted-foreground/50" />,
        message: t('kanban.emptyHumanReview'),
        subtext: t('kanban.emptyHumanReviewHint')
      };
    case 'pending_merge':
      return {
        icon: <GitMerge className="h-6 w-6 text-muted-foreground/50" />,
        message: t('kanban.emptyPendingMerge'),
        subtext: t('kanban.emptyPendingMergeHint')
      };
    case 'done':
      return {
        icon: <CheckCircle2 className="h-6 w-6 text-muted-foreground/50" />,
        message: t('kanban.emptyDone'),
        subtext: t('kanban.emptyDoneHint')
      };
    default:
      return {
        icon: <Inbox className="h-6 w-6 text-muted-foreground/50" />,
        message: t('kanban.emptyDefault')
      };
  }
};

const DroppableColumn = memo(function DroppableColumn({ status, tasks, onTaskClick, onStatusChange, isOver, onAddClick, onArchiveAll, onQueueSettings, onQueueAll, maxParallelTasks, archivedCount, showArchived, onToggleArchived, selectedTaskIds, onSelectAll, onDeselectAll, onToggleSelect, isCollapsed, onToggleCollapsed, columnWidth, isResizing, onResizeStart, onResizeEnd, isLocked, onToggleLocked, onConsolidate, extras, flat }: DroppableColumnProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const { setNodeRef } = useDroppable({
    id: status
  });

  // Rate-limit-paused tasks sit in this column but hold no slot, so the capacity
  // badge counts them separately from the tasks actually consuming parallelism.
  const rateLimitPauses = useTaskStore((state) => state.rateLimitPauses);
  const pausedTaskCount = status === 'in_progress'
    ? tasks.filter((t) => rateLimitPauses[t.id]).length
    : 0;
  // In Progress also lists the queue (status 'queue') below its running tasks
  const queuedCount = status === 'in_progress' ? tasks.filter((t) => t.status === 'queue').length : 0;
  const activeTaskCount = tasks.length - queuedCount - pausedTaskCount;
  // Auto-promotion stands down while any task is parked on a rate limit
  const isQueueHeldByRateLimit = queuedCount > 0 && Object.keys(rateLimitPauses).length > 0;

  // Calculate selection state for this column
  const taskCount = tasks.length;
  const columnSelectedCount = tasks.filter(t => selectedTaskIds?.has(t.id)).length;
  const isAllSelected = taskCount > 0 && columnSelectedCount === taskCount;
  const isSomeSelected = columnSelectedCount > 0 && columnSelectedCount < taskCount;

  // Determine checkbox checked state: true (all), 'indeterminate' (some), false (none)
  const selectAllCheckedState: boolean | 'indeterminate' = isAllSelected
    ? true
    : isSomeSelected
      ? 'indeterminate'
      : false;

  // Handle select all checkbox change
  const handleSelectAllChange = useCallback(() => {
    if (isAllSelected) {
      onDeselectAll?.();
    } else {
      onSelectAll?.();
    }
  }, [isAllSelected, onSelectAll, onDeselectAll]);

  // Memoize taskIds to prevent SortableContext from re-rendering unnecessarily
  const taskIds = useMemo(() => tasks.map((t) => t.id), [tasks]);

  // Create stable onClick handlers for each task to prevent unnecessary re-renders
  const onClickHandlers = useMemo(() => {
    const handlers = new Map<string, () => void>();
    tasks.forEach((task) => {
      handlers.set(task.id, () => onTaskClick(task));
    });
    return handlers;
  }, [tasks, onTaskClick]);

  // Create stable onStatusChange handlers for each task
  const onStatusChangeHandlers = useMemo(() => {
    const handlers = new Map<string, (newStatus: TaskStatus) => unknown>();
    tasks.forEach((task) => {
      handlers.set(task.id, (newStatus: TaskStatus) => onStatusChange(task.id, newStatus));
    });
    return handlers;
  }, [tasks, onStatusChange]);

  // Create stable onToggleSelect handlers for each task (for bulk selection)
  const onToggleSelectHandlers = useMemo(() => {
    if (!onToggleSelect) return null;
    const handlers = new Map<string, () => void>();
    tasks.forEach((task) => {
      handlers.set(task.id, () => onToggleSelect(task.id));
    });
    return handlers;
  }, [tasks, onToggleSelect]);

  // Memoize task card elements to prevent recreation on every render
  const taskCards = useMemo(() => {
    if (tasks.length === 0) return null;
    const isSelectable = !!onToggleSelectHandlers;
    const firstQueued = tasks.findIndex((t) => t.status === 'queue');
    // Review: a divider between AI reviews still running and what waits for the user
    const firstYours = tasks.some((t) => t.status === 'ai_review') ? tasks.findIndex((t) => t.status !== 'ai_review') : -1;
    return tasks.map((task, index) => (
      <Fragment key={task.id}>
      {index === firstYours && (
        <div className="flex items-center gap-2 pt-1 text-xs font-medium text-muted-foreground">
          <span>{t('tasks:kanban.yourReview', { count: tasks.length - firstYours })}</span>
          <div className="h-px flex-1 bg-border" />
        </div>
      )}
      {index === firstQueued && (
        <div className="flex items-center gap-2 pt-1 text-xs font-medium text-muted-foreground">
          <span>{t('tasks:queue.upNext', { count: tasks.length - firstQueued })}</span>
          <div className="h-px flex-1 bg-border" />
        </div>
      )}
      <div className={firstQueued >= 0 && index >= firstQueued ? 'flex gap-2' : undefined}>
      {firstQueued >= 0 && index >= firstQueued && (
        // Start order: 1 starts next
        <span className="w-4 shrink-0 pt-4 text-right text-xs font-medium tabular-nums text-muted-foreground">{index - firstQueued + 1}</span>
      )}
      <div className={firstQueued >= 0 && index >= firstQueued ? 'min-w-0 flex-1' : undefined}>
      <SortableTaskCard
        task={task}
        onClick={onClickHandlers.get(task.id)!}
        onStatusChange={onStatusChangeHandlers.get(task.id)}
        isSelectable={isSelectable}
        isSelected={isSelectable ? selectedTaskIds?.has(task.id) : undefined}
        onToggleSelect={onToggleSelectHandlers?.get(task.id)}
      />
      </div>
      </div>
      </Fragment>
    ));
  }, [tasks, onClickHandlers, onStatusChangeHandlers, onToggleSelectHandlers, selectedTaskIds, t]);

  const getColumnBorderColor = (): string => {
    switch (status) {
      case 'backlog':
        return 'column-backlog';
      case 'queue':
        return 'column-queue';
      case 'in_progress':
        return 'column-in-progress';
      case 'ai_review':
        return 'column-ai-review';
      case 'human_review':
        return 'column-human-review';
      case 'done':
        return 'column-done';
      default:
        return 'border-t-muted-foreground/30';
    }
  };

  const emptyState = getEmptyStateContent(status, t);

  // Collapsed state: show narrow vertical strip with rotated title and task count
  if (isCollapsed && !flat) {
    return (
      <div
        ref={setNodeRef}
        className={cn(
          'flex flex-col rounded-xl border border-white/5 bg-linear-to-b from-secondary/30 to-transparent backdrop-blur-sm transition-all duration-200',
          getColumnBorderColor(),
          'border-t-2',
          isOver && 'drop-zone-highlight'
        )}
        style={{ width: COLLAPSED_COLUMN_WIDTH_REM, minWidth: COLLAPSED_COLUMN_WIDTH_REM, maxWidth: COLLAPSED_COLUMN_WIDTH_REM }}
      >
        {/* Expand button at top */}
        <div className="flex justify-center p-2 border-b border-white/5">
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 max-md:h-9 max-md:w-9 hover:bg-primary/10 hover:text-primary transition-colors"
                onClick={onToggleCollapsed}
                aria-label={t('kanban.expandColumn')}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {t('kanban.expandColumn')}
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Rotated title and task count */}
        <div className="flex-1 flex flex-col items-center justify-center">
          <div
            className="flex items-center gap-2 whitespace-nowrap"
            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
          >
            <span className="column-count-badge">
              {tasks.length}
            </span>
            <h2 className="font-semibold text-sm text-foreground">
              {t(TASK_STATUS_LABELS[status])}
            </h2>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={flat ? 'relative flex w-full' : 'relative flex'}
      style={flat ? undefined : { width: columnWidth ? pxToRem(columnWidth) : DEFAULT_COLUMN_WIDTH_REM, minWidth: MIN_COLUMN_WIDTH_REM, maxWidth: MAX_COLUMN_WIDTH_REM, flexShrink: 0 }}
    >
      <div
        ref={setNodeRef}
        className={cn(
          // min-w-0: long card content must not widen the column past its set width
          'flex min-w-0 flex-1 flex-col rounded-xl border border-white/5 bg-linear-to-b from-secondary/30 to-transparent backdrop-blur-sm transition-all duration-200',
          getColumnBorderColor(),
          'border-t-2',
          isOver && 'drop-zone-highlight'
        )}
      >
        {/* Column header - enhanced styling */}
        <div className="flex items-center justify-between p-4 border-b border-white/5 max-md:px-3 max-md:py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {/* Collapse button */}
          {onToggleCollapsed && !flat && (
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 max-md:h-9 max-md:w-9 hover:bg-muted-foreground/10 hover:text-muted-foreground transition-colors"
                  onClick={onToggleCollapsed}
                  aria-label={t('kanban.collapseColumn')}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t('kanban.collapseColumn')}
              </TooltipContent>
            </Tooltip>
          )}
          {/* Select All checkbox for column */}
          {onSelectAll && onDeselectAll && (
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <div className="flex items-center">
                  <Checkbox
                    checked={selectAllCheckedState}
                    onCheckedChange={handleSelectAllChange}
                    disabled={taskCount === 0}
                    aria-label={isAllSelected ? t('kanban.deselectAll') : t('kanban.selectAll')}
                    className="h-4 w-4"
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {isAllSelected ? t('kanban.deselectAll') : t('kanban.selectAll')}
              </TooltipContent>
            </Tooltip>
          )}
          <h2 className="font-semibold text-sm text-foreground">
            {t(TASK_STATUS_LABELS[status])}
          </h2>
          {status === 'in_progress' && maxParallelTasks ? (
            // Count only tasks actually working — paused ones released their slot
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <span className={cn(
                  "column-count-badge",
                  activeTaskCount >= maxParallelTasks && "bg-warning/20 text-warning border-warning/30"
                )}>
                  {activeTaskCount}/{maxParallelTasks}
                  {pausedTaskCount > 0 && (
                    <span className="ml-1 opacity-70">+{pausedTaskCount}</span>
                  )}
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <span>
                  {pausedTaskCount > 0
                    ? t('tasks:queue.capacityWithPaused', { active: activeTaskCount, max: maxParallelTasks, paused: pausedTaskCount })
                    : t('tasks:queue.capacity', { active: activeTaskCount, max: maxParallelTasks })}
                </span>
              </TooltipContent>
            </Tooltip>
          ) : (
            <span className="column-count-badge">
              {tasks.length + (extras?.count ?? 0)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {extras?.action}
          {/* Lock toggle button - available for all columns */}
          {onToggleLocked && !flat && (
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    'h-7 w-7 max-md:h-9 max-md:w-9 transition-colors',
                    isLocked
                      ? 'text-amber-500 bg-amber-500/10 hover:bg-amber-500/20'
                      : 'hover:bg-muted-foreground/10 hover:text-muted-foreground'
                  )}
                  onClick={onToggleLocked}
                  aria-pressed={isLocked}
                  aria-label={isLocked ? t('kanban.unlockColumn') : t('kanban.lockColumn')}
                >
                  {isLocked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isLocked ? t('kanban.unlockColumn') : t('kanban.lockColumn')}
              </TooltipContent>
            </Tooltip>
          )}
          {status === 'backlog' && (
            <>
              {onConsolidate && tasks.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 max-md:h-9 max-md:w-9 hover:bg-primary/10 hover:text-primary transition-colors"
                  onClick={onConsolidate}
                  title={t('consolidate.button')}
                  aria-label={t('consolidate.button')}
                >
                  <Combine className="h-4 w-4" />
                </Button>
              )}
              {onQueueAll && tasks.length > 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 max-md:h-9 max-md:w-9 hover:bg-cyan-500/10 hover:text-cyan-400 transition-colors"
                  onClick={onQueueAll}
                  title={t('queue.queueAll')}
                >
                  <ListPlus className="h-4 w-4" />
                </Button>
              )}
              {onAddClick && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 max-md:h-9 max-md:w-9 hover:bg-primary/10 hover:text-primary transition-colors"
                  onClick={onAddClick}
                  aria-label={t('kanban.addTaskAriaLabel')}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              )}
            </>
          )}
          {onQueueSettings && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 max-md:h-9 max-md:w-9 hover:bg-cyan-500/10 hover:text-cyan-400 transition-colors"
              onClick={onQueueSettings}
              title={t('kanban.queueSettings')}
            >
              <Settings className="h-4 w-4" />
            </Button>
          )}
          {status === 'pending_merge' && tasks.length > 0 && <DeployAllButton tasks={tasks} />}
          {status === 'done' && <DeployNotLiveButton tasks={tasks} />}
          {status === 'done' && onArchiveAll && tasks.length > 0 && !showArchived && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 max-md:h-9 max-md:w-9 hover:bg-muted-foreground/10 hover:text-muted-foreground transition-colors"
              onClick={onArchiveAll}
              aria-label={t('tooltips.archiveAllDone')}
            >
              <Archive className="h-4 w-4" />
            </Button>
          )}
          {status === 'done' && archivedCount !== undefined && archivedCount > 0 && onToggleArchived && (
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    'h-7 w-7 max-md:h-9 max-md:w-9 transition-colors relative',
                    showArchived
                      ? 'text-primary bg-primary/10 hover:bg-primary/20'
                      : 'hover:bg-muted-foreground/10 hover:text-muted-foreground'
                  )}
                  onClick={onToggleArchived}
                  aria-pressed={showArchived}
                  aria-label={t('common:accessibility.toggleShowArchivedAriaLabel')}
                >
                  <Archive className="h-4 w-4" />
                  <span className="absolute -top-1 -right-1 text-[10px] font-medium bg-muted rounded-full min-w-[14px] h-[14px] flex items-center justify-center">
                    {archivedCount}
                  </span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {showArchived ? t('common:projectTab.hideArchived') : t('common:projectTab.showArchived')}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Task list */}
      <div className="flex-1 min-h-0">
        <ColumnListScroller flat={flat}>
          <SortableContext
            items={taskIds}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-3 min-h-[120px]">
              {/* Explain why a non-empty queue isn't moving */}
              {isQueueHeldByRateLimit && (
                <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2">
                  <PauseCircle className="h-4 w-4 shrink-0 text-warning mt-0.5" />
                  <span className="text-xs text-warning">
                    {t('tasks:queue.heldByRateLimit')}
                  </span>
                </div>
              )}
              {extras?.content}
              {tasks.length === 0 && extras?.content ? null : tasks.length === 0 ? (
                <div
                  className={cn(
                    'empty-column-dropzone flex flex-col items-center justify-center py-6',
                    isOver && 'active'
                  )}
                >
                  {isOver ? (
                    <>
                      <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center mb-2">
                        <Plus className="h-4 w-4 text-primary" />
                      </div>
                      <span className="text-sm font-medium text-primary">{t('kanban.dropHere')}</span>
                    </>
                  ) : (
                    <>
                      {emptyState.icon}
                      <span className="mt-2 text-sm font-medium text-muted-foreground/70">
                        {emptyState.message}
                      </span>
                      {emptyState.subtext && (
                        <span className="mt-0.5 text-xs text-muted-foreground/50">
                          {emptyState.subtext}
                        </span>
                      )}
                    </>
                  )}
                </div>
              ) : (
                taskCards
              )}
            </div>
          </SortableContext>
        </ColumnListScroller>
      </div>
      </div>

      {/* Resize handle on right edge */}
      {onResizeStart && onResizeEnd && !flat && (
        <div
          className={cn(
            "absolute right-0 top-0 bottom-0 w-1 touch-none z-10 max-md:hidden",
            "transition-colors duration-150",
            isLocked
              ? "cursor-not-allowed bg-transparent"
              : "cursor-col-resize hover:bg-primary/40",
            isResizing && !isLocked && "bg-primary/60"
          )}
          onMouseDown={(e) => {
            e.preventDefault();
            // Don't start resize if column is locked
            if (isLocked) return;
            onResizeStart(e.clientX);
          }}
          onTouchStart={(e) => {
            e.preventDefault();
            // Don't start resize if column is locked
            if (isLocked) return;
            if (e.touches.length > 0) {
              onResizeStart(e.touches[0].clientX);
            }
          }}
          title={isLocked ? t('kanban.columnLocked') : undefined}
        >
          {/* Wider invisible hit area for easier grabbing */}
          <div className="absolute inset-y-0 -left-1 -right-1" />
        </div>
      )}
    </div>
  );
}, droppableColumnPropsAreEqual);

export function KanbanBoard({ tasks, projectId: boardProjectId, leadingColumns = [], todoExtras, trailingColumns = [], onForeignDrop, renderForeignOverlay, onTaskClick, onNewTaskClick, onRefresh, isRefreshing }: KanbanBoardProps) {
  const { t } = useTranslation(['tasks', 'dialogs', 'common']);
  const { toast } = useToast();
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [activeForeignId, setActiveForeignId] = useState<string | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);
  const { showArchived, toggleShowArchived } = useViewState();

  // Project store for queue settings
  const projects = useProjectStore((state) => state.projects);

  // Kanban settings store for column preferences (collapse state, width, lock state)
  const columnPreferences = useKanbanSettingsStore((state) => state.columnPreferences);
  const loadKanbanPreferences = useKanbanSettingsStore((state) => state.loadPreferences);
  const saveKanbanPreferences = useKanbanSettingsStore((state) => state.savePreferences);
  const toggleColumnCollapsed = useKanbanSettingsStore((state) => state.toggleColumnCollapsed);
  const setColumnCollapsed = useKanbanSettingsStore((state) => state.setColumnCollapsed);
  const setColumnWidth = useKanbanSettingsStore((state) => state.setColumnWidth);

  // Column resize state
  const [resizingColumn, setResizingColumn] = useState<typeof TASK_STATUS_COLUMNS[number] | null>(null);
  const resizeStartX = useRef<number>(0);
  const resizeStartWidth = useRef<number>(0);
  // Capture projectId at resize start to avoid stale closure if project changes during resize
  const resizeProjectIdRef = useRef<string | null>(null);

  // Get projectId from first task
  const projectId = boardProjectId ?? tasks[0]?.projectId;
  const project = projectId ? projects.find((p) => p.id === projectId) : undefined;
  const maxParallelTasks = project?.settings?.maxParallelTasks ?? DEFAULT_MAX_PARALLEL_TASKS;

  // Phone layout: one column at a time, picked via sticky segmented tabs (remembered per project)
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState<StatusColumn>(() => readStoredMobileTab(projectId));
  // A planning-stage tab (leading column) shown instead of a status column
  const [mobileLeading, setMobileLeading] = useState<string | null>(null);
  const mobileTabIds = [...leadingColumns.map((c) => c.id), ...BOARD_COLUMNS, ...trailingColumns.map((c) => c.id)];
  const extraColumns = [...leadingColumns, ...trailingColumns];
  const currentMobileTab = mobileLeading ?? mobileTab;
  const mobileScrollRef = useRef<HTMLDivElement>(null);
  const mobileToolbarRef = useRef<HTMLDivElement>(null);
  const mobileTabListRef = useRef<HTMLDivElement>(null);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setMobileTab(readStoredMobileTab(projectId));
  }, [projectId]);

  // Keep the selected tab visible in the horizontally scrolling tab row
  useEffect(() => {
    if (!isMobile) return;
    const list = mobileTabListRef.current;
    const tab = list?.querySelector<HTMLElement>(`[data-tab="${currentMobileTab}"]`);
    if (!list || !tab) return;
    list.scrollLeft = tab.offsetLeft - (list.clientWidth - tab.offsetWidth) / 2;
  }, [isMobile, currentMobileTab]);

  const selectMobileTab = (tab: string) => {
    if (tab === currentMobileTab) return;
    if ((BOARD_COLUMNS as readonly string[]).includes(tab)) {
      setMobileLeading(null);
      setMobileTab(tab as StatusColumn);
      storeMobileTab(projectId, tab as StatusColumn);
    } else {
      setMobileLeading(tab);
    }
    // Show the new list from its top (just below the sticky tabs) if scrolled past it
    const scroller = mobileScrollRef.current;
    const toolbarHeight = mobileToolbarRef.current?.offsetHeight ?? 0;
    if (scroller && scroller.scrollTop > toolbarHeight) scroller.scrollTop = toolbarHeight;
  };

  const handleSwipeStart = (e: ReactTouchEvent) => {
    const touch = e.touches[0];
    swipeStart.current = e.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY } : null;
  };

  const handleSwipeEnd = (e: ReactTouchEvent) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    const touch = e.changedTouches[0];
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    // Mostly-horizontal gestures only, so vertical scrolling never switches columns
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const next = mobileTabIds[mobileTabIds.indexOf(currentMobileTab) + (dx < 0 ? 1 : -1)];
    if (next) selectMobileTab(next);
  };

  // Queue settings modal state
  const [showQueueSettings, setShowQueueSettings] = useState(false);
  // Store projectId when modal opens to prevent modal from disappearing if tasks change
  const queueSettingsProjectIdRef = useRef<string | null>(null);


  // Selection state for bulk actions (Human Review column)
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());

  // Bulk PR dialog state
  const [bulkPRDialogOpen, setBulkPRDialogOpen] = useState(false);

  // Delete confirmation dialog state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Worktree cleanup dialog state
  const [worktreeCleanupDialog, setWorktreeCleanupDialog] = useState<{
    open: boolean;
    taskId: string | null;
    taskTitle: string;
    worktreePath?: string;
    isProcessing: boolean;
    error?: string;
  }>({
    open: false,
    taskId: null,
    taskTitle: '',
    worktreePath: undefined,
    isProcessing: false,
    error: undefined
  });

  // Calculate archived count for Done column button
  const archivedCount = useMemo(() =>
    tasks.filter(t => t.metadata?.archivedAt).length,
    [tasks]
  );

  // Calculate collapsed column count for "Expand All" button
  const collapsedColumnCount = useMemo(() => {
    if (!columnPreferences) return 0;
    return BOARD_COLUMNS.filter(
      (status) => columnPreferences[status]?.isCollapsed
    ).length;
  }, [columnPreferences]);

  // Filter tasks based on archive status
  const filteredTasks = useMemo(() => {
    if (showArchived) {
      return tasks; // Show all tasks including archived
    }
    return tasks.filter((t) => !t.metadata?.archivedAt);
  }, [tasks, showArchived]);

  const sensors = useSensors(
    useSensor(MouseAndPenSensor, {
      activationConstraint: {
        distance: 8 // 8px movement required before drag starts
      }
    }),
    useSensor(TouchSensor, { activationConstraint: TOUCH_DRAG_ACTIVATION }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  );

  // Get task order from store for custom ordering
  const taskOrder = useTaskStore((state) => state.taskOrder);

  const tasksByStatus = useMemo(() => {
    // Note: pr_created tasks are shown in the 'done' column since they're essentially complete
    // Note: error tasks are shown in the 'human_review' column since they need human attention
    // Note: pending_merge tasks have their own column (AI completed, awaiting worktree merge)
    const grouped: Record<typeof TASK_STATUS_COLUMNS[number], Task[]> = {
      backlog: [],
      queue: [],
      in_progress: [],
      ai_review: [],
      human_review: [],
      pending_merge: [],
      done: []
    };

    filteredTasks.forEach((task) => {
      // Group by status (pr_created → pending_merge, error → human_review); queue and
      // ai_review keep their own groups here and are appended to their visual column below,
      // after the running work
      const targetColumn = getStatusGroup(task.status);
      if (grouped[targetColumn]) {
        grouped[targetColumn].push(task);
      }
    });

    // Sort tasks within each column
    Object.keys(grouped).forEach((status) => {
      const statusKey = status as typeof TASK_STATUS_COLUMNS[number];
      const columnTasks = grouped[statusKey];
      const columnOrder = taskOrder?.[statusKey];

      if (columnOrder && columnOrder.length > 0) {
        // Custom order exists: sort by order index
        // 1. Create a set of current task IDs for fast lookup (filters stale IDs)
        const currentTaskIds = new Set(columnTasks.map(t => t.id));

        // 2. Create valid order by filtering out stale IDs
        const validOrder = columnOrder.filter(id => currentTaskIds.has(id));
        const validOrderSet = new Set(validOrder);

        // 3. Find new tasks not in order (prepend at top)
        const newTasks = columnTasks.filter(t => !validOrderSet.has(t.id));
        // Sort new tasks by createdAt (newest first)
        newTasks.sort((a, b) => {
          const dateA = new Date(a.createdAt).getTime();
          const dateB = new Date(b.createdAt).getTime();
          return dateB - dateA;
        });

        // 4. Sort ordered tasks by their index in validOrder
        // Pre-compute index map for O(n) sorting instead of O(n²) with indexOf
        const indexMap = new Map(validOrder.map((id, idx) => [id, idx]));
        const orderedTasks = columnTasks
          .filter(t => validOrderSet.has(t.id))
          .sort((a, b) => (indexMap.get(a.id) ?? 0) - (indexMap.get(b.id) ?? 0));

        // 5. Prepend new tasks at top, then ordered tasks (the queue appends them, oldest first)
        grouped[statusKey] = statusKey === 'queue' ? [...orderedTasks, ...newTasks.reverse()] : [...newTasks, ...orderedTasks];
      } else if (statusKey === 'queue') {
        // Same order the main-process queue starts them in
        grouped.queue.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      } else {
        // No custom order: fallback to createdAt sort (newest first)
        grouped[statusKey].sort((a, b) => {
          const dateA = new Date(a.createdAt).getTime();
          const dateB = new Date(b.createdAt).getTime();
          return dateB - dateA;
        });
      }
    });

    // Done: latest merge first (tasks merged before merge times were recorded go last, newest first)
    const mergedTime = (t: Task) => (t.metadata?.mergedAt ? new Date(t.metadata.mergedAt).getTime() : 0);
    grouped.done.sort((a, b) => mergedTime(b) - mergedTime(a) || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    // In Progress shows the running tasks, then the queue in start order
    grouped.in_progress = [...grouped.in_progress, ...grouped.queue];
    // Review shows the AI reviews still running, then what waits for the user
    grouped.human_review = [...grouped.ai_review, ...grouped.human_review];
    return grouped;
  }, [filteredTasks, taskOrder]);

  // Prune stale IDs when tasks are deleted or filtered out
  useEffect(() => {
    const allTaskIds = new Set(filteredTasks.map(t => t.id));
    setSelectedTaskIds(prev => {
      const filtered = new Set([...prev].filter(id => allTaskIds.has(id)));
      return filtered.size === prev.size ? prev : filtered;
    });
  }, [filteredTasks]);

  // Selection callbacks for bulk actions (all columns)
  const toggleTaskSelection = useCallback((taskId: string) => {
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }, []);

  const selectAllTasks = useCallback((columnStatus?: typeof TASK_STATUS_COLUMNS[number]) => {
    if (columnStatus) {
      // Select all in specific column
      const columnTasks = tasksByStatus[columnStatus] || [];
      const columnIds = new Set(columnTasks.map((t: Task) => t.id));
      setSelectedTaskIds(prev => new Set<string>([...prev, ...columnIds]));
    } else {
      // Select all across all columns
      const allIds = new Set(filteredTasks.map(t => t.id));
      setSelectedTaskIds(allIds);
    }
  }, [tasksByStatus, filteredTasks]);

  const deselectAllTasks = useCallback(() => {
    setSelectedTaskIds(new Set());
  }, []);

  // Get selected task objects for bulk actions
  const selectedTasks = useMemo(() => {
    return filteredTasks.filter(task => selectedTaskIds.has(task.id));
  }, [filteredTasks, selectedTaskIds]);

  // Handle opening the bulk PR dialog
  const handleOpenBulkPRDialog = useCallback(() => {
    if (selectedTaskIds.size > 0) {
      setBulkPRDialogOpen(true);
    }
  }, [selectedTaskIds.size]);

  // Handle bulk PR dialog completion - clear selection
  const handleBulkPRComplete = useCallback(() => {
    deselectAllTasks();
  }, [deselectAllTasks]);

  // Handle opening delete confirmation dialog
  const handleOpenDeleteConfirm = useCallback(() => {
    if (selectedTaskIds.size > 0) {
      setDeleteConfirmOpen(true);
    }
  }, [selectedTaskIds.size]);

  // Handle confirmed bulk delete
  const handleConfirmDelete = useCallback(async () => {
    if (selectedTaskIds.size === 0) return;

    setIsDeleting(true);
    const taskIdsToDelete = Array.from(selectedTaskIds);
    const result = await deleteTasks(taskIdsToDelete);

    setIsDeleting(false);
    setDeleteConfirmOpen(false);

    if (result.success) {
      toast({
        title: t('kanban.deleteSuccess', { count: taskIdsToDelete.length }),
      });
      deselectAllTasks();
    } else {
      toast({
        title: t('kanban.deleteError'),
        description: result.error,
        variant: 'destructive',
      });
      // Still clear selection for successfully deleted tasks
      if (result.failedIds) {
        const remainingIds = new Set(result.failedIds);
        setSelectedTaskIds(remainingIds);
      }
    }
  }, [selectedTaskIds, deselectAllTasks, toast, t]);

  const handleArchiveAll = async () => {
    // Get projectId from the first task (all tasks should have the same projectId)
    const projectId = tasks[0]?.projectId;
    if (!projectId) {
      console.error('[KanbanBoard] No projectId found');
      return;
    }

    const doneTaskIds = tasksByStatus.done.map((t) => t.id);
    if (doneTaskIds.length === 0) return;

    const result = await archiveTasks(projectId, doneTaskIds);
    if (!result.success) {
      console.error('[KanbanBoard] Failed to archive tasks:', result.error);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    // A long-press drag on the phone must not also count as a column swipe
    swipeStart.current = null;
    const { active } = event;
    const task = tasks.find((t) => t.id === active.id);
    if (task) {
      setActiveTask(task);
    } else {
      setActiveForeignId(String(active.id));
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event;

    if (!over) {
      setOverColumnId(null);
      return;
    }

    const overId = over.id as string;

    // Check if over a column
    if (isValidDropColumn(overId)) {
      setOverColumnId(overId);
      return;
    }

    // Check if over a task - get its column
    const overTask = tasks.find((t) => t.id === overId);
    if (overTask) {
      setOverColumnId(getVisualColumn(overTask.status));
    }
  };

  /**
   * Handle status change with worktree cleanup dialog support
   * Consolidated handler that accepts an optional task object for the dialog title
   */
  const handleStatusChange = async (taskId: string, requestedStatus: TaskStatus, providedTask?: Task) => {
    const task = providedTask || tasks.find(t => t.id === taskId);
    let newStatus = requestedStatus;

    // ============================================
    // QUEUE SYSTEM: Enforce parallel task limit
    // Called from both the dropdown menu and the drag-and-drop handler.
    // Excludes the task itself from the count to handle re-entry (e.g., redundant
    // status change or race with auto-promotion). processQueue auto-promotion
    // calls persistTaskStatus directly, never this function.
    // ============================================
    if (newStatus === 'in_progress' && isQueueAtCapacity(taskId)) {
      console.log('[Queue] In Progress full, redirecting task to Queue');
      newStatus = 'queue';
    }

    const oldStatus = task?.status;
    const result = await persistTaskStatus(taskId, newStatus);

    if (!result.success) {
      if (result.worktreeExists) {
        // Show the worktree cleanup dialog
        setWorktreeCleanupDialog({
          open: true,
          taskId: taskId,
          taskTitle: task?.title || t('tasks:untitled'),
          worktreePath: result.worktreePath,
          isProcessing: false,
          error: undefined
        });
      } else {
        // Show error toast for other failures
        toast({
          title: t('common:errors.operationFailed'),
          description: result.error || t('common:errors.unknownError'),
          variant: 'destructive'
        });
      }
    }
    // Note: queue auto-promotion when a task leaves in_progress is handled by the
    // useEffect task status change listener (registerTaskStatusChangeListener), so
    // no explicit processQueue() call is needed here.
  };

  /**
   * Handle worktree cleanup confirmation
   */
  const handleWorktreeCleanupConfirm = async () => {
    if (!worktreeCleanupDialog.taskId) return;

    setWorktreeCleanupDialog(prev => ({ ...prev, isProcessing: true, error: undefined }));

    const result = await forceCompleteTask(worktreeCleanupDialog.taskId);

    if (result.success) {
      setWorktreeCleanupDialog({
        open: false,
        taskId: null,
        taskTitle: '',
        worktreePath: undefined,
        isProcessing: false,
        error: undefined
      });
    } else {
      // Keep dialog open with error state for retry - show actual error if available
      setWorktreeCleanupDialog(prev => ({
        ...prev,
        isProcessing: false,
        error: result.error || t('dialogs:worktreeCleanup.errorDescription')
      }));
    }
  };

  /**
   * Move all backlog tasks to queue
   */
  // Consolidate (To do column)
  const [showConsolidate, setShowConsolidate] = useState(false);
  const openConsolidate = useCallback(() => setShowConsolidate(true), []);

  const handleQueueAll = async () => {
    const backlogTasks = tasksByStatus.backlog;
    if (backlogTasks.length === 0) return;

    let movedCount = 0;
    for (const task of backlogTasks) {
      const result = await persistTaskStatus(task.id, 'queue');
      if (result.success) {
        movedCount++;
      } else {
        console.error(`[Queue] Failed to move task ${task.id} to queue:`, result.error);
      }
    }

    // Auto-promote queued tasks to fill available capacity
    await processQueue();

    toast({
      title: t('queue.queueAllSuccess', { count: movedCount }),
      variant: 'default'
    });
  };

  /**
   * Save queue settings (maxParallelTasks)
   *
   * Uses the stored ref value to ensure the save works even if tasks
   * change while the modal is open.
   */
  const handleSaveQueueSettings = async (maxParallel: number) => {
    const savedProjectId = queueSettingsProjectIdRef.current || projectId;
    if (!savedProjectId) return;

    const success = await updateProjectSettings(savedProjectId, { maxParallelTasks: maxParallel });
    if (success) {
      toast({
        title: t('queue.settings.saved'),
        variant: 'default'
      });
    } else {
      toast({
        title: t('queue.settings.saveFailed'),
        description: t('queue.settings.retry'),
        variant: 'destructive'
      });
    }
  };

  /**
   * Automatically move tasks from Queue to In Progress to fill available capacity
   * Promotes multiple tasks if needed (e.g., after bulk queue)
   */
  // The queue runs in the main process for every project; this just nudges it now
  const processQueue = useCallback(async () => {
    await window.electronAPI.processTaskQueue(projectId);
  }, [projectId]);

  // Register task status change listener for queue auto-promotion
  // This ensures processQueue() is called whenever a task leaves in_progress
  useEffect(() => {
    const unregister = useTaskStore.getState().registerTaskStatusChangeListener(
      (taskId, oldStatus, newStatus) => {
        // When a task leaves in_progress (e.g., goes to human_review), process the queue
        if (oldStatus === 'in_progress' && newStatus !== 'in_progress') {
          console.log(`[Queue] Task ${taskId} left in_progress, processing queue to fill slot`);
          processQueue();
        }
      }
    );

    // Cleanup: unregister listener when component unmounts
    return unregister;
  }, [processQueue]);

  // Re-run the queue when a rate-limit pause clears: the parked task resumes and
  // any slots freed while it waited can now be filled.
  useEffect(() => {
    return useTaskStore.subscribe((state, prev) => {
      if (state.rateLimitPauses === prev.rateLimitPauses) return;
      const cleared =
        Object.keys(state.rateLimitPauses).length < Object.keys(prev.rateLimitPauses).length;
      if (cleared) {
        console.log('[Queue] Rate limit pause cleared, processing queue');
        processQueue();
      }
    });
  }, [processQueue]);

  // Get task order actions from store
  const reorderTasksInColumn = useTaskStore((state) => state.reorderTasksInColumn);
  const moveTaskToColumnTop = useTaskStore((state) => state.moveTaskToColumnTop);
  const saveTaskOrderToStorage = useTaskStore((state) => state.saveTaskOrder);
  const loadTaskOrder = useTaskStore((state) => state.loadTaskOrder);
  const setTaskOrder = useTaskStore((state) => state.setTaskOrder);

  const saveTaskOrder = useCallback((projectIdToSave: string) => {
    const success = saveTaskOrderToStorage(projectIdToSave);
    if (!success) {
      toast({
        title: t('kanban.orderSaveFailedTitle'),
        description: t('kanban.orderSaveFailedDescription'),
        variant: 'destructive'
      });
    }
    return success;
  }, [saveTaskOrderToStorage, toast, t]);

  // Load task order on mount and when project changes; the queue's order lives in
  // the main process (it decides what starts next), so take that one from there
  useEffect(() => {
    if (!projectId) return;
    loadTaskOrder(projectId);
    let cancelled = false;
    void window.electronAPI.getTaskQueueOrder(projectId).then((queue) => {
      const current = useTaskStore.getState().taskOrder;
      if (!cancelled && current && queue.length > 0) setTaskOrder({ ...current, queue });
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, loadTaskOrder, setTaskOrder]);

  /** Save a new queue order (first starts first) here and in the main process */
  const saveQueueOrder = useCallback((queue: string[]) => {
    const current = useTaskStore.getState().taskOrder;
    if (!projectId || !current) return;
    setTaskOrder({ ...current, queue });
    saveTaskOrder(projectId);
    void window.electronAPI.setTaskQueueOrder(projectId, queue);
  }, [projectId, setTaskOrder, saveTaskOrder]);

  // Load kanban column preferences on mount and when project changes
  useEffect(() => {
    if (projectId) {
      loadKanbanPreferences(projectId);
    }
  }, [projectId, loadKanbanPreferences]);

  // Create a callback to toggle collapsed state and save to storage
  const handleToggleColumnCollapsed = useCallback((status: typeof TASK_STATUS_COLUMNS[number]) => {
    // Capture projectId at function start to avoid stale closure in setTimeout
    const currentProjectId = projectId;
    toggleColumnCollapsed(status);
    // Save preferences after toggling
    if (currentProjectId) {
      // Use setTimeout to ensure state is updated before saving
      setTimeout(() => {
        saveKanbanPreferences(currentProjectId);
      }, 0);
    }
  }, [toggleColumnCollapsed, saveKanbanPreferences, projectId]);

  // Create a callback to expand all collapsed columns and save to storage
  const handleExpandAll = useCallback(() => {
    // Capture projectId at function start to avoid stale closure in setTimeout
    const currentProjectId = projectId;
    // Expand all collapsed columns
    for (const status of TASK_STATUS_COLUMNS) {
      if (columnPreferences?.[status]?.isCollapsed) {
        setColumnCollapsed(status, false);
      }
    }
    // Save preferences after expanding
    if (currentProjectId) {
      setTimeout(() => {
        saveKanbanPreferences(currentProjectId);
      }, 0);
    }
  }, [columnPreferences, setColumnCollapsed, saveKanbanPreferences, projectId]);

  // Create a callback to toggle locked state and save to storage

  // Resize handlers for column width adjustment
  const handleResizeStart = useCallback((status: typeof TASK_STATUS_COLUMNS[number], startX: number) => {
    const currentWidth = columnPreferences?.[status]?.width ?? DEFAULT_COLUMN_WIDTH;
    resizeStartX.current = startX;
    resizeStartWidth.current = currentWidth;
    // Capture projectId at resize start to ensure we save to the correct project
    resizeProjectIdRef.current = projectId ?? null;
    setResizingColumn(status);
  }, [columnPreferences, projectId]);

  const handleResizeMove = useCallback((clientX: number) => {
    if (!resizingColumn) return;

    const scaleFactor = parseFloat(getComputedStyle(document.documentElement).fontSize) / BASE_FONT_SIZE;
    const deltaX = (clientX - resizeStartX.current) / scaleFactor;
    const newWidth = Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, resizeStartWidth.current + deltaX));
    setColumnWidth(resizingColumn, newWidth);
  }, [resizingColumn, setColumnWidth]);

  const handleResizeEnd = useCallback(() => {
    // Use the projectId captured at resize start to avoid saving to wrong project
    const savedProjectId = resizeProjectIdRef.current;
    if (resizingColumn && savedProjectId) {
      saveKanbanPreferences(savedProjectId);
    }
    setResizingColumn(null);
    resizeProjectIdRef.current = null;
  }, [resizingColumn, saveKanbanPreferences]);

  // Document-level event listeners for resize dragging
  useEffect(() => {
    if (!resizingColumn) return;

    const handleMouseMove = (e: MouseEvent) => {
      handleResizeMove(e.clientX);
    };

    const handleMouseUp = () => {
      handleResizeEnd();
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 0) return;
      handleResizeMove(e.touches[0].clientX);
    };

    const handleTouchEnd = () => {
      handleResizeEnd();
    };

    // Prevent text selection and set resize cursor during drag
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);

    return () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [resizingColumn, handleResizeMove, handleResizeEnd]);

  // Clean up stale task IDs from order when tasks change (e.g., after deletion)
  // This ensures the persisted order doesn't contain IDs for deleted tasks
  useEffect(() => {
    if (!projectId || !taskOrder) return;

    // Build a set of current task IDs for fast lookup
    const currentTaskIds = new Set(tasks.map(t => t.id));

    // Check each column for stale IDs
    let hasStaleIds = false;
    const cleanedOrder: typeof taskOrder = {
      backlog: [],
      queue: [],
      in_progress: [],
      ai_review: [],
      human_review: [],
      pending_merge: [],
      done: [],
      pr_created: [],
      error: []
    };

    for (const status of Object.keys(taskOrder) as Array<keyof typeof taskOrder>) {
      const columnOrder = taskOrder[status] || [];
      const cleanedColumnOrder = columnOrder.filter(id => currentTaskIds.has(id));

      cleanedOrder[status] = cleanedColumnOrder;

      // Check if any IDs were removed
      if (cleanedColumnOrder.length !== columnOrder.length) {
        hasStaleIds = true;
      }
    }

    // If stale IDs were found, update the order and persist
    if (hasStaleIds) {
      setTaskOrder(cleanedOrder);
      saveTaskOrder(projectId);
    }
  }, [tasks, taskOrder, projectId, setTaskOrder, saveTaskOrder]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTask(null);
    setActiveForeignId(null);
    setOverColumnId(null);

    if (!over) return;

    const activeTaskId = active.id as string;
    const overId = over.id as string;

    // Ideas and roadmap features: the board owner decides what a drop means
    if (!tasks.some((t) => t.id === activeTaskId)) {
      if (overId.startsWith('stage:')) onForeignDrop?.(activeTaskId, { stage: overId.slice('stage:'.length) });
      else if (isValidDropColumn(overId)) onForeignDrop?.(activeTaskId, { taskColumn: overId });
      else {
        const overTask = tasks.find((t) => t.id === overId);
        if (overTask) onForeignDrop?.(activeTaskId, { taskColumn: overTask.status });
      }
      return;
    }

    // Get the task being dragged
    const task = tasks.find((t) => t.id === activeTaskId);
    if (!task) return;
    const overTask = isValidDropColumn(overId) ? undefined : tasks.find((t) => t.id === overId);
    const targetColumn = isValidDropColumn(overId) ? getVisualColumn(overId) : overTask ? getVisualColumn(overTask.status) : null;
    if (!targetColumn) return;

    // In Progress: a drop joins the queue (at the card it was dropped on, else last);
    // the main-process queue starts it when a slot is free. Running cards stay put.
    if (targetColumn === 'in_progress') {
      if (task.status === 'in_progress') return;
      const queue = tasksByStatus.queue.map((t) => t.id).filter((id) => id !== activeTaskId);
      const at = overTask?.status === 'queue' ? queue.indexOf(overTask.id) : -1;
      queue.splice(at >= 0 ? at : queue.length, 0, activeTaskId);
      saveQueueOrder(queue);
      if (task.status !== 'queue') {
        await handleStatusChange(activeTaskId, 'queue', task);
        await processQueue();
      }
      return;
    }

    const taskVisualColumn = getVisualColumn(task.status);
    if (overTask && taskVisualColumn === targetColumn) {
      // Same visual column: reorder within column
      // Ensure both tasks are in the order array before reordering
      // This handles tasks that existed before ordering was enabled
      const currentColumnOrder = taskOrder?.[targetColumn] ?? [];
      if (!currentColumnOrder.includes(activeTaskId) || !currentColumnOrder.includes(overId)) {
        // Sync the current visual order to the stored order
        setTaskOrder({
          ...taskOrder,
          [targetColumn]: tasksByStatus[targetColumn].map(t => t.id)
        } as TaskOrderState);
      }
      reorderTasksInColumn(targetColumn, activeTaskId, overId);
      if (projectId) saveTaskOrder(projectId);
      return;
    }

    if (overTask) {
      // Different visual column: move to the top of that task's column
      moveTaskToColumnTop(activeTaskId, targetColumn, taskVisualColumn);
      if (projectId) saveTaskOrder(projectId);
    }

    // A drop on a card takes that card's status, except in Review (a running AI review
    // isn't a status to move into)
    const newStatus: TaskStatus = overTask && targetColumn !== 'human_review' ? overTask.status : targetColumn;
    if (newStatus === task.status) return;

    // Persist status change via handleStatusChange which enforces queue capacity
    // and handles worktree cleanup dialogs
    await handleStatusChange(activeTaskId, newStatus, task);
  };

  const renderColumn = (status: StatusColumn, flat = false) => (
    <DroppableColumn
      key={status}
      status={status}
      tasks={tasksByStatus[status]}
      onTaskClick={onTaskClick}
      onStatusChange={handleStatusChange}
      isOver={overColumnId === status}
      onAddClick={status === 'backlog' ? onNewTaskClick : undefined}
      onQueueAll={status === 'backlog' ? handleQueueAll : undefined}
      onConsolidate={status === 'backlog' ? openConsolidate : undefined}
      extras={status === 'backlog' ? todoExtras : undefined}
      onQueueSettings={status === 'in_progress' ? () => {
        // Only open modal if we have a valid projectId
        if (!projectId) return;
        queueSettingsProjectIdRef.current = projectId;
        setShowQueueSettings(true);
      } : undefined}
      onArchiveAll={status === 'done' ? handleArchiveAll : undefined}
      maxParallelTasks={status === 'in_progress' ? maxParallelTasks : undefined}
      archivedCount={status === 'done' ? archivedCount : undefined}
      showArchived={status === 'done' ? showArchived : undefined}
      onToggleArchived={status === 'done' ? toggleShowArchived : undefined}
      selectedTaskIds={selectedTaskIds}
      onSelectAll={() => selectAllTasks(status)}
      onDeselectAll={deselectAllTasks}
      onToggleSelect={toggleTaskSelection}
      isCollapsed={columnPreferences?.[status]?.isCollapsed}
      onToggleCollapsed={() => handleToggleColumnCollapsed(status)}
      columnWidth={columnPreferences?.[status]?.width}
      isResizing={resizingColumn === status}
      onResizeStart={(startX) => handleResizeStart(status, startX)}
      onResizeEnd={handleResizeEnd}
      flat={flat}
    />
  );

  return (
    <div
      ref={mobileScrollRef}
      // Phone: the page itself scrolls (toolbar scrolls away, tabs stay pinned)
      className={isMobile ? 'h-full overflow-y-auto overscroll-contain' : 'flex h-full flex-col'}
    >
      {/* Kanban header with refresh button and expand all */}
      {isMobile ? (
        onRefresh && (
          <div ref={mobileToolbarRef} className="flex items-center justify-end px-3 pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="h-9 gap-2 text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
              {isRefreshing ? t('common:buttons.refreshing') : t('tasks:refreshTasks')}
            </Button>
          </div>
        )
      ) : (onRefresh || collapsedColumnCount >= 3) && (
        <div className="flex items-center justify-between px-6 pt-4 pb-2">
          <div className="flex items-center gap-2">
            {/* Expand All button - appears when 3+ columns are collapsed */}
            {collapsedColumnCount >= 3 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleExpandAll}
                className="gap-2 text-muted-foreground hover:text-foreground"
              >
                <ChevronsRight className="h-4 w-4" />
                {t('tasks:kanban.expandAll')}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {onRefresh && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onRefresh}
                disabled={isRefreshing}
                className="gap-2 text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
                {isRefreshing ? t('common:buttons.refreshing') : t('tasks:refreshTasks')}
              </Button>
            )}
          </div>
        </div>
      )}
      {/* Kanban columns */}
      <DndContext
        sensors={sensors}
        collisionDetection={cardFirstCollision}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        {isMobile ? (
          <>
            {/* Sticky segmented column tabs with counts; the row scrolls sideways */}
            <div className="sticky top-0 z-10 border-b border-border bg-background">
              <div
                ref={mobileTabListRef}
                role="tablist"
                aria-label={t('tasks:kanban.columnTabsLabel')}
                className="mx-3 my-2 flex gap-0.5 overflow-x-auto rounded-lg bg-secondary/60 p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {leadingColumns.map((column) => {
                  const selected = column.id === currentMobileTab;
                  return (
                    <button
                      key={column.id}
                      type="button"
                      role="tab"
                      data-tab={column.id}
                      aria-selected={selected}
                      onClick={() => selectMobileTab(column.id)}
                      className={cn(
                        'flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                        selected ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
                      )}
                    >
                      {column.label}
                      <span className="tabular-nums text-muted-foreground">{column.count}</span>
                    </button>
                  );
                })}
                {BOARD_COLUMNS.map((status) => {
                  const selected = status === currentMobileTab;
                  return (
                    <button
                      key={status}
                      type="button"
                      role="tab"
                      data-tab={status}
                      aria-selected={selected}
                      onClick={() => selectMobileTab(status)}
                      className={cn(
                        'flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                        selected ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
                      )}
                    >
                      {t(TASK_STATUS_LABELS[status])}
                      <span className="tabular-nums text-muted-foreground">{tasksByStatus[status].length}</span>
                    </button>
                  );
                })}
                {trailingColumns.map((column) => {
                  const selected = column.id === currentMobileTab;
                  return (
                    <button
                      key={column.id}
                      type="button"
                      role="tab"
                      data-tab={column.id}
                      aria-selected={selected}
                      onClick={() => selectMobileTab(column.id)}
                      className={cn(
                        'flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                        selected ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
                      )}
                    >
                      {column.label}
                      <span className="tabular-nums text-muted-foreground">{column.count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div
              className="min-h-[60vh] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
              onTouchStart={handleSwipeStart}
              onTouchEnd={handleSwipeEnd}
              onTouchCancel={() => {
                swipeStart.current = null;
              }}
            >
              {mobileLeading
                ? extraColumns.find((c) => c.id === mobileLeading)?.render(true)
                : renderColumn(mobileTab, true)}
            </div>
          </>
        ) : (
          <div className="flex flex-1 gap-4 overflow-x-auto p-6">
            {leadingColumns.map((column) => column.render(false))}
            {BOARD_COLUMNS.map((status) => renderColumn(status))}
            {trailingColumns.map((column) => column.render(false))}
          </div>
        )}

        {/* Drag overlay - enhanced visual feedback */}
        <DragOverlay>
          {activeTask ? (
            <div className="drag-overlay-card">
              <TaskCard task={activeTask} onClick={() => {}} />
            </div>
          ) : activeForeignId ? (
            <div className="drag-overlay-card w-80">{renderForeignOverlay?.(activeForeignId)}</div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {projectId && (
        <ConsolidateTasksDialog
          open={showConsolidate}
          onOpenChange={setShowConsolidate}
          projectId={projectId}
          tasks={tasksByStatus.backlog}
          onApplied={async () => undefined}
        />
      )}

      {selectedTaskIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-md:bottom-[max(1rem,env(safe-area-inset-bottom))] max-md:w-[calc(100vw-1.5rem)]">
          <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-border bg-card shadow-lg backdrop-blur-sm max-md:flex-wrap max-md:justify-center max-md:gap-2 max-md:px-3">
            <span className="text-sm font-medium text-foreground">
              {t('kanban.selectedCountOther', { count: selectedTaskIds.size })}
            </span>
            <div className="w-px h-5 bg-border" />
            <Button
              variant="default"
              size="sm"
              className="gap-2"
              onClick={handleOpenBulkPRDialog}
            >
              <GitPullRequest className="h-4 w-4" />
              {t('kanban.createPRs')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={handleOpenDeleteConfirm}
            >
              <Trash2 className="h-4 w-4" />
              {t('kanban.deleteSelected')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 text-muted-foreground hover:text-foreground"
              onClick={deselectAllTasks}
            >
              <X className="h-4 w-4" />
              {t('kanban.clearSelection')}
            </Button>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent className="sm:max-w-[500px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              {t('kanban.deleteConfirmTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('kanban.deleteConfirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Task List Preview */}
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('kanban.tasksToDelete')}</label>
            <ScrollArea className="h-32 rounded-md border border-border p-2">
              <div className="space-y-1">
                {selectedTasks.map((task, idx) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-2 text-sm py-1 px-2 rounded hover:bg-muted/50"
                  >
                    <span className="text-muted-foreground">{idx + 1}.</span>
                    <span className="truncate">{task.title}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Warning message */}
          <p className="text-sm text-destructive">
            {t('kanban.deleteWarning')}
          </p>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              {t('common:buttons.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('common:buttons.deleting')}
                </>
              ) : (
                t('kanban.deleteConfirmButton', { count: selectedTaskIds.size })
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Worktree cleanup confirmation dialog */}
      <WorktreeCleanupDialog
        open={worktreeCleanupDialog.open}
        taskTitle={worktreeCleanupDialog.taskTitle}
        worktreePath={worktreeCleanupDialog.worktreePath}
        isProcessing={worktreeCleanupDialog.isProcessing}
        error={worktreeCleanupDialog.error}
        onOpenChange={(open) => {
          if (!open && !worktreeCleanupDialog.isProcessing) {
            setWorktreeCleanupDialog(prev => ({ ...prev, open: false, error: undefined }));
          }
        }}
        onConfirm={handleWorktreeCleanupConfirm}
      />

      {/* Queue Settings Modal */}
      {(queueSettingsProjectIdRef.current || projectId) && (
        <QueueSettingsModal
          open={showQueueSettings}
          onOpenChange={(open) => {
            setShowQueueSettings(open);
            if (!open) {
              queueSettingsProjectIdRef.current = null;
            }
          }}
          projectId={queueSettingsProjectIdRef.current || projectId || ''}
          currentMaxParallel={maxParallelTasks}
          onSave={handleSaveQueueSettings}
        />
      )}

      {/* Bulk PR creation dialog */}
      <BulkPRDialog
        open={bulkPRDialogOpen}
        tasks={selectedTasks}
        onOpenChange={setBulkPRDialogOpen}
        onComplete={handleBulkPRComplete}
      />
    </div>
  );
}
