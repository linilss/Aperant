/**
 * AI-powered resolution of git merge conflicts, used by the quick merge (Merge buttons),
 * worktree sync and stash restore.
 *
 * Every conflicted file is either resolved and staged, or reported back with the reason it
 * could not be (AI error, empty answer, binary file, ...). Callers must not commit while
 * `listUnmergedFiles()` is non-empty; `assertAllConflictsResolved()` throws a message that
 * names the files and reasons, so it can go straight into the user's toast.
 */

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

import { resolveMergeConflict } from '../../ai/runners/merge-resolver';
import { appLog } from '../../app-logger';
import { getToolPath } from '../../cli-tool-manager';
import { getIsolatedGitEnv } from '../../utils/git-isolation';

/** `ours` = the branch checked out (HEAD), `theirs` = the branch being merged in */
export type ConflictSide = 'ours' | 'theirs';

export interface UnresolvedConflict {
  file: string;
  reason: string;
}

export interface ResolveConflictsOptions {
  /**
   * The side that holds the merge target's version. Generated binary artefacts take this
   * side's version: `ours` when merging into the target, `theirs` when merging the target
   * into a feature branch.
   */
  targetSide: ConflictSide;
  onProgress?: (msg: string) => void;
  /** Log prefix, e.g. `[QUICK_MERGE] 042-foo` */
  logTag?: string;
  /** Injectable for tests */
  resolve?: typeof resolveMergeConflict;
}

/** Thrown when conflicts remain after AI resolution; the message is meant for the user. */
export class UnresolvedConflictsError extends Error {
  constructor(
    message: string,
    readonly files: UnresolvedConflict[]
  ) {
    super(message);
    this.name = 'UnresolvedConflictsError';
  }
}

const GENERATED_DIRS = ['__pycache__', 'bin', 'obj', '.pytest_cache', '.mypy_cache'];
const GENERATED_EXTENSIONS = ['.pyc', '.pyo'];
const GENERATED_FILES = ['.DS_Store'];

/** Build/cache output that nobody edits by hand, so no merge of it is needed. */
export function isGeneratedArtifact(relPath: string): boolean {
  const parts = relPath.split(/[\\/]/);
  const name = parts[parts.length - 1];
  if (GENERATED_FILES.includes(name)) return true;
  if (GENERATED_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
  return parts.slice(0, -1).some((dir) => GENERATED_DIRS.includes(dir));
}

/** Same heuristic as git: a NUL byte in the first 8000 bytes means binary. */
export function isBinaryContent(buf: Buffer): boolean {
  return buf.subarray(0, 8000).includes(0);
}

const CONFLICT_MARKER = /^(<{7}|>{7})(\s|$)/m;

function git(cwd: string, args: string[]): string {
  return execFileSync(getToolPath('git'), args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: getIsolatedGitEnv()
  });
}

export function listUnmergedFiles(cwd: string): string[] {
  return git(cwd, ['diff', '--name-only', '--diff-filter=U']).trim().split('\n').filter(Boolean);
}

/** Index stages present for a conflicted file: 1 base, 2 ours, 3 theirs. */
function conflictStages(cwd: string, relPath: string): Set<number> {
  const stages = new Set<number>();
  for (const line of git(cwd, ['ls-files', '-u', '--', relPath]).split('\n')) {
    const stage = Number(line.split('\t')[0]?.split(' ')[2]);
    if (stage) stages.add(stage);
  }
  return stages;
}

/** Take one side's version of a file (deleting it if that side deleted it) and stage it. */
function takeSide(cwd: string, relPath: string, side: ConflictSide, stages: Set<number>): void {
  if (stages.has(side === 'ours' ? 2 : 3)) {
    git(cwd, ['checkout', `--${side}`, '--', relPath]);
    git(cwd, ['add', '--', relPath]);
  } else {
    git(cwd, ['rm', '-q', '-f', '--', relPath]);
  }
}

/** Strip a markdown fence the model wrapped the whole file in, unless the file itself starts with one. */
function stripWrappingFence(text: string, original: string): string {
  if (original.trimStart().startsWith('```')) return text;
  const match = text.match(/^```[^\n]*\n([\s\S]*?)\n```$/);
  return match ? match[1] : text;
}

/** A conflicted file and its two-letter `git status` code (UU, DU, UD, AA, AU, UA, DD) */
export interface ConflictEntry {
  file: string;
  code: string;
}

const UNMERGED_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

/** Conflicted files with their conflict type (`-z` so paths are never quoted) */
export function listConflicts(cwd: string): ConflictEntry[] {
  const entries = git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=no']).split('\0');
  const conflicts: ConflictEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    // Renames/copies carry the original path as the next entry
    if (code[0] === 'R' || code[0] === 'C') i++;
    if (UNMERGED_CODES.has(code)) conflicts.push({ file: entry.slice(3), code });
  }
  return conflicts;
}

/**
 * Take the target's version of every conflicted generated artefact (__pycache__, *.pyc,
 * bin/, obj/, ...). Returns the files taken.
 */
export function takeGeneratedArtifacts(cwd: string, targetSide: ConflictSide): string[] {
  const taken: string[] = [];
  for (const relPath of listUnmergedFiles(cwd)) {
    if (!isGeneratedArtifact(relPath)) continue;
    takeSide(cwd, relPath, targetSide, conflictStages(cwd, relPath));
    taken.push(relPath);
  }
  return taken;
}

/** True when the text has a line starting with a conflict marker (<<<<<<< or >>>>>>>) */
export function hasConflictMarkers(text: string): boolean {
  return CONFLICT_MARKER.test(text);
}

/** Files whose added lines (in `git diff --cached <ref>`) contain a conflict marker */
function filesWithAddedMarkers(cwd: string, ref: string): Set<string> {
  const files = new Set<string>();
  let current = '';
  for (const line of git(cwd, ['diff', '--cached', '-U0', '--no-color', '--no-ext-diff', ref]).split('\n')) {
    if (line.startsWith('+++ ')) {
      current = line.startsWith('+++ b/') ? line.slice(6) : '';
    } else if (current && /^\+(<{7}|>{7})(\s|$)/.test(line)) {
      files.add(current);
    }
  }
  return files;
}

/**
 * Files in the index with conflict markers the merge introduced: added relative to both
 * sides (HEAD and MERGE_HEAD), so markers either branch already had (fixtures) don't count.
 */
export function findNewConflictMarkers(cwd: string): string[] {
  const vsOurs = filesWithAddedMarkers(cwd, 'HEAD');
  if (vsOurs.size === 0) return [];
  const vsTheirs = filesWithAddedMarkers(cwd, 'MERGE_HEAD');
  return [...vsOurs].filter((f) => vsTheirs.has(f)).sort();
}

/**
 * Resolve every conflicted file in `cwd`. Returns the files that could not be resolved, with
 * the reason; those are left conflicted (unstaged) for the caller to report and abort.
 */
export async function resolveGitConflictsWithAI(
  cwd: string,
  projectPath: string,
  options: ResolveConflictsOptions
): Promise<UnresolvedConflict[]> {
  const { targetSide, onProgress, logTag = '[CONFLICT_RESOLVE]', resolve = resolveMergeConflict } = options;
  const unresolved: UnresolvedConflict[] = [];
  const fail = (file: string, reason: string) => {
    unresolved.push({ file, reason });
    appLog.warn(`${logTag} stage=resolve file=${file} error=${reason}`);
  };

  for (const relPath of listUnmergedFiles(cwd)) {
    onProgress?.(`Resolving conflict in ${relPath}`);
    const absPath = path.join(cwd, relPath);
    try {
      const stages = conflictStages(cwd, relPath);
      const deletedOnOneSide = !stages.has(2) || !stages.has(3);

      let buf: Buffer | null = null;
      try {
        buf = readFileSync(absPath);
      } catch {
        // Missing in the working tree (deleted on one side)
      }
      const binary = buf ? isBinaryContent(buf) : false;

      if ((binary || deletedOnOneSide) && isGeneratedArtifact(relPath)) {
        takeSide(cwd, relPath, targetSide, stages);
        continue;
      }
      if (deletedOnOneSide) {
        fail(relPath, 'deleted on one side and changed on the other');
        continue;
      }
      if (!buf) {
        fail(relPath, 'file could not be read');
        continue;
      }
      if (binary) {
        fail(relPath, 'binary file, cannot be merged automatically');
        continue;
      }

      const conflictedContent = buf.toString('utf-8');
      const result = await resolve({
        systemPrompt: `You are a code merge expert resolving a Git merge conflict.
Return ONLY the complete resolved file content — no explanation, no markdown fences, no conflict markers.
Prefer keeping all changes from both sides unless they directly contradict.`,
        userPrompt: `Resolve the following merge conflict. Return only the complete resolved file.\n\nFile: ${relPath}\n\n${conflictedContent}`,
        modelShorthand: 'sonnet',
        thinkingLevel: 'low',
        projectPath
      });

      if (!result.success || !result.text) {
        fail(relPath, `AI resolution failed: ${result.error || 'empty answer'}`);
        continue;
      }
      const resolved = stripWrappingFence(result.text, conflictedContent);
      if (CONFLICT_MARKER.test(resolved)) {
        fail(relPath, 'AI answer still contained conflict markers');
        continue;
      }
      // Keep the file's trailing newline (the resolver trims its answer)
      writeFileSync(absPath, conflictedContent.endsWith('\n') ? `${resolved}\n` : resolved, 'utf-8');
      git(cwd, ['add', '--', relPath]);
    } catch (err) {
      fail(relPath, err instanceof Error ? err.message : String(err));
    }
  }
  return unresolved;
}

/** User-facing text naming the files still conflicted and why. */
export function describeUnresolved(stillUnmerged: string[], unresolved: UnresolvedConflict[]): string {
  const reasons = new Map(unresolved.map((u) => [u.file, u.reason]));
  const list = stillUnmerged.map((file) => `${file} (${reasons.get(file) ?? 'not resolved'})`).join('; ');
  return `Conflicts could not be resolved automatically in: ${list}`;
}

/**
 * Throw `UnresolvedConflictsError` if git still reports unmerged files. Call before every
 * commit / `merge --continue` that follows AI resolution.
 */
export function assertAllConflictsResolved(cwd: string, unresolved: UnresolvedConflict[]): void {
  const stillUnmerged = listUnmergedFiles(cwd);
  if (stillUnmerged.length === 0) return;
  const files = stillUnmerged.map((file) => ({
    file,
    reason: unresolved.find((u) => u.file === file)?.reason ?? 'not resolved'
  }));
  throw new UnresolvedConflictsError(describeUnresolved(stillUnmerged, unresolved), files);
}

/** Resolve all conflicts in `cwd`, then throw if any remain. */
export async function resolveAllConflictsOrThrow(
  cwd: string,
  projectPath: string,
  options: ResolveConflictsOptions
): Promise<void> {
  const unresolved = await resolveGitConflictsWithAI(cwd, projectPath, options);
  assertAllConflictsResolved(cwd, unresolved);
}

/** User-facing sentence for an error thrown while resolving conflicts. */
export function conflictFailureMessage(err: unknown): string {
  if (err instanceof UnresolvedConflictsError) return `${err.message}.`;
  const msg = err instanceof Error ? err.message : String(err);
  return `Could not finish the merge after resolving conflicts: ${msg}.`;
}
