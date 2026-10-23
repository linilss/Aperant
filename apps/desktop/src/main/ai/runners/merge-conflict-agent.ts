/**
 * Merge Conflict Agent
 * ====================
 *
 * One Claude CLI agent that finishes a merge of the target branch into a task branch,
 * in the task worktree (never the project checkout). Used by the quick merge when the
 * per-file resolver is too slow (many conflicts) or can't help (modify/delete).
 *
 * The agent resolves and stages; it never commits. The caller checks its work (no
 * unmerged files, no markers, verify passes) and commits the merge itself.
 */

import { runClaudeCliDetailed } from '../cli/claude-cli';
import { resolveModelId } from '../config/phase-config';
import { tryLoadPrompt } from '../prompts/prompt-loader';
import { safeParseJson } from '../../utils/json-repair';

/** Agentic turn cap: dozens of files plus verify/fix rounds */
export const MERGE_AGENT_MAX_TURNS = 300;
/** Characters of spec.md passed in the prompt */
export const MERGE_AGENT_SPEC_MAX_CHARS = 6_000;

/** A conflicted file and its two-letter `git status` code (UU, DU, UD, AA, AU, UA, DD) */
export interface MergeConflictEntry {
  file: string;
  code: string;
}

export interface MergeAgentInput {
  /** Task worktree with the merge in progress */
  cwd: string;
  /** Project root (for the pinned Claude profile) */
  projectPath: string;
  targetBranch: string;
  featureBranch: string;
  /** Merge base of the two sides (for the agent's diffs) */
  mergeBase: string;
  conflicts: MergeConflictEntry[];
  /** Task spec (spec.md); truncated in the prompt */
  specText?: string;
  verifyCommand?: string;
  abortSignal?: AbortSignal;
}

export interface MergeAgentResult {
  status: 'resolved' | 'failed';
  notes: string;
  verify: 'passed' | 'failed' | 'none';
}

/** Runs the agent and returns its full text output */
export type MergeAgentRunner = (input: MergeAgentInput) => Promise<string>;

/** Conflict types the per-file resolver can't handle (one side has no version) */
export function isModifyDeleteCode(code: string): boolean {
  return code !== 'UU' && code !== 'AA';
}

/** Human description of a conflict code; in the worktree `us` = task branch, `them` = target */
export function describeConflictCode(code: string, target: string): string {
  switch (code) {
    case 'UU':
      return 'both changed';
    case 'AA':
      return 'added on both sides';
    case 'DU':
      return `deleted by the task, changed on ${target}`;
    case 'UD':
      return `changed by the task, deleted on ${target}`;
    case 'AU':
      return `added by the task, conflicting with ${target}`;
    case 'UA':
      return `added on ${target}, conflicting with the task`;
    case 'DD':
      return 'deleted on both sides (rename conflict)';
    default:
      return `conflict ${code}`;
  }
}

const FALLBACK_PROMPT =
  'You are finishing a git merge of `{{TARGET}}` into the task branch `{{FEATURE}}` in this directory. ' +
  'Resolve every conflicted file listed below, keeping the task\'s intent and everything `{{TARGET}}` added. ' +
  'Remove every conflict marker, `git add` resolved files, run the verify command and fix merge fallout. ' +
  'Do not commit, push or change git history. Finish with ' +
  '<merge_result>{"status":"resolved"|"failed","notes":"...","verify":"passed"|"failed"|"none"}</merge_result>.';

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}\n[... spec truncated ...]` : trimmed;
}

export function buildMergeAgentPrompt(input: MergeAgentInput): string {
  const template = tryLoadPrompt('merge_conflict_agent') ?? FALLBACK_PROMPT;
  const instructions = template
    .replaceAll('{{TARGET}}', input.targetBranch)
    .replaceAll('{{FEATURE}}', input.featureBranch)
    .replaceAll('{{MERGE_BASE}}', input.mergeBase);
  const files = input.conflicts
    .map((c) => `- ${c.file} [${c.code}: ${describeConflictCode(c.code, input.targetBranch)}]`)
    .join('\n');
  const verify = input.verifyCommand?.trim();
  return [
    instructions.trim(),
    '---',
    `## Task spec\n${input.specText?.trim() ? truncate(input.specText, MERGE_AGENT_SPEC_MAX_CHARS) : '(no spec found; infer the intent from the task branch\'s commits and diff)'}`,
    `## Conflicted files (${input.conflicts.length})\n${files}`,
    `## Verify command\n${verify ? `\`\`\`\n${verify}\n\`\`\`` : 'none (still make sure nothing obviously broken is left, e.g. imports of removed files)'}`,
  ].join('\n\n');
}

/** Parse the last `<merge_result>` block; null when absent or unreadable */
export function parseMergeResult(text: string): MergeAgentResult | null {
  const blocks = [...text.matchAll(/<merge_result>([\s\S]*?)<\/merge_result>/g)];
  const body = blocks.at(-1)?.[1];
  if (!body) return null;
  const json = body.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const raw = safeParseJson<Record<string, unknown>>(json);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const status = String(raw.status ?? '').toLowerCase();
  const verify = String(raw.verify ?? '').toLowerCase();
  return {
    status: status === 'resolved' ? 'resolved' : 'failed',
    notes: typeof raw.notes === 'string' ? raw.notes.trim() : '',
    verify: verify === 'passed' || verify === 'failed' ? verify : 'none',
  };
}

/** Default runner: Claude CLI in the worktree, edit tools, the project's Claude account */
export const runMergeConflictAgent: MergeAgentRunner = async (input) => {
  const result = await runClaudeCliDetailed({
    prompt: buildMergeAgentPrompt(input),
    cwd: input.cwd,
    projectPath: input.projectPath,
    modelId: resolveModelId('sonnet'),
    allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'],
    maxTurns: MERGE_AGENT_MAX_TURNS,
    abortSignal: input.abortSignal,
  });
  return result.text || result.resultText;
};
