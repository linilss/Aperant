/**
 * Task branch naming.
 *
 * Every task runs on its own branch, `{prefix}{specId}`. The prefix is
 * configurable per project (ProjectSettings.branchPrefix) so Malvy can follow
 * a team's own branch conventions without leaving a "malvy/" trace. Branches
 * created with the legacy prefixes keep being recognised.
 */

/** Default prefix for task branches */
export const DEFAULT_TASK_BRANCH_PREFIX = 'malvy/';

/** Prefixes used by earlier versions; still recognised when detecting task branches */
export const LEGACY_TASK_BRANCH_PREFIXES = ['malvy/', 'auto-claude/'] as const;

/** Minimal settings shape needed to resolve the branch prefix */
export interface TaskBranchSettings {
  branchPrefix?: string;
}

// Characters/sequences git forbids in ref names (see git-check-ref-format)
const INVALID_PREFIX_PATTERN = /[\s~^:?*[\\]|\.\.|@\{|\/\/|^[-/.]|\.lock(\/|$)|\/\./;

function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Check whether a user-supplied prefix can be used to build branch names.
 * An empty prefix is not allowed (every branch would look like a task branch).
 */
export function isValidTaskBranchPrefix(prefix: string | undefined | null): boolean {
  if (typeof prefix !== 'string') return false;
  const trimmed = prefix.trim();
  if (trimmed.length === 0) return false;
  return !INVALID_PREFIX_PATTERN.test(trimmed) && !hasControlCharacters(trimmed);
}

/**
 * Resolve the effective task branch prefix for a project.
 * Falls back to the default when unset or invalid.
 */
export function getTaskBranchPrefix(settings?: TaskBranchSettings | null): string {
  const prefix = settings?.branchPrefix;
  if (isValidTaskBranchPrefix(prefix)) {
    return (prefix as string).trim();
  }
  return DEFAULT_TASK_BRANCH_PREFIX;
}

/**
 * Build the branch name for a task: `{prefix}{specId}`.
 */
export function getTaskBranchName(specId: string, settings?: TaskBranchSettings | null): string {
  return `${getTaskBranchPrefix(settings)}${specId}`;
}

/**
 * All prefixes that identify a task branch: the configured one first, then legacy ones.
 */
export function getTaskBranchPrefixes(settings?: TaskBranchSettings | null): string[] {
  const prefixes = [getTaskBranchPrefix(settings), ...LEGACY_TASK_BRANCH_PREFIXES];
  return Array.from(new Set(prefixes));
}

/**
 * Candidate branch names for a task, in lookup order (configured prefix first,
 * then legacy prefixes) so that existing branches keep working after the prefix changes.
 */
export function getTaskBranchCandidates(specId: string, settings?: TaskBranchSettings | null): string[] {
  return getTaskBranchPrefixes(settings).map((prefix) => `${prefix}${specId}`);
}

/**
 * Whether a branch name looks like a task branch, i.e. starts with the
 * configured prefix or a legacy prefix and has a non-empty spec id after it.
 */
export function isTaskBranch(branch: string | null | undefined, settings?: TaskBranchSettings | null): boolean {
  return getSpecIdFromTaskBranch(branch, settings) !== null;
}

/**
 * Extract the spec id from a task branch name, or null if it is not a task branch.
 */
export function getSpecIdFromTaskBranch(
  branch: string | null | undefined,
  settings?: TaskBranchSettings | null
): string | null {
  if (!branch) return null;
  for (const prefix of getTaskBranchPrefixes(settings)) {
    if (branch.startsWith(prefix) && branch.length > prefix.length) {
      return branch.slice(prefix.length);
    }
  }
  return null;
}
