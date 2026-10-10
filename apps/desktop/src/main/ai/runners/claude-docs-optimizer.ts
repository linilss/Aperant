/**
 * Claude Docs Optimizer Runner
 * ============================
 *
 * Orchestrated, non-interactive "super-charge" of the Malvy doc layer:
 *
 * 1. **Branch passes**: one `streamText` session per code branch (see
 *    `code-branches.ts`), run with bounded concurrency. Each documents a single
 *    directory (`prompts/claude_docs_branch.md`) and returns a `<branch_doc>`
 *    with a one-line summary, or `skip`.
 * 2. **Root pass**: `prompts/claude_docs_root.md` gets the project index, the
 *    team root doc, general pointers and all branch summaries, and returns the
 *    root `.malvy/docs/CLAUDE.md` plus a `<project_summary>`.
 *
 * Read-only tools (insights set: Read, Glob, Grep). Proposals are returned to
 * the caller; nothing is written here — the user approves per file.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runClaudeCli } from '../cli/claude-cli';
import { resolveModelId } from '../config/phase-config';
import type { ModelShorthand, ThinkingLevel } from '../config/types';
import { safeParseJson } from '../../utils/json-repair';
import { tryLoadPrompt } from '../prompts/prompt-loader';
import { CORE_VALUES_INJECT_MAX_CHARS, loadCoreValues } from '../../core-values';
import { AUTO_BUILD_PATHS } from '../../../shared/constants';
import type {
  BranchProgressEvent,
  ClaudeDocFile,
  CodeBranch,
  DocPointer,
  DocProposal,
  ProjectSummary,
} from '../../../shared/types/claude-docs';
import type { ProjectIndex } from '../../../shared/types/project';
import {
  branchDocPath,
  branchOfDocPath,
  findClaudeDocs,
  MALVY_DOCS_DIR,
  normalizeProjectSummary,
  PROJECT_SUMMARY_FILE,
  readMalvyDoc,
} from '../../claude-docs';
import { findCodeBranches, parentBranch } from '../../code-branches';

// =============================================================================
// Types
// =============================================================================

export interface ClaudeDocsOptimizerConfig {
  projectDir: string;
  /** Current developer pointers (from memory.db) — binding input */
  pointers: DocPointer[];
  /** Only these branch paths (`''` = root). Omit to optimize all branches */
  branches?: string[];
  /** Run the root pass. Default: true when all branches run, false otherwise */
  includeRoot?: boolean;
  modelShorthand?: ModelShorthand;
  thinkingLevel?: ThinkingLevel;
  abortSignal?: AbortSignal;
  /** Parallel branch passes (default 3) */
  concurrency?: number;
}

export type ClaudeDocsOptimizerEvent =
  | ({ type: 'branch-progress' } & BranchProgressEvent)
  | { type: 'text-delta'; branch: string; delta: string }
  | { type: 'tool-use'; branch: string; toolName: string; input: string }
  | {
      type: 'complete';
      proposals: DocProposal[];
      projectSummary: ProjectSummary | null;
      /** Branches the optimizer reviewed without proposing a change */
      skippedBranches: string[];
    }
  | { type: 'error'; error: string };

export interface BranchDocOutput {
  action: 'create' | 'update' | 'delete' | 'skip';
  content?: string;
  reason: string;
  summary: string;
  appliedPointerIds: string[];
}

// =============================================================================
// Constants
// =============================================================================

export const BRANCH_MAX_STEPS = 60;
export const ROOT_MAX_STEPS = 60;
const DEFAULT_CONCURRENCY = 3;
const MAX_INDEX_CHARS = 20_000;
const MAX_TEAM_DOC_CHARS = 12_000;

const FALLBACK_BRANCH_PROMPT =
  'You document one directory for AI coding agents. Read its files with the available tools, then output ' +
  '<branch_doc>{"action":"create|update|delete|skip","content":"...","reason":"...","summary":"...","appliedPointerIds":[]}</branch_doc>.';
const FALLBACK_ROOT_PROMPT =
  'You write the root CLAUDE.md for AI coding agents and a project summary. Output ' +
  '<root_doc>{"action":"create|update|skip","content":"...","reason":"...","appliedPointerIds":[]}</root_doc> and ' +
  '<project_summary>{"overview":"...","stack":[],"entryPoints":[],"commands":[],"keyModules":[]}</project_summary>.';

// =============================================================================
// Parsing helpers
// =============================================================================

/** Extract the content between the last `<tag>...</tag>` pair */
export function extractTagBlock(text: string, tag: string): string | null {
  const close = `</${tag}>`;
  const closeIdx = text.lastIndexOf(close);
  if (closeIdx === -1) return null;
  const openIdx = text.lastIndexOf(`<${tag}>`, closeIdx);
  if (openIdx === -1) return null;
  return text.slice(openIdx + tag.length + 2, closeIdx).trim();
}

const stringIds = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];

/** Validate a `<branch_doc>` / `<root_doc>` object; null when malformed */
export function normalizeBranchDoc(raw: unknown): BranchDocOutput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const actions = new Set(['create', 'update', 'delete', 'skip']);
  if (!actions.has(r.action as string)) return null;
  const action = r.action as BranchDocOutput['action'];
  if ((action === 'create' || action === 'update') && (typeof r.content !== 'string' || !r.content.trim())) {
    return null;
  }
  return {
    action,
    content: typeof r.content === 'string' ? r.content : undefined,
    reason: typeof r.reason === 'string' ? r.reason : '',
    summary: typeof r.summary === 'string' ? r.summary.replace(/\s+/g, ' ').trim() : '',
    appliedPointerIds: stringIds(r.appliedPointerIds),
  };
}

/** Turn a branch/root doc output into a proposal; null when nothing changes */
export function toDocProposal(branch: string, doc: BranchDocOutput, existing: string | null): DocProposal | null {
  const path = branchDocPath(branch);
  if (doc.action === 'skip') return null;
  if (doc.action === 'delete') {
    if (existing === null) return null;
    return { path, action: 'delete', content: '', reason: doc.reason, appliedPointerIds: [], before: existing };
  }
  const content = doc.content ?? '';
  if (existing !== null && existing.trim() === content.trim()) return null;
  return {
    path,
    action: existing === null ? 'create' : 'update',
    content,
    reason: doc.reason,
    appliedPointerIds: doc.appliedPointerIds,
    before: existing,
  };
}

/**
 * Assign each pointer to the code branch it belongs to: the branch of its
 * anchor doc, or the nearest ancestor branch. Unanchored pointers go to the root.
 */
export function assignPointersToBranches(pointers: DocPointer[], branches: string[]): Map<string, DocPointer[]> {
  const known = new Set(branches);
  const result = new Map<string, DocPointer[]>();
  for (const pointer of pointers) {
    const dir = pointer.docPath ? branchOfDocPath(pointer.docPath) : '';
    let target = dir ?? '';
    if (!known.has(target)) target = parentBranch(target, branches) ?? '';
    result.set(target, [...(result.get(target) ?? []), pointer]);
  }
  return result;
}

function formatPointers(pointers: DocPointer[]): string {
  if (pointers.length === 0) return '(none)';
  return pointers
    .map((p) => {
      const anchor = p.docPath ? `${p.docPath}${p.heading ? ` > ${p.heading}` : ''}` : 'general';
      return `- id=${p.id} | anchor: ${anchor}\n  ${p.content.replace(/\n/g, '\n  ')}`;
    })
    .join('\n');
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n... (truncated)` : text;
}

function extractToolInput(args: Record<string, unknown>): string {
  if (args.pattern) return `pattern: ${args.pattern}`;
  if (args.file_path) {
    const fp = String(args.file_path);
    return fp.length > 50 ? `...${fp.slice(-47)}` : fp;
  }
  if (args.path) return String(args.path);
  return '';
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

function readProjectIndex(projectDir: string): { index: ProjectIndex | null; text: string } {
  const raw = readText(join(projectDir, AUTO_BUILD_PATHS.PROJECT_INDEX));
  if (raw === null) return { index: null, text: '(no project index — explore with Glob/Read)' };
  let index: ProjectIndex | null = null;
  try {
    index = JSON.parse(raw) as ProjectIndex;
  } catch {
    index = null;
  }
  return { index, text: truncate(raw, MAX_INDEX_CHARS) };
}

/** Team docs (CLAUDE.md / AGENTS.md) directly in a branch directory, with content */
function teamDocsFor(projectDir: string, branch: string, docs: ClaudeDocFile[]): string {
  const own = docs.filter((d) => d.layer === 'team' && branchOfDocPath(d.relativePath) === branch);
  if (own.length === 0) return '(none)';
  return own
    .map((d) => `### ${d.relativePath}\n${truncate(readText(join(projectDir, d.relativePath)) ?? '', MAX_TEAM_DOC_CHARS)}`)
    .join('\n\n');
}

// =============================================================================
// Prompts
// =============================================================================

export function buildBranchPrompt(input: {
  projectDir: string;
  branch: CodeBranch;
  childBranches: string[];
  ancestorTeamDocs: string[];
  teamDocs: string;
  existingMalvyDoc: string | null;
  pointers: DocPointer[];
}): string {
  const { branch } = input;
  return [
    `Document the code branch \`${branch.relativePath}\` of the project at "${input.projectDir}".`,
    '',
    `Branch: \`${branch.relativePath}\` (${branch.sourceFileCount} source files owned)`,
    `Your output becomes \`${MALVY_DOCS_DIR}/${branchDocPath(branch.relativePath)}\`.`,
    '',
    '<child_branches>',
    input.childBranches.length > 0
      ? input.childBranches.map((c) => `- ${c} (documented separately — do not cover)`).join('\n')
      : '(none)',
    '</child_branches>',
    '',
    '<ancestor_team_docs>',
    input.ancestorTeamDocs.length > 0 ? input.ancestorTeamDocs.map((p) => `- ${p}`).join('\n') : '(none)',
    '</ancestor_team_docs>',
    '',
    '<team_docs>',
    input.teamDocs,
    '</team_docs>',
    '',
    '<existing_malvy_doc>',
    input.existingMalvyDoc ?? '(none)',
    '</existing_malvy_doc>',
    '',
    '<developer_pointers>',
    formatPointers(input.pointers),
    '</developer_pointers>',
    '',
    'Read the key files of this branch before writing. When done, output your result wrapped in <branch_doc> tags.',
  ].join('\n');
}

export function buildRootPrompt(input: {
  projectDir: string;
  indexText: string;
  teamRootDocs: string;
  existingMalvyDoc: string | null;
  pointers: DocPointer[];
  branchSummaries: Array<{ path: string; summary: string; status: string }>;
  /** `.malvy/core-values.md`; imported into Claude separately, so the root doc must not restate it */
  coreValues?: string;
}): string {
  const coreValues = input.coreValues?.trim()
    ? [
        '<core_values>',
        input.coreValues.trim().slice(0, CORE_VALUES_INJECT_MAX_CHARS),
        '</core_values>',
        'The core values above are loaded for every agent on their own (highest priority). Do not restate or summarize them in the root doc, and never write anything that contradicts them.',
        '',
      ]
    : [];
  return [
    `Write the root agent documentation and project summary for the project at "${input.projectDir}".`,
    '',
    ...coreValues,
    '<project_index>',
    input.indexText,
    '</project_index>',
    '',
    '<team_root_docs>',
    input.teamRootDocs,
    '</team_root_docs>',
    '',
    '<existing_malvy_root_doc>',
    input.existingMalvyDoc ?? '(none)',
    '</existing_malvy_root_doc>',
    '',
    '<branch_summaries>',
    input.branchSummaries.length > 0
      ? input.branchSummaries.map((b) => `- ${b.path} [${b.status}]: ${b.summary}`).join('\n')
      : '(none)',
    '</branch_summaries>',
    '',
    '<developer_pointers>',
    formatPointers(input.pointers),
    '</developer_pointers>',
    '',
    'When done, output <root_doc> and <project_summary> as described.',
  ].join('\n');
}

// =============================================================================
// Model pass
// =============================================================================

interface PassOptions {
  projectDir: string;
  branch: string;
  systemPrompt: string;
  userPrompt: string;
  maxSteps: number;
  modelShorthand: ModelShorthand;
  thinkingLevel: ThinkingLevel;
  abortSignal?: AbortSignal;
  onEvent: (event: ClaudeDocsOptimizerEvent) => void;
}

/**
 * One read-only agent session via the claude CLI; resolves to the full response text.
 * The CLI (not a direct API call) is required for subscription accounts, which get
 * HTTP 429 on direct api.anthropic.com calls — see ai/cli/claude-cli.ts.
 */
async function runPass(options: PassOptions): Promise<string> {
  const { projectDir, branch, abortSignal, onEvent } = options;
  return runClaudeCli({
    prompt: `${options.systemPrompt}\n\n---\n\n${options.userPrompt}`,
    cwd: projectDir,
    modelId: resolveModelId(options.modelShorthand),
    allowedTools: ['Read', 'Glob', 'Grep'],
    maxTurns: options.maxSteps,
    abortSignal,
    onText: (delta) => onEvent({ type: 'text-delta', branch, delta }),
    onToolUse: (toolName, input) =>
      onEvent({ type: 'tool-use', branch, toolName, input: extractToolInput(input) }),
  });
}

async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      await fn(items[next++]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

// =============================================================================
// Runner
// =============================================================================

export async function runClaudeDocsOptimizer(
  config: ClaudeDocsOptimizerConfig,
  onEvent: (event: ClaudeDocsOptimizerEvent) => void,
): Promise<void> {
  const {
    projectDir,
    pointers,
    modelShorthand = 'sonnet',
    thinkingLevel = 'medium',
    abortSignal,
    concurrency = DEFAULT_CONCURRENCY,
  } = config;
  const aborted = () => abortSignal?.aborted === true;

  try {
    const { index, text: indexText } = readProjectIndex(projectDir);
    const [allBranches, docs] = await Promise.all([findCodeBranches(projectDir, index), findClaudeDocs(projectDir)]);
    const allPaths = allBranches.map((b) => b.relativePath);
    const byPath = new Map(allBranches.map((b) => [b.relativePath, b]));

    const requested = config.branches;
    const includeRoot = (config.includeRoot ?? requested === undefined) || (requested?.includes('') ?? false);
    const targets = (requested ?? allPaths).filter((p) => p !== '' && byPath.has(p));

    for (const branch of targets) onEvent({ type: 'branch-progress', branch, status: 'queued' });
    if (includeRoot) onEvent({ type: 'branch-progress', branch: '', status: 'queued' });

    const pointerMap = assignPointersToBranches(pointers, allPaths);
    const teamDocPaths = docs.filter((d) => d.layer === 'team').map((d) => d.relativePath);
    const branchSystemPrompt = tryLoadPrompt('claude_docs_branch') ?? FALLBACK_BRANCH_PROMPT;

    const proposals: DocProposal[] = [];
    const skippedBranches: string[] = [];
    const summaries = new Map<string, string>();
    let succeeded = 0;
    let failed = 0;
    // Distinct failure messages with how many passes hit each, surfaced when everything fails
    const failures = new Map<string, number>();
    const recordFailure = (branch: string, error: unknown) => {
      failed++;
      const message = errorMessage(error);
      failures.set(message, (failures.get(message) ?? 0) + 1);
      onEvent({ type: 'branch-progress', branch, status: 'error', error: message });
    };

    // ---- Branch passes -----------------------------------------------------
    await runPool(targets, concurrency, async (path) => {
      if (aborted()) return;
      const branch = byPath.get(path) as CodeBranch;
      onEvent({ type: 'branch-progress', branch: path, status: 'running' });
      try {
        const existing = readMalvyDoc(projectDir, branchDocPath(path));
        const text = await runPass({
          projectDir,
          branch: path,
          systemPrompt: branchSystemPrompt,
          userPrompt: buildBranchPrompt({
            projectDir,
            branch,
            childBranches: allPaths.filter((p) => p !== path && parentBranch(p, allPaths) === path),
            ancestorTeamDocs: teamDocPaths.filter((doc) => {
              const dir = branchOfDocPath(doc);
              return dir !== null && dir !== path && (dir === '' || path.startsWith(`${dir}/`));
            }),
            teamDocs: teamDocsFor(projectDir, path, docs),
            existingMalvyDoc: existing,
            pointers: pointerMap.get(path) ?? [],
          }),
          maxSteps: BRANCH_MAX_STEPS,
          modelShorthand,
          thinkingLevel,
          abortSignal,
          onEvent,
        });
        if (aborted()) return;

        const block = extractTagBlock(text, 'branch_doc');
        const doc = block === null ? null : normalizeBranchDoc(safeParseJson<unknown>(block));
        if (!doc) throw new Error('No valid <branch_doc> block in the response');

        if (doc.summary) summaries.set(path, doc.summary);
        const proposal = toDocProposal(path, doc, existing);
        succeeded++;
        if (proposal) {
          proposals.push(proposal);
          onEvent({ type: 'branch-progress', branch: path, status: 'done', summary: doc.summary });
        } else {
          skippedBranches.push(path);
          onEvent({ type: 'branch-progress', branch: path, status: 'skipped', summary: doc.summary });
        }
      } catch (error) {
        if (aborted()) return;
        recordFailure(path, error);
      }
    });

    if (aborted()) return;

    // ---- Root pass ---------------------------------------------------------
    let projectSummary: ProjectSummary | null = null;
    if (includeRoot) {
      onEvent({ type: 'branch-progress', branch: '', status: 'running' });
      try {
        const existing = readMalvyDoc(projectDir, branchDocPath(''));
        const malvyFirstLines = new Map(
          docs.filter((d) => d.layer === 'malvy').map((d) => [branchOfDocPath(d.layerPath), d.firstLine])
        );
        const teamFirstLines = new Map(
          docs.filter((d) => d.layer === 'team').map((d) => [branchOfDocPath(d.relativePath), d.firstLine])
        );
        const text = await runPass({
          projectDir,
          branch: '',
          systemPrompt: tryLoadPrompt('claude_docs_root') ?? FALLBACK_ROOT_PROMPT,
          userPrompt: buildRootPrompt({
            projectDir,
            indexText,
            teamRootDocs: teamDocsFor(projectDir, '', docs),
            existingMalvyDoc: existing,
            pointers: pointerMap.get('') ?? [],
            coreValues: loadCoreValues(projectDir),
            branchSummaries: allBranches
              .filter((b) => b.relativePath !== '')
              .map((b) => ({
                path: b.relativePath,
                status: b.status,
                summary:
                  summaries.get(b.relativePath) ||
                  malvyFirstLines.get(b.relativePath) ||
                  teamFirstLines.get(b.relativePath) ||
                  '(not documented yet)',
              })),
          }),
          maxSteps: ROOT_MAX_STEPS,
          modelShorthand,
          thinkingLevel,
          abortSignal,
          onEvent,
        });
        if (aborted()) return;

        const rootBlock = extractTagBlock(text, 'root_doc');
        const rootDoc = rootBlock === null ? null : normalizeBranchDoc(safeParseJson<unknown>(rootBlock));
        const summaryBlock = extractTagBlock(text, 'project_summary');
        projectSummary = summaryBlock === null ? null : normalizeProjectSummary(safeParseJson<unknown>(summaryBlock));
        if (!rootDoc && !projectSummary) throw new Error('No valid <root_doc> or <project_summary> in the response');

        const rootProposal = rootDoc ? toDocProposal('', rootDoc, existing) : null;
        if (rootProposal) proposals.push(rootProposal);

        if (projectSummary) {
          const before = readMalvyDoc(projectDir, PROJECT_SUMMARY_FILE);
          const content = JSON.stringify(projectSummary, null, 2);
          if (before === null || before.trim() !== content.trim()) {
            proposals.push({
              path: PROJECT_SUMMARY_FILE,
              action: before === null ? 'create' : 'update',
              content,
              reason: 'Project summary shown at the top of the Index view.',
              appliedPointerIds: [],
              before,
            });
          }
        }

        succeeded++;
        if (rootProposal) {
          onEvent({ type: 'branch-progress', branch: '', status: 'done' });
        } else {
          if (rootDoc) skippedBranches.push('');
          onEvent({ type: 'branch-progress', branch: '', status: 'skipped' });
        }
      } catch (error) {
        if (aborted()) return;
        recordFailure('', error);
      }
    }

    if (aborted()) return;
    if (succeeded === 0 && failed > 0) {
      const details = [...failures]
        .map(([message, count]) => (count > 1 ? `${message} (${count} passes)` : message))
        .join('\n');
      onEvent({ type: 'error', error: `Every documentation pass failed:\n${details}` });
      return;
    }
    if (succeeded === 0 && failed === 0 && !includeRoot) {
      onEvent({ type: 'error', error: 'None of the requested branches exist.' });
      return;
    }
    onEvent({ type: 'complete', proposals, projectSummary, skippedBranches });
  } catch (error) {
    if (aborted()) return;
    onEvent({ type: 'error', error: errorMessage(error) });
  }
}
