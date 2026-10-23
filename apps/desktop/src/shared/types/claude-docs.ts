/**
 * Types for the Context hub: the CLAUDE.md documentation tree (team + Malvy
 * layers), developer pointers and the docs optimizer.
 */

/** Which layer a doc file belongs to: the team's tracked docs, or Malvy's local layer */
export type ClaudeDocLayer = 'team' | 'malvy';

/** A CLAUDE.md / AGENTS.md file found in a project */
export interface ClaudeDocFile {
  /** Path relative to the project root, POSIX separators (e.g. `src/main/CLAUDE.md`, `.malvy/docs/CLAUDE.md`) */
  relativePath: string;
  /** Path within its layer (for the Malvy layer, relative to `.malvy/docs/`) */
  layerPath: string;
  layer: ClaudeDocLayer;
  /** Number of lines in the file */
  lines: number;
  /** First non-empty line, with leading `#` stripped */
  firstLine: string;
}

/** Result of listing docs for a project */
export interface ClaudeDocsListing {
  docs: ClaudeDocFile[];
  /** ISO timestamp of the last applied optimization, if any */
  lastOptimizedAt: string | null;
}

/**
 * A developer pointer: a short user-taught correction, optionally anchored to a
 * doc file and heading. Stored as a `user_taught` memory.
 */
export interface DocPointer {
  id: string;
  content: string;
  /** Doc file the pointer is anchored to (project-relative), if any */
  docPath?: string;
  /** Heading text within the doc, if any */
  heading?: string;
  createdAt: string;
  /** Malvy doc file (relative to `.malvy/docs/`) the optimizer baked this pointer into */
  appliedIn?: string;
}

export interface CreatePointerInput {
  content: string;
  docPath?: string;
  heading?: string;
}

/** A single file change proposed by the docs optimizer */
export interface DocProposal {
  /** Path relative to `.malvy/docs/`: a `CLAUDE.md` file, or `project_summary.json` at the root */
  path: string;
  action: 'create' | 'update' | 'delete';
  content: string;
  reason: string;
  appliedPointerIds: string[];
  /** Current content of the Malvy doc (filled in by main before sending to the renderer) */
  before?: string | null;
}

export interface ApplyDocProposalsResult {
  applied: string[];
  errors: Array<{ path: string; error: string }>;
}

// ============================================================
// Code branches + orchestrated optimizer
// ============================================================

/**
 * Documentation status of a code branch:
 * - `documented`: Malvy doc exists or the optimizer reviewed the branch
 * - `team`: only a team CLAUDE.md / AGENTS.md covers it
 * - `missing`: no doc and never reviewed
 * - `stale`: code committed after the branch was last optimized
 * - `over_budget`: Malvy doc exceeds its line budget (60, root 100)
 */
export type CodeBranchStatus = 'documented' | 'team' | 'missing' | 'stale' | 'over_budget';

/** A directory that deserves its own CLAUDE.md (a "code branch") */
export interface CodeBranch {
  /** Directory relative to the project root, POSIX separators; `''` is the root */
  relativePath: string;
  /** Source files in the branch, excluding those in child branches */
  sourceFileCount: number;
  /** A team CLAUDE.md / AGENTS.md exists in the directory */
  hasTeamDoc: boolean;
  /** Line count of `.malvy/docs/<path>/CLAUDE.md`, or null when absent */
  malvyDocLines: number | null;
  /** ISO time of the last commit touching the branch, or null (non-git / untracked) */
  lastCommitAt: string | null;
  /** ISO time the optimizer last documented (or skipped) the branch */
  docOptimizedAt: string | null;
  status: CodeBranchStatus;
}

/** Concise project facts extracted by the optimizer's root pass */
export interface ProjectSummary {
  overview: string;
  stack: string[];
  entryPoints: Array<{ path: string; description: string }>;
  commands: Array<{ command: string; description: string }>;
  keyModules: Array<{ path: string; summary: string }>;
}

/** Options for an optimizer run. Default: all branches + root pass */
export interface DocsOptimizeOptions {
  /** Only these branch paths (`''` = root). Omit to optimize all branches */
  branches?: string[];
  /** Run the root pass (root doc + project summary). Default: true when running all branches */
  includeRoot?: boolean;
}

export type BranchProgressStatus = 'queued' | 'running' | 'done' | 'skipped' | 'error';

export interface BranchProgressEvent {
  branch: string;
  status: BranchProgressStatus;
  /** One-line branch summary (done / skipped) */
  summary?: string;
  error?: string;
}

/** Payload of `context:docs:complete` */
export interface DocsOptimizerResult {
  /** Doc proposals; the project summary, when produced, is included as `project_summary.json` */
  proposals: DocProposal[];
  projectSummary: ProjectSummary | null;
}

/** Outcome of the last docs-optimizer run, persisted until reviewed (`.malvy/docs/.pending.json`) */
export interface PendingDocsRun {
  /** When the run finished (ISO) */
  finishedAt: string;
  proposals: DocProposal[];
  projectSummary: ProjectSummary | null;
  /** Set when the run failed; proposals are then empty */
  error?: string;
}

export interface PendingDocsState {
  pending: PendingDocsRun | null;
  /** An optimizer run for this project is in progress */
  isRunning: boolean;
}
