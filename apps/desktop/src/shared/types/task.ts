/**
 * Task-related types
 */

import type { ThinkingLevel, PhaseModelConfig, PhaseThinkingConfig } from './settings';
import type { ExecutionPhase as ExecutionPhaseType, CompletablePhase } from '../constants/phase-protocol';

export type TaskStatus = 'backlog' | 'queue' | 'in_progress' | 'ai_review' | 'human_review' | 'pending_merge' | 'done' | 'pr_created' | 'error';

// Maps task status columns to ordered task IDs for kanban board reordering
export type TaskOrderState = Record<TaskStatus, string[]>;

// Reason why a task is in human_review status
// - 'completed': All subtasks done and QA passed, ready for final approval/merge
// - 'errors': Subtasks failed during execution
// - 'qa_rejected': QA found issues that need fixing
// - 'plan_review': Spec/plan created and awaiting approval before coding starts
export type ReviewReason = 'completed' | 'errors' | 'qa_rejected' | 'plan_review' | 'stopped';

export type SubtaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

// Live rate-limit pause state for a running task.
// Mirrors the RATE_LIMIT_PAUSE sentinel file written by the orchestrator when a
// session hits a provider rate limit. Not persisted on the Task itself — it is
// tracked in the renderer for as long as the pause file exists on disk, because
// a paused task only exists while its worker is alive and waiting.
export interface RateLimitPauseInfo {
  pausedAt: string;  // ISO date when the pause started
  resetAt: string | null;  // ISO date when the limit resets, if the provider reported one
  error: string;  // Provider error message that triggered the pause
  pinnedProfileName?: string;  // Set when the task's project is pinned (strict) to this Claude account
}

// Re-exported from constants - single source of truth
export type ExecutionPhase = ExecutionPhaseType;

export interface ExecutionProgress {
  phase: ExecutionPhase;
  phaseProgress: number;  // 0-100 within current phase
  overallProgress: number;  // 0-100 overall
  currentSubtask?: string;  // Current subtask being processed
  message?: string;  // Current status message
  startedAt?: Date;
  sequenceNumber?: number;  // Monotonically increasing counter to detect stale updates
  // FIX (ACS-203): Track completed phases to prevent phase overlaps
  // When a phase completes, it's added to this array before transitioning to the next phase
  // This ensures that planning is marked complete before coding starts, etc.
  completedPhases?: CompletablePhase[];  // Phases that have successfully completed
}

export interface Subtask {
  id: string;
  title: string;
  description: string;
  status: SubtaskStatus;
  files: string[];
  verification?: {
    type: 'command' | 'browser';
    run?: string;
    scenario?: string;
  };
}

export interface QAReport {
  status: 'passed' | 'failed' | 'pending';
  issues: QAIssue[];
  timestamp: Date;
}

export interface QAIssue {
  id: string;
  severity: 'critical' | 'major' | 'minor';
  description: string;
  file?: string;
  line?: number;
}

// Task Log Types - for persistent, phase-based logging
export type TaskLogPhase = 'planning' | 'coding' | 'validation';
export type TaskLogPhaseStatus = 'pending' | 'active' | 'completed' | 'failed';
export type TaskLogEntryType = 'text' | 'tool_start' | 'tool_end' | 'phase_start' | 'phase_end' | 'error' | 'success' | 'info';

export interface TaskLogEntry {
  timestamp: string;
  type: TaskLogEntryType;
  content: string;
  phase: TaskLogPhase;
  tool_name?: string;
  tool_input?: string;
  subtask_id?: string;
  session?: number;
  // Fields for expandable detail view
  detail?: string;  // Full content that can be expanded (e.g., file contents, command output)
  subphase?: string;  // Subphase grouping (e.g., "PROJECT DISCOVERY", "CONTEXT GATHERING")
  collapsed?: boolean;  // Whether to show collapsed by default in UI
}

export interface TaskPhaseLog {
  phase: TaskLogPhase;
  status: TaskLogPhaseStatus;
  started_at: string | null;
  completed_at: string | null;
  entries: TaskLogEntry[];
}

export interface TaskLogs {
  spec_id: string;
  created_at: string;
  updated_at: string;
  phases: {
    planning: TaskPhaseLog;
    coding: TaskPhaseLog;
    validation: TaskPhaseLog;
  };
}

// Streaming markers from Python (similar to InsightsStreamChunk)
export interface TaskLogStreamChunk {
  type: 'text' | 'tool_start' | 'tool_end' | 'phase_start' | 'phase_end' | 'error';
  content?: string;
  phase?: TaskLogPhase;
  timestamp?: string;
  tool?: {
    name: string;
    input?: string;
    success?: boolean;
  };
  subtask_id?: string;
}

// Image attachment types for task creation
export interface ImageAttachment {
  id: string;           // Unique identifier (UUID)
  filename: string;     // Original filename
  mimeType: string;     // e.g., 'image/png'
  size: number;         // Size in bytes
  data?: string;        // Base64 data (for transport)
  path?: string;        // Relative path after storage
  thumbnail?: string;   // Base64 thumbnail for preview
}

// Referenced file types for task creation (files/folders from project)
export interface ReferencedFile {
  id: string;           // Unique identifier (UUID)
  path: string;         // Relative path from project root
  name: string;         // File or folder name
  isDirectory: boolean; // True if this is a directory
  addedAt: Date;        // When the file was added as reference
}

// Draft state for task creation (auto-saved when dialog closes)
export interface TaskDraft {
  projectId: string;
  title: string;
  description: string;
  category: TaskCategory | '';
  priority: TaskPriority | '';
  complexity: TaskComplexity | '';
  impact: TaskImpact | '';
  profileId?: string;  // Agent profile ID ('auto', 'complex', 'balanced', 'quick', 'custom')
  model: ModelType | '';
  thinkingLevel: ThinkingLevel | '';
  // Auto profile - per-phase configuration
  phaseModels?: PhaseModelConfig;
  phaseThinking?: PhaseThinkingConfig;
  images: ImageAttachment[];
  referencedFiles: ReferencedFile[];
  requireReviewBeforeCoding?: boolean;
  fastMode?: boolean;
  pushNewBranches?: boolean;
  savedAt: Date;
}

// Task metadata from ideation or manual entry
export type TaskComplexity = 'trivial' | 'small' | 'medium' | 'large' | 'complex';
export type TaskImpact = 'low' | 'medium' | 'high' | 'critical';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
// Re-export ThinkingLevel (defined in settings.ts) for convenience
export type { ThinkingLevel };
/** Model identifier — Claude shorthands or concrete model IDs from any provider */
export type ModelType = string;
export type TaskCategory =
  | 'feature'
  | 'bug_fix'
  | 'refactoring'
  | 'documentation'
  | 'security'
  | 'performance'
  | 'ui_ux'
  | 'infrastructure'
  | 'testing';

/** One step of a runbook deploy */
export interface DeployRunStep {
  name: string;
  command: string;
  run: boolean;
  reason?: string;
  exitCode?: number;
}

/** A runbook deploy run (`.malvy/deploys/history.json`) */
export interface DeployRunRecord {
  id: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'succeeded' | 'failed';
  phase?: 'planning' | 'running' | 'fixing' | 'verifying';
  currentStep?: string;
  /** HEAD when it started; HEAD after (incl. fix/release commits) once succeeded */
  commit: string;
  taskIds: string[];
  steps?: DeployRunStep[];
  /** Log path relative to the project root */
  log: string;
  cleanCheckout?: boolean;
  /** An agent fixed a failing step */
  fixed?: boolean;
  version?: string;
  build?: string;
  webVersion?: string;
  summary?: string;
  reason?: string;
}

export interface TaskMetadata {
  /** When Malvy merged the task into the main branch (Not live until a verified deploy after it) */
  mergedAt?: string;
  /** Planning tasks this task was consolidated from (they are archived) */
  consolidatedFrom?: string[];
  // Origin tracking
  sourceType?: 'ideation' | 'manual' | 'imported' | 'insights' | 'roadmap';
  ideationType?: string;  // e.g., 'code_improvements', 'security_hardening'
  ideaId?: string;  // Reference to original idea if converted
  featureId?: string;  // Reference to roadmap feature if from roadmap
  githubIssueNumber?: number;  // Reference to GitHub issue number if from GitHub (single issue)
  githubIssueNumbers?: number[];  // Reference to multiple GitHub issues if from a batch
  githubUrl?: string;  // GitHub issue URL
  githubBatchTheme?: string;  // Theme/title of the GitHub issue batch

  // Classification
  category?: TaskCategory;
  complexity?: TaskComplexity;
  impact?: TaskImpact;
  priority?: TaskPriority;

  // Context
  rationale?: string;  // Why this task matters
  problemSolved?: string;  // What problem this addresses
  targetAudience?: string;  // Who benefits

  // Technical details
  affectedFiles?: string[];  // Files likely to be modified
  dependencies?: string[];  // Other features/tasks this depends on
  acceptanceCriteria?: string[];  // What defines "done"

  // Effort estimation
  estimatedEffort?: TaskComplexity;

  // Type-specific metadata (from different idea types)
  securitySeverity?: 'low' | 'medium' | 'high' | 'critical';
  performanceCategory?: string;
  uiuxCategory?: string;
  codeQualitySeverity?: 'suggestion' | 'minor' | 'major' | 'critical';

  // Image attachments (screenshots, mockups, diagrams)
  attachedImages?: ImageAttachment[];

  // Referenced files (files/folders from project for context)
  referencedFiles?: ReferencedFile[];

  // Review settings
  requireReviewBeforeCoding?: boolean;  // Require human review of spec/plan before coding starts

  // Agent configuration (from agent profile or manual selection)
  model?: ModelType;  // Claude model to use (haiku, sonnet, opus) - used when not auto profile
  thinkingLevel?: ThinkingLevel;  // Thinking budget level (low, medium, high)
  provider?: string;  // Active provider when task was created (anthropic, openai, google, etc.)
  // Auto profile - per-phase model configuration
  isAutoProfile?: boolean;  // True when using Auto (Optimized) profile
  phaseModels?: PhaseModelConfig;  // Per-phase model configuration
  phaseThinking?: PhaseThinkingConfig;  // Per-phase thinking configuration
  phaseProviders?: Record<string, string>;  // Per-phase provider preference (cross-provider mode)
  fastMode?: boolean;  // Fast Mode — faster Opus output, higher cost per token

  // Git/Worktree configuration
  baseBranch?: string;  // Override base branch for this task's worktree
  prUrl?: string;  // GitHub PR URL if task has been submitted as a PR
  useWorktree?: boolean;  // If false, use direct mode (no worktree isolation) - default is true for safety
  useLocalBranch?: boolean;  // If true, use the local branch directly instead of preferring origin/branch (preserves gitignored files)
  pushNewBranches?: boolean;  // If false, keep the task branch local-only instead of auto-pushing to origin

  // Refine pipeline
  refined?: boolean;  // True when the mega-groom refine pipeline has completed
  refinedAt?: string;  // ISO date when refine completed

  // Archive status
  archivedAt?: string;  // ISO date when task was archived
  archivedInVersion?: string;  // Version in which task was archived (from changelog)

  // Deploys the user started from the task's Deploy button (newest last)
  deployments?: TaskDeployment[];
}

/** One user-confirmed deploy of a merged task (task_metadata.json `deployments`) */
export interface TaskDeployment {
  /** Script path relative to the project root, e.g. `deploy.sh` */
  script: string;
  args?: string;
  /** ISO timestamp */
  at: string;
  /** Log of the run, relative to the project root (`.malvy/deploys/<id>.log`) */
  log?: string;
  /** From the log; absent on deploys recorded before logging existed */
  status?: 'running' | 'succeeded' | 'failed';
  /** What went out, read from the script's output (App Store version or web version) */
  version?: string;
  /** App Store / TestFlight build number */
  build?: string;
  /** The script's own result line */
  summary?: string;
  /** HEAD that was deployed */
  commit?: string;
  /** Steps of the deploy chain this run included */
  steps?: string[];
  /** Steps that finished successfully (from the log) */
  stepsOk?: string[];
  /** Web version from a 'Live: <v>' line, when the chain also deployed a backend */
  webVersion?: string;
  /** Deploy run (see .malvy/deploys/history.json) this entry belongs to */
  deployId?: string;
  /** Why it failed, in one line */
  reason?: string;
}

export interface Task {
  id: string;
  specId: string;
  projectId: string;
  title: string;
  description: string;
  status: TaskStatus;
  reviewReason?: ReviewReason;  // Why task needs human review (only set when status is 'human_review')
  errorMessage?: string;  // Human-readable error description (set when task fails)
  subtasks: Subtask[];
  qaReport?: QAReport;
  logs: string[];
  metadata?: TaskMetadata;  // Rich metadata from ideation or manual entry
  executionProgress?: ExecutionProgress;  // Real-time execution progress
  releasedInVersion?: string;  // Version in which this task was released
  stagedInMainProject?: boolean;  // True if changes were staged to main project (worktree merged with --no-commit)
  stagedAt?: string;  // ISO timestamp when changes were staged
  location?: 'main' | 'worktree';  // Where task was loaded from (main project or worktree)
  specsPath?: string;  // Full path to specs directory for this task
  createdAt: Date;
  updatedAt: Date;
}

// Implementation Plan (from malvy)
export interface ImplementationPlan {
  feature?: string;  // Some plans use 'feature', some use 'title'
  title?: string;    // Alternative to 'feature' for task name
  workflow_type: string;
  services_involved?: string[];
  phases: Phase[];
  final_acceptance: string[];
  created_at: string;
  updated_at: string;
  spec_file: string;
  // Added for UI status persistence
  status?: TaskStatus;
  planStatus?: string;
  reviewReason?: ReviewReason;
  xstateState?: string;  // Persisted XState machine state for restoration (e.g., 'planning', 'coding')
  lastEvent?: {
    eventId: string;
    sequence: number;
    type: string;
    timestamp: string;
  };
  recoveryNote?: string;
  description?: string;
}

export interface Phase {
  phase: number;
  name: string;
  type: string;
  subtasks: PlanSubtask[];
  depends_on?: number[];
}

export interface PlanSubtask {
  id: string;
  /** Short summary (3-10 words) — the primary display field */
  title: string;
  /** Detailed implementation notes for the coder agent */
  description: string;
  status: SubtaskStatus;
  verification?: {
    type: string;
    run?: string;
    scenario?: string;
  };
}

// Workspace management types (for human review)
export interface WorktreeStatus {
  exists: boolean;
  worktreePath?: string;
  branch?: string;
  baseBranch?: string;
  currentProjectBranch?: string; // User's current checked-out branch in main project (merge target)
  commitCount?: number;
  filesChanged?: number;
  additions?: number;
  deletions?: number;
}

export interface WorktreeDiff {
  files: WorktreeDiffFile[];
  summary: string;
}

export interface WorktreeDiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
}

// Conflict severity levels from merge system
export type ConflictSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical';

// Type of conflict
export type ConflictType = 'semantic' | 'git';

// Information about a detected conflict
export interface MergeConflict {
  file: string;
  location: string;
  tasks: string[];
  severity: ConflictSeverity;
  canAutoMerge: boolean;
  strategy?: string;
  reason: string;
  type?: ConflictType; // 'semantic' = parallel task conflict, 'git' = branch divergence
}

// Path-mapped file that needs AI merge due to rename
export interface PathMappedAIMerge {
  oldPath: string;
  newPath: string;
  reason: string;
}

// Conflict scenario types for better UX messaging
// - 'already_merged': Task changes already identical in target branch
// - 'superseded': Target has newer version of same feature
// - 'diverged': Standard diverged branches (AI can resolve)
// - 'normal_conflict': Actual conflicting changes
export type ConflictScenario = 'already_merged' | 'superseded' | 'diverged' | 'normal_conflict';

// Git-level conflict information (branch divergence)
export interface GitConflictInfo {
  hasConflicts: boolean;
  conflictingFiles: string[];
  needsRebase: boolean;
  commitsBehind: number;
  baseBranch: string;
  specBranch: string;
  // Files that need AI merge due to path mappings (file renames)
  pathMappedAIMerges?: PathMappedAIMerge[];
  // Total number of file renames detected
  totalRenames?: number;
  // Conflict scenario for better UX messaging
  scenario?: ConflictScenario;
  // Files that are already merged (identical in both branches)
  alreadyMergedFiles?: string[];
  // Human-readable message about the scenario
  scenarioMessage?: string;
}

// Summary statistics from merge preview/execution
export interface MergeStats {
  totalFiles: number;
  conflictFiles: number;
  totalConflicts: number;
  autoMergeable: number;
  aiResolved?: number;
  humanRequired?: number;
  hasGitConflicts?: boolean; // True if there are git-level conflicts requiring rebase
  // Count of files needing AI merge due to path mappings (file renames)
  pathMappedAIMergeCount?: number;
}

// Merge progress tracking (for progress bar during merge operations)
export type MergeStage = 'analyzing' | 'detecting_conflicts' | 'resolving' | 'validating' | 'complete' | 'error';

export interface MergeProgress {
  stage: MergeStage;
  percent: number;
  message: string;
  details?: {
    conflicts_found?: number;
    conflicts_resolved?: number;
    current_file?: string;
  };
}

// Merge log entry (for conflict resolution logging)
export type MergeLogEntryType = 'info' | 'success' | 'warning' | 'error';

export interface MergeLogEntry {
  timestamp: string;
  type: MergeLogEntryType;
  message: string;
  details?: string;
}

/**
 * Pre-merge info: what will happen when the Merge button is clicked.
 * Shown in the confirmation dialog before merge starts.
 */
export interface WorktreeMergeInfo {
  sourceBranch: string;
  targetBranch: string;
  commitsAhead: number;
  hasWorktree: boolean;
}

export interface WorktreeMergeResult {
  success: boolean;
  message: string;
  merged?: boolean;
  conflictFiles?: string[];
  staged?: boolean;
  alreadyStaged?: boolean;
  projectPath?: string;
  // Branch that was merged into — used by push/cleanup follow-up actions
  targetBranch?: string;
  // AI-generated commit message suggestion (for stage-only mode)
  suggestedCommitMessage?: string;
  // New conflict info from smart merge
  conflicts?: MergeConflict[];
  stats?: MergeStats;
  gitConflicts?: GitConflictInfo; // Git-level conflict info
  // Preview mode results
  preview?: {
    files: string[];
    conflicts: MergeConflict[];
    summary: MergeStats;
    gitConflicts?: GitConflictInfo;
    // Uncommitted changes in the main project that could block merge
    uncommittedChanges?: {
      hasChanges: boolean;
      files: string[];
      count: number;
    } | null;
  };
}

export interface WorktreeDiscardResult {
  success: boolean;
  message: string;
}

/**
 * Options for creating a PR from a worktree
 */
export interface WorktreeCreatePROptions {
  targetBranch?: string;
  title?: string;
  draft?: boolean;
}

/**
 * Result of creating a PR from a worktree
 */
export interface WorktreeCreatePRResult {
  success: boolean;
  prUrl?: string;
  error?: string;
  message?: string;  // Human-readable message for both success and error cases
  alreadyExists?: boolean;
}

/**
 * Information about a single spec worktree
 * Per-spec architecture: Each spec has its own worktree at .worktrees/{spec-name}/
 */
export interface WorktreeListItem {
  specName: string;
  path: string;
  branch: string;
  baseBranch: string;
  commitCount?: number;
  filesChanged?: number;
  additions?: number;
  deletions?: number;
  /** True if git commands failed on this worktree (corrupted/orphaned state) */
  isOrphaned?: boolean;
}

/**
 * Result of listing all spec worktrees
 */
export interface WorktreeListResult {
  worktrees: WorktreeListItem[];
}

// Worktree sync (update with base branch)
export interface WorktreeSyncResult {
  specId: string;
  success: boolean;
  message: string;
  hadConflicts: boolean;
}

// Stuck task recovery types
export interface StuckTaskInfo {
  taskId: string;
  specId: string;
  title: string;
  status: TaskStatus;
  isActuallyRunning: boolean;
  lastUpdated: Date;
}

export interface TaskRecoveryResult {
  taskId: string;
  recovered: boolean;
  newStatus: TaskStatus;
  message: string;
  autoRestarted?: boolean;
}

export interface TaskRecoveryOptions {
  targetStatus?: TaskStatus;
  autoRestart?: boolean;
}

export interface TaskProgressUpdate {
  taskId: string;
  plan: ImplementationPlan;
  currentSubtask?: string;
}

export interface TaskStartOptions {
  parallel?: boolean;
  workers?: number;
  model?: string;
  baseBranch?: string; // Override base branch for worktree creation
}

/** One phase of the task refine (mega-groom) pipeline, as sent to the renderer */
export interface RefinePhaseInfo {
  name: string;
  label: string;
  status: string;
}

/**
 * Snapshot of a task's refine run in main, so a reopened task dialog can
 * re-attach to it instead of starting a new one.
 */
export interface RefineRunStatus {
  taskId: string;
  isRunning: boolean;
  autoMode: boolean;
  /** Terminal the pipeline writes to (`refine-${taskId}`) */
  terminalId: string;
  /** ISO timestamp */
  startedAt: string;
  currentPhase: string | null;
  currentPhaseIndex: number;
  phases: RefinePhaseInfo[];
  /** Latest terminal output (bounded), to replay into a terminal that has none, e.g. on the phone */
  outputTail: string;
}
