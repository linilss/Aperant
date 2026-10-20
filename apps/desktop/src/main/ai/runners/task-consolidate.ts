/**
 * Consolidate planning tasks
 * ==========================
 *
 * A read-only `claude` CLI pass groups the Planning column's tasks that belong
 * together (same feature, same files, one depends on the other) so they can be
 * built as one task each. Every task ends up in exactly one group; a task that
 * fits nowhere is its own group.
 */

import { runClaudeCliDetailed } from '../cli/claude-cli';
import { safeParseJson } from '../../utils/json-repair';

export const CONSOLIDATE_MAX_TURNS = 20;
const MAX_SPEC_CHARS = 1_500;

export interface ConsolidateTaskInput {
  specId: string;
  title: string;
  spec: string;
}

import type { TaskGroup } from '../../../shared/utils/task-consolidation';
export type { TaskGroup };

export function buildConsolidatePrompt(tasks: ConsolidateTaskInput[]): string {
  const list = tasks
    .map((t) => `### ${t.specId}\nTitle: ${t.title}\n${t.spec.replace(/\s+/g, ' ').slice(0, MAX_SPEC_CHARS)}`)
    .join('\n\n');
  return [
    'You consolidate a backlog of coding tasks for one project into as few tasks as make sense. You run non-interactively and are read-only: never edit files.',
    'Group tasks that belong together: the same feature or user flow, the same files or module, or one that only makes sense with the other (e.g. an endpoint and its UI, an API change and the client that needs it). ' +
      'Use Glob/Grep/Read sparingly to check which files tasks touch when the specs are unclear.',
    'Rules:\n' +
      '- Every task id appears in exactly one group. A task that fits nowhere is a group of one.\n' +
      '- Prefer few groups, but keep each group buildable as ONE focused task: split a group that spans unrelated areas or would be very large (e.g. two platforms).\n' +
      '- Order the ids in each group in build order (foundations first).\n' +
      '- Titles: short noun phrase in the language the tasks use.',
    `## Tasks (${tasks.length})\n${list}`,
    'Finish with exactly one block, valid JSON, nothing after it:\n' +
      '<task_groups>[{"title":"","summary":"one sentence","specIds":["001-…"],"reason":"why these belong together"}]</task_groups>',
  ].join('\n\n');
}

/**
 * Parse the last `<task_groups>` block. Unknown ids are dropped, duplicates keep
 * their first group, and tasks the model left out become groups of one.
 */
export function parseTaskGroups(text: string, tasks: ConsolidateTaskInput[]): TaskGroup[] | null {
  const body = [...text.matchAll(/<task_groups>([\s\S]*?)<\/task_groups>/g)].at(-1)?.[1];
  if (!body) return null;
  const raw = safeParseJson<unknown>(body.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  if (!Array.isArray(raw)) return null;

  const known = new Map(tasks.map((t) => [t.specId, t]));
  const used = new Set<string>();
  const groups: TaskGroup[] = [];
  for (const g of raw) {
    if (!g || typeof g !== 'object') continue;
    const r = g as Record<string, unknown>;
    const ids = (Array.isArray(r.specIds) ? r.specIds : [])
      .filter((id): id is string => typeof id === 'string' && known.has(id) && !used.has(id));
    if (ids.length === 0) continue;
    for (const id of ids) used.add(id);
    groups.push({
      title: typeof r.title === 'string' && r.title.trim() ? r.title.trim() : (known.get(ids[0])?.title ?? ids[0]),
      summary: typeof r.summary === 'string' ? r.summary.trim() : '',
      specIds: ids,
      reason: typeof r.reason === 'string' ? r.reason.trim() : '',
    });
  }
  for (const t of tasks) {
    if (!used.has(t.specId)) groups.push({ title: t.title, summary: '', specIds: [t.specId], reason: '' });
  }
  return groups;
}

export async function runTaskConsolidation(input: {
  projectDir: string;
  tasks: ConsolidateTaskInput[];
  modelId: string;
  abortSignal?: AbortSignal;
}): Promise<TaskGroup[]> {
  const result = await runClaudeCliDetailed({
    prompt: buildConsolidatePrompt(input.tasks),
    cwd: input.projectDir,
    projectPath: input.projectDir,
    modelId: input.modelId,
    allowedTools: ['Read', 'Glob', 'Grep'],
    restrictTools: true,
    minimalContext: true,
    projectContext: true,
    maxTurns: CONSOLIDATE_MAX_TURNS,
    abortSignal: input.abortSignal,
  });
  const groups = parseTaskGroups(result.text, input.tasks) ?? parseTaskGroups(result.resultText, input.tasks);
  if (!groups) throw new Error('No <task_groups> block in the response');
  return groups;
}
