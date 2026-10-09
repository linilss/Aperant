/**
 * Ideation context: compact lists of what already exists (roadmap features,
 * kanban tasks) so ideation does not re-propose covered work. Kept small to
 * save tokens — titles + status, capped, descriptions truncated.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Max roadmap features / tasks listed in the prompt */
export const IDEATION_CONTEXT_CAP = 40;
/** Max characters of a feature description in the prompt */
export const IDEATION_CONTEXT_DESC_MAX = 80;

export interface IdeationContextTask {
  title: string;
  status: string;
}

const oneLine = (value: unknown): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const moreSuffix = (total: number) =>
  total > IDEATION_CONTEXT_CAP ? `- (+${total - IDEATION_CONTEXT_CAP} more not listed)\n` : '';

/** Prompt section listing existing roadmap features; '' when there are none */
export function buildRoadmapContextSection(features: Array<Record<string, unknown>>): string {
  const items = features.filter((f) => oneLine(f.title));
  if (items.length === 0) return '';
  const lines = items.slice(0, IDEATION_CONTEXT_CAP).map((f) => {
    const priority = oneLine(f.priority) || '?';
    const status = oneLine(f.status) || 'under_review';
    const desc = truncate(oneLine(f.description), IDEATION_CONTEXT_DESC_MAX);
    return `- [${priority}/${status}] ${oneLine(f.title)}${desc ? ` — ${desc}` : ''}`;
  });
  return (
    '\n**EXISTING ROADMAP FEATURES** — do not propose ideas already covered by these; ' +
    'you may propose an improvement to one if the idea names the feature it improves:\n' +
    `${lines.join('\n')}\n${moreSuffix(items.length)}`
  );
}

/** Prompt section listing existing kanban tasks; '' when there are none */
export function buildKanbanContextSection(tasks: IdeationContextTask[]): string {
  const items = tasks.filter((t) => oneLine(t.title));
  if (items.length === 0) return '';
  const lines = items
    .slice(0, IDEATION_CONTEXT_CAP)
    .map((t) => `- [${oneLine(t.status) || '?'}] ${truncate(oneLine(t.title), 120)}`);
  return (
    '\n**EXISTING TASKS** (kanban) — do not propose ideas that duplicate these:\n' +
    `${lines.join('\n')}\n${moreSuffix(items.length)}`
  );
}

/** Raw features from `.malvy/roadmap/roadmap.json` ([] when absent/unreadable) */
export function loadRoadmapFeaturesForContext(projectDir: string): Array<Record<string, unknown>> {
  const file = join(projectDir, '.malvy', 'roadmap', 'roadmap.json');
  try {
    if (!existsSync(file)) return [];
    const data = JSON.parse(readFileSync(file, 'utf-8')) as { features?: unknown };
    return Array.isArray(data.features)
      ? data.features.filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
      : [];
  } catch {
    return [];
  }
}

/**
 * Tasks for the kanban context: archived ones dropped, unfinished ones first
 * (they are the likeliest duplicates). The prompt section applies the cap.
 */
export function selectKanbanContextTasks(
  tasks: Array<{ title: string; status: string; metadata?: { archivedAt?: string } }>,
): IdeationContextTask[] {
  const active = tasks.filter((t) => !t.metadata?.archivedAt);
  const open = active.filter((t) => t.status !== 'done');
  const done = active.filter((t) => t.status === 'done');
  return [...open, ...done].map((t) => ({ title: t.title, status: t.status }));
}

type ContextTaskSource = Parameters<typeof selectKanbanContextTasks>[0];

/**
 * Runner options from the user's ideation config (both toggles default on).
 * Tasks are only loaded when the kanban toggle is on.
 */
export function ideationContextOptions(
  config: { includeRoadmapContext?: boolean; includeKanbanContext?: boolean },
  getTasks: () => ContextTaskSource,
): { includeRoadmapContext: boolean; includeKanbanContext: boolean; existingTasks?: IdeationContextTask[] } {
  const includeRoadmapContext = config.includeRoadmapContext ?? true;
  const includeKanbanContext = config.includeKanbanContext ?? true;
  if (!includeKanbanContext) return { includeRoadmapContext, includeKanbanContext };
  let tasks: ContextTaskSource = [];
  try {
    tasks = getTasks();
  } catch {
    // Context is best-effort; ideation runs without it
  }
  return { includeRoadmapContext, includeKanbanContext, existingTasks: selectKanbanContextTasks(tasks) };
}
