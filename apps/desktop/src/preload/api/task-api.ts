import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type {
  Task,
  IPCResult,
  TaskStartOptions,
  TaskStatus,
  TaskRecoveryResult,
  ImplementationPlan,
  TaskMetadata,
  TaskLogs,
  TaskLogStreamChunk,
  ReviewReason,
  MergeProgress,
  SupportedIDE,
  SupportedTerminal,
  WorktreeCreatePROptions,
  WorktreeCreatePRResult,
  ImageAttachment,
  RefineRunStatus
} from '../../shared/types';

export interface TaskAPI {
  // Task Operations
  getTasks: (projectId: string, options?: { forceRefresh?: boolean }) => Promise<IPCResult<Task[]>>;
  createTask: (
    projectId: string,
    title: string,
    description: string,
    metadata?: TaskMetadata
  ) => Promise<IPCResult<Task>>;
  deleteTask: (taskId: string) => Promise<IPCResult>;
  updateTask: (
    taskId: string,
    updates: { title?: string; description?: string; metadata?: Partial<TaskMetadata> }
  ) => Promise<IPCResult<Task>>;
  startTask: (taskId: string, options?: TaskStartOptions) => void;
  stopTask: (taskId: string) => void;
  /** AI groups Planning tasks that belong together (read-only preview) */
  consolidateTasksPreview: (
    projectId: string,
    tasks: Array<{ specId: string; title: string }>
  ) => Promise<IPCResult<import('../../main/ipc-handlers/task/consolidate-handlers').ConsolidatePreview>>;
  /** Point roadmap features linked to merged tasks at the consolidated task */
  relinkConsolidatedSpecs: (projectId: string, mapping: Record<string, string>) => Promise<IPCResult>;
  /** Stop after the current subtask */
  stopTaskSafe: (taskId: string) => void;
  /** Promote queued tasks now (the main-process queue also runs on its own) */
  processTaskQueue: (projectId?: string) => Promise<void>;
  getTaskQueueOrder: (projectId: string) => Promise<string[]>;
  setTaskQueueOrder: (projectId: string, taskIds: string[]) => Promise<void>;
  submitReview: (
    taskId: string,
    approved: boolean,
    feedback?: string,
    images?: ImageAttachment[]
  ) => Promise<IPCResult>;
  updateTaskStatus: (
    taskId: string,
    status: TaskStatus,
    options?: { forceCleanup?: boolean; keepWorktree?: boolean }
  ) => Promise<IPCResult & { worktreeExists?: boolean; worktreePath?: string }>;
  recoverStuckTask: (
    taskId: string,
    options?: import('../../shared/types').TaskRecoveryOptions
  ) => Promise<IPCResult<TaskRecoveryResult>>;
  checkTaskRunning: (taskId: string) => Promise<IPCResult<boolean>>;
  resumePausedTask: (taskId: string) => Promise<IPCResult>;

  // Worktree Change Detection
  checkWorktreeChanges: (taskId: string) => Promise<IPCResult<{ hasChanges: boolean; worktreePath?: string; changedFileCount?: number }>>;

  // Image Operations
  loadImageThumbnail: (projectPath: string, specId: string, imagePath: string) => Promise<IPCResult<string>>;

  // Workspace Management (for human review)
  getWorktreeStatus: (taskId: string) => Promise<IPCResult<import('../../shared/types').WorktreeStatus>>;
  getWorktreeDiff: (taskId: string) => Promise<IPCResult<import('../../shared/types').WorktreeDiff>>;
  getMergeInfo: (taskId: string) => Promise<IPCResult<import('../../shared/types').WorktreeMergeInfo>>;
  mergeWorktree: (taskId: string, options?: { noCommit?: boolean; quickMerge?: boolean }) => Promise<IPCResult<import('../../shared/types').WorktreeMergeResult>>;
  mergeWorktreePreview: (taskId: string) => Promise<IPCResult<import('../../shared/types').WorktreeMergeResult>>;
  postMergePush: (taskId: string, targetBranch: string) => Promise<IPCResult<{ pushed: boolean }>>;
  postMergeCleanup: (taskId: string) => Promise<IPCResult<{ cleaned: boolean }>>;
  syncWorktree: (taskId: string, targetBranch?: string) => Promise<IPCResult<import('../../shared/types').WorktreeSyncResult>>;
  resetTask: (taskId: string) => Promise<IPCResult<{ reset: boolean }>>;
  discardWorktree: (taskId: string, skipStatusChange?: boolean) => Promise<IPCResult<import('../../shared/types').WorktreeDiscardResult>>;
  discardOrphanedWorktree: (projectId: string, specName: string) => Promise<IPCResult<import('../../shared/types').WorktreeDiscardResult>>;
  clearStagedState: (taskId: string) => Promise<IPCResult<{ cleared: boolean }>>;
  listWorktrees: (projectId: string, options?: { includeStats?: boolean }) => Promise<IPCResult<import('../../shared/types').WorktreeListResult>>;
  worktreeOpenInIDE: (worktreePath: string, ide: SupportedIDE, customPath?: string) => Promise<IPCResult<{ opened: boolean }>>;
  worktreeOpenInTerminal: (worktreePath: string, terminal: SupportedTerminal, customPath?: string) => Promise<IPCResult<{ opened: boolean }>>;
  worktreeDetectTools: () => Promise<IPCResult<{ ides: Array<{ id: string; name: string; path: string; installed: boolean }>; terminals: Array<{ id: string; name: string; path: string; installed: boolean }> }>>;
  archiveTasks: (projectId: string, taskIds: string[], version?: string) => Promise<IPCResult<boolean>>;
  unarchiveTasks: (projectId: string, taskIds: string[]) => Promise<IPCResult<boolean>>;
  createWorktreePR: (taskId: string, options?: WorktreeCreatePROptions) => Promise<IPCResult<WorktreeCreatePRResult>>;
  getWorktreePushStatus: (taskId: string, projectId?: string) => Promise<IPCResult<{ isPushed: boolean; branchName: string | null }>>;
  pushWorktreeBranch: (taskId: string, projectId?: string) => Promise<IPCResult<{ branchName: string }>>;

  // Task Event Listeners
  // Note: projectId is optional for backward compatibility - events without projectId will still work
  onTaskProgress: (callback: (taskId: string, plan: ImplementationPlan, projectId?: string) => void) => () => void;
  onTaskError: (callback: (taskId: string, error: string, projectId?: string) => void) => () => void;
  onTaskLog: (callback: (taskId: string, log: string, projectId?: string) => void) => () => void;
  onTaskStatusChange: (callback: (taskId: string, status: TaskStatus, projectId?: string, reviewReason?: ReviewReason, errorMessage?: string) => void) => () => void;
  onTaskExecutionProgress: (
    callback: (taskId: string, progress: import('../../shared/types').ExecutionProgress, projectId?: string) => void
  ) => () => void;
  onTaskTraceUpdate: (callback: (taskId: string, entry: import('../../shared/types/trace-types').TraceEntry, projectId?: string) => void) => () => void;
  onTaskRateLimitPause: (
    callback: (taskId: string, info: import('../../shared/types').RateLimitPauseInfo, projectId?: string) => void
  ) => () => void;
  onTaskRateLimitResume: (callback: (taskId: string, projectId?: string) => void) => () => void;

  // Task Phase Logs
  getTaskLogs: (projectId: string, specId: string) => Promise<IPCResult<TaskLogs | null>>;
  watchTaskLogs: (projectId: string, specId: string) => Promise<IPCResult>;
  unwatchTaskLogs: (specId: string) => Promise<IPCResult>;
  onTaskLogsChanged: (callback: (specId: string, logs: TaskLogs) => void) => () => void;
  onTaskLogsStream: (callback: (specId: string, chunk: TaskLogStreamChunk) => void) => () => void;

  // Merge Progress Events
  onMergeProgress: (callback: (taskId: string, progress: MergeProgress) => void) => () => void;

  // Task Refine: refined description written to the task
  onTaskRefineApplied: (callback: (taskId: string, projectId: string) => void) => () => void;

  // Task Refine Terminal (mega-groom pipeline)
  taskRefineTerminalStart: (taskId: string, autoMode?: boolean) => void;
  taskRefineSkipPhase: (taskId: string) => void;
  taskRefineGetSession: (taskId: string) => Promise<IPCResult<{ session: unknown } | null>>;
  /** The task's refine run in main (null when it has none) */
  taskRefineGetStatus: (taskId: string) => Promise<IPCResult<RefineRunStatus | null>>;
  taskRefineResetSession: (taskId: string) => Promise<IPCResult>;
  onTaskRefinePhaseChange: (callback: (taskId: string, phase: string, phaseIndex: number, phases: Array<{ name: string; label: string; status: string }>) => void) => () => void;
}

export const createTaskAPI = (): TaskAPI => ({
  // Task Operations
  getTasks: (projectId: string, options?: { forceRefresh?: boolean }): Promise<IPCResult<Task[]>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_LIST, projectId, options),

  createTask: (
    projectId: string,
    title: string,
    description: string,
    metadata?: TaskMetadata
  ): Promise<IPCResult<Task>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_CREATE, projectId, title, description, metadata),

  deleteTask: (taskId: string): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_DELETE, taskId),

  updateTask: (
    taskId: string,
    updates: { title?: string; description?: string; metadata?: Partial<TaskMetadata> }
  ): Promise<IPCResult<Task>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_UPDATE, taskId, updates),

  startTask: (taskId: string, options?: TaskStartOptions): void =>
    ipcRenderer.send(IPC_CHANNELS.TASK_START, taskId, options),

  stopTask: (taskId: string): void =>
    ipcRenderer.send(IPC_CHANNELS.TASK_STOP, taskId),

  consolidateTasksPreview: (projectId, tasks) => ipcRenderer.invoke(IPC_CHANNELS.TASK_CONSOLIDATE_PREVIEW, projectId, tasks),
  relinkConsolidatedSpecs: (projectId, mapping) => ipcRenderer.invoke(IPC_CHANNELS.TASK_CONSOLIDATE_RELINK, projectId, mapping),

  stopTaskSafe: (taskId: string): void =>
    ipcRenderer.send(IPC_CHANNELS.TASK_STOP_SAFE, taskId),

  processTaskQueue: (projectId?: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.TASK_QUEUE_PROCESS, projectId),
  getTaskQueueOrder: (projectId: string): Promise<string[]> => ipcRenderer.invoke(IPC_CHANNELS.TASK_QUEUE_GET_ORDER, projectId),
  setTaskQueueOrder: (projectId: string, taskIds: string[]): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.TASK_QUEUE_SET_ORDER, projectId, taskIds),

  submitReview: (
    taskId: string,
    approved: boolean,
    feedback?: string,
    images?: ImageAttachment[]
  ): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_REVIEW, taskId, approved, feedback, images),

  updateTaskStatus: (
    taskId: string,
    status: TaskStatus,
    options?: { forceCleanup?: boolean; keepWorktree?: boolean }
  ): Promise<IPCResult & { worktreeExists?: boolean; worktreePath?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_UPDATE_STATUS, taskId, status, options),

  recoverStuckTask: (
    taskId: string,
    options?: import('../../shared/types').TaskRecoveryOptions
  ): Promise<IPCResult<TaskRecoveryResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_RECOVER_STUCK, taskId, options),

  checkTaskRunning: (taskId: string): Promise<IPCResult<boolean>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_CHECK_RUNNING, taskId),

  resumePausedTask: (taskId: string): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_RESUME_PAUSED, taskId),

  // Worktree Change Detection
  checkWorktreeChanges: (taskId: string): Promise<IPCResult<{ hasChanges: boolean; worktreePath?: string; changedFileCount?: number }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_CHECK_WORKTREE_CHANGES, taskId),

  // Image Operations
  loadImageThumbnail: (projectPath: string, specId: string, imagePath: string): Promise<IPCResult<string>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_LOAD_IMAGE_THUMBNAIL, projectPath, specId, imagePath),

  // Workspace Management
  getWorktreeStatus: (taskId: string): Promise<IPCResult<import('../../shared/types').WorktreeStatus>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKTREE_STATUS, taskId),

  getWorktreeDiff: (taskId: string): Promise<IPCResult<import('../../shared/types').WorktreeDiff>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKTREE_DIFF, taskId),

  getMergeInfo: (taskId: string): Promise<IPCResult<import('../../shared/types').WorktreeMergeInfo>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_GET_MERGE_INFO, taskId),

  mergeWorktree: (taskId: string, options?: { noCommit?: boolean; quickMerge?: boolean }): Promise<IPCResult<import('../../shared/types').WorktreeMergeResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKTREE_MERGE, taskId, options),

  mergeWorktreePreview: (taskId: string): Promise<IPCResult<import('../../shared/types').WorktreeMergeResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKTREE_MERGE_PREVIEW, taskId),

  postMergePush: (taskId: string, targetBranch: string): Promise<IPCResult<{ pushed: boolean }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_POST_MERGE_PUSH, taskId, targetBranch),

  postMergeCleanup: (taskId: string): Promise<IPCResult<{ cleaned: boolean }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_POST_MERGE_CLEANUP, taskId),

  syncWorktree: (taskId: string, targetBranch?: string): Promise<IPCResult<import('../../shared/types').WorktreeSyncResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKTREE_SYNC, taskId, targetBranch),

  resetTask: (taskId: string): Promise<IPCResult<{ reset: boolean }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_RESET, taskId),

  discardWorktree: (taskId: string, skipStatusChange?: boolean): Promise<IPCResult<import('../../shared/types').WorktreeDiscardResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKTREE_DISCARD, taskId, skipStatusChange),

  discardOrphanedWorktree: (projectId: string, specName: string): Promise<IPCResult<import('../../shared/types').WorktreeDiscardResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKTREE_DISCARD_ORPHAN, projectId, specName),

  clearStagedState: (taskId: string): Promise<IPCResult<{ cleared: boolean }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_CLEAR_STAGED_STATE, taskId),

  listWorktrees: (projectId: string, options?: { includeStats?: boolean }): Promise<IPCResult<import('../../shared/types').WorktreeListResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_LIST_WORKTREES, projectId, options),

  worktreeOpenInIDE: (worktreePath: string, ide: SupportedIDE, customPath?: string): Promise<IPCResult<{ opened: boolean }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKTREE_OPEN_IN_IDE, worktreePath, ide, customPath),

  worktreeOpenInTerminal: (worktreePath: string, terminal: SupportedTerminal, customPath?: string): Promise<IPCResult<{ opened: boolean }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKTREE_OPEN_IN_TERMINAL, worktreePath, terminal, customPath),

  worktreeDetectTools: (): Promise<IPCResult<{ ides: Array<{ id: string; name: string; path: string; installed: boolean }>; terminals: Array<{ id: string; name: string; path: string; installed: boolean }> }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKTREE_DETECT_TOOLS),

  archiveTasks: (projectId: string, taskIds: string[], version?: string): Promise<IPCResult<boolean>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_ARCHIVE, projectId, taskIds, version),

  unarchiveTasks: (projectId: string, taskIds: string[]): Promise<IPCResult<boolean>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_UNARCHIVE, projectId, taskIds),

  createWorktreePR: (taskId: string, options?: WorktreeCreatePROptions): Promise<IPCResult<WorktreeCreatePRResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKTREE_CREATE_PR, taskId, options),

  getWorktreePushStatus: (taskId: string, projectId?: string): Promise<IPCResult<{ isPushed: boolean; branchName: string | null }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKTREE_PUSH_STATUS, taskId, projectId),

  pushWorktreeBranch: (taskId: string, projectId?: string): Promise<IPCResult<{ branchName: string }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKTREE_PUSH_BRANCH, taskId, projectId),

  // Task Event Listeners
  onTaskProgress: (
    callback: (taskId: string, plan: ImplementationPlan, projectId?: string) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      taskId: string,
      plan: ImplementationPlan,
      projectId?: string
    ): void => {
      callback(taskId, plan, projectId);
    };
    ipcRenderer.on(IPC_CHANNELS.TASK_PROGRESS, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TASK_PROGRESS, handler);
    };
  },

  onTaskRateLimitPause: (
    callback: (taskId: string, info: import('../../shared/types').RateLimitPauseInfo, projectId?: string) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      taskId: string,
      info: import('../../shared/types').RateLimitPauseInfo,
      projectId?: string
    ): void => {
      callback(taskId, info, projectId);
    };
    ipcRenderer.on(IPC_CHANNELS.TASK_RATE_LIMIT_PAUSE, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TASK_RATE_LIMIT_PAUSE, handler);
    };
  },

  onTaskRateLimitResume: (
    callback: (taskId: string, projectId?: string) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      taskId: string,
      projectId?: string
    ): void => {
      callback(taskId, projectId);
    };
    ipcRenderer.on(IPC_CHANNELS.TASK_RATE_LIMIT_RESUME, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TASK_RATE_LIMIT_RESUME, handler);
    };
  },

  onTaskError: (
    callback: (taskId: string, error: string, projectId?: string) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      taskId: string,
      error: string,
      projectId?: string
    ): void => {
      callback(taskId, error, projectId);
    };
    ipcRenderer.on(IPC_CHANNELS.TASK_ERROR, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TASK_ERROR, handler);
    };
  },

  onTaskLog: (
    callback: (taskId: string, log: string, projectId?: string) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      taskId: string,
      log: string,
      projectId?: string
    ): void => {
      callback(taskId, log, projectId);
    };
    ipcRenderer.on(IPC_CHANNELS.TASK_LOG, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TASK_LOG, handler);
    };
  },

  onTaskStatusChange: (
    callback: (taskId: string, status: TaskStatus, projectId?: string, reviewReason?: ReviewReason, errorMessage?: string) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      taskId: string,
      status: TaskStatus,
      projectId?: string,
      reviewReason?: ReviewReason,
      errorMessage?: string
    ): void => {
      callback(taskId, status, projectId, reviewReason, errorMessage);
    };
    ipcRenderer.on(IPC_CHANNELS.TASK_STATUS_CHANGE, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TASK_STATUS_CHANGE, handler);
    };
  },

  onTaskExecutionProgress: (
    callback: (taskId: string, progress: import('../../shared/types').ExecutionProgress, projectId?: string) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      taskId: string,
      progress: import('../../shared/types').ExecutionProgress,
      projectId?: string
    ): void => {
      callback(taskId, progress, projectId);
    };
    ipcRenderer.on(IPC_CHANNELS.TASK_EXECUTION_PROGRESS, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TASK_EXECUTION_PROGRESS, handler);
    };
  },

  onTaskTraceUpdate: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, taskId: string, entry: import('../../shared/types/trace-types').TraceEntry, projectId?: string) => callback(taskId, entry, projectId);
    ipcRenderer.on(IPC_CHANNELS.TASK_TRACE_UPDATE, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.TASK_TRACE_UPDATE, handler);
  },

  // Task Phase Logs
  getTaskLogs: (projectId: string, specId: string): Promise<IPCResult<TaskLogs | null>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_LOGS_GET, projectId, specId),

  watchTaskLogs: (projectId: string, specId: string): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_LOGS_WATCH, projectId, specId),

  unwatchTaskLogs: (specId: string): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_LOGS_UNWATCH, specId),

  onTaskLogsChanged: (
    callback: (specId: string, logs: TaskLogs) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      specId: string,
      logs: TaskLogs
    ): void => {
      callback(specId, logs);
    };
    ipcRenderer.on(IPC_CHANNELS.TASK_LOGS_CHANGED, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TASK_LOGS_CHANGED, handler);
    };
  },

  onTaskLogsStream: (
    callback: (specId: string, chunk: TaskLogStreamChunk) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      specId: string,
      chunk: TaskLogStreamChunk
    ): void => {
      callback(specId, chunk);
    };
    ipcRenderer.on(IPC_CHANNELS.TASK_LOGS_STREAM, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TASK_LOGS_STREAM, handler);
    };
  },

  // Merge Progress Events
  onMergeProgress: (
    callback: (taskId: string, progress: MergeProgress) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      taskId: string,
      progress: MergeProgress
    ): void => {
      callback(taskId, progress);
    };
    ipcRenderer.on(IPC_CHANNELS.TASK_MERGE_PROGRESS, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TASK_MERGE_PROGRESS, handler);
    };
  },

  // Task Refine: refined description written to the task
  onTaskRefineApplied: (callback) => {
    const handler = (_: unknown, taskId: string, projectId: string) => callback(taskId, projectId);
    ipcRenderer.on(IPC_CHANNELS.TASK_REFINE_APPLIED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.TASK_REFINE_APPLIED, handler);
  },

  // Task Refine Terminal (mega-groom pipeline)
  taskRefineTerminalStart: (taskId: string, autoMode?: boolean): void =>
    ipcRenderer.send(IPC_CHANNELS.TASK_REFINE_TERMINAL_START, taskId, autoMode),

  taskRefineSkipPhase: (taskId: string): void =>
    ipcRenderer.send(IPC_CHANNELS.TASK_REFINE_SKIP_PHASE, taskId),

  taskRefineGetSession: (taskId: string): Promise<IPCResult<{ session: unknown } | null>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_REFINE_GET_SESSION, taskId),

  taskRefineGetStatus: (taskId: string): Promise<IPCResult<RefineRunStatus | null>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_REFINE_GET_STATUS, taskId),

  taskRefineResetSession: (taskId: string): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_REFINE_RESET_SESSION, taskId),

  onTaskRefinePhaseChange: (
    callback: (taskId: string, phase: string, phaseIndex: number, phases: Array<{ name: string; label: string; status: string }>) => void
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, taskId: string, phase: string, phaseIndex: number, phases: Array<{ name: string; label: string; status: string }>): void => {
      callback(taskId, phase, phaseIndex, phases);
    };
    ipcRenderer.on(IPC_CHANNELS.TASK_REFINE_PHASE_CHANGE, handler);
    return () => { ipcRenderer.removeListener(IPC_CHANNELS.TASK_REFINE_PHASE_CHANGE, handler); };
  },
});
