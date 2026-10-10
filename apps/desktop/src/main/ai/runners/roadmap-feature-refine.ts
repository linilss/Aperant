/**
 * Roadmap Feature Refine (one-shot)
 * =================================
 *
 * Turns a one-line quick-add idea into a proper roadmap feature via the `claude`
 * CLI (read-only tools, project CLAUDE.md + CLAUDE.local.md loaded so Malvy's
 * `.malvy/docs` and pointers are in context). Not the conversational refine
 * (`feature-refine.ts`): no questions, one `<feature_refine>` JSON block out.
 */

import { runClaudeCliDetailed } from '../cli/claude-cli';
import { tryLoadPrompt } from '../prompts/prompt-loader';
import { safeParseJson } from '../../utils/json-repair';
import { loadCoreValuesSection } from '../../core-values';
import { buildDirectionTaggingSection } from './competitors/guidance';
import { loadCompetitorState } from './competitors/persistence';
import { buildProjectBrief } from './competitors/project-brief';
import type { FeatureRefinement } from '../../ipc-handlers/roadmap/feature-persistence';
import type { RoadmapFeaturePriority } from '../../../shared/types';

/** Agentic turn cap: a couple of Reads/Greps plus the answer */
export const FEATURE_REFINE_MAX_TURNS = 6;
const TITLE_MAX = 70;
const MAX_EXISTING_FEATURES = 150;

export interface RoadmapFeatureRefineInput {
  projectDir: string;
  /** The user's one-line idea */
  line: string;
  /** Other roadmap features (for duplicate detection) */
  existingFeatures: Array<{ id: string; title: string }>;
  phases: Array<{ id: string; name: string; description?: string }>;
  suggestPriority: boolean;
  /** Full model id (resolveModelId) */
  modelId: string;
  abortSignal?: AbortSignal;
}

export interface RoadmapFeatureRefineOutput {
  refinement: FeatureRefinement;
  costUsd?: number;
  numTurns?: number;
}

const FALLBACK_PROMPT =
  'Turn the user\'s one-line roadmap idea into a proper feature for this project. ' +
  'Output one <feature_refine>{"title","description","rationale","complexity","impact","priority",' +
  '"phase_id","acceptance_criteria","direction_ids","duplicate_of"}</feature_refine> JSON block.';

function directionsSection(projectDir: string): string {
  try {
    return buildDirectionTaggingSection(loadCompetitorState(projectDir));
  } catch {
    return '';
  }
}

const oneLine = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** Full prompt: core values (highest priority) + instructions + idea + project context */
export function buildFeatureRefinePrompt(input: RoadmapFeatureRefineInput): string {
  const brief = buildProjectBrief(input.projectDir);
  const phases = input.phases
    .map((p) => `- id "${p.id}" — ${oneLine(p.name, 80)}${p.description ? `: ${oneLine(p.description, 160)}` : ''}`)
    .join('\n');
  const existing = input.existingFeatures
    .slice(0, MAX_EXISTING_FEATURES)
    .map((f) => `- id "${f.id}" — ${oneLine(f.title, 100)}`)
    .join('\n');

  return [
    loadCoreValuesSection(input.projectDir).trim(),
    tryLoadPrompt('roadmap_feature_refine') ?? FALLBACK_PROMPT,
    '---',
    `## The user's idea\n${input.line.trim()}`,
    `## Project brief\n${brief || '(none — rely on CLAUDE.md / the code)'}`,
    `## Roadmap phases\n${phases || '(none)'}`,
    `## Existing roadmap features (avoid duplicates)\n${existing || '(none)'}`,
    directionsSection(input.projectDir).trim(),
    input.suggestPriority
      ? '## Priority\nSuggest a MoSCoW priority and the best-fit phase. Favour features that advance the top-ranked directions.'
      : '## Priority\nThe user already set priority and phase — you may omit "priority" and "phase_id".',
  ]
    .filter(Boolean)
    .join('\n\n');
}

const LEVELS = ['low', 'medium', 'high'] as const;
const PRIORITIES: readonly RoadmapFeaturePriority[] = ['must', 'should', 'could', 'wont'];

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const level = (v: unknown) => {
  const s = str(v).toLowerCase();
  return (LEVELS as readonly string[]).includes(s) ? (s as (typeof LEVELS)[number]) : undefined;
};
const stringList = (v: unknown, max: number) =>
  Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.replace(/^\s*(?:[-*]\s*(?:\[ \]\s*)?|\d+[.)]\s*)/, '').trim())
        .filter(Boolean)
        .slice(0, max)
    : [];

function clipTitle(title: string): string {
  const flat = title.replace(/\s+/g, ' ').trim();
  if (flat.length <= TITLE_MAX) return flat;
  const cut = flat.slice(0, TITLE_MAX);
  const space = cut.lastIndexOf(' ');
  return (space > TITLE_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '');
}

/** Parse the last `<feature_refine>` block; null when absent or without a title */
export function parseFeatureRefineOutput(text: string): FeatureRefinement | null {
  const blocks = [...text.matchAll(/<feature_refine>([\s\S]*?)<\/feature_refine>/g)];
  const body = blocks.at(-1)?.[1];
  if (!body) return null;
  const json = body.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const raw = safeParseJson<Record<string, unknown>>(json);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const title = clipTitle(str(raw.title));
  if (!title) return null;
  const priority = str(raw.priority).toLowerCase();
  const duplicateOf = str(raw.duplicate_of ?? raw.duplicateOf);
  return {
    title,
    description: str(raw.description),
    rationale: str(raw.rationale),
    complexity: level(raw.complexity),
    impact: level(raw.impact),
    priority: (PRIORITIES as readonly string[]).includes(priority) ? (priority as RoadmapFeaturePriority) : undefined,
    phaseId: str(raw.phase_id ?? raw.phaseId) || undefined,
    acceptanceCriteria: stringList(raw.acceptance_criteria ?? raw.acceptanceCriteria, 5),
    directionIds: stringList(raw.direction_ids ?? raw.directionIds, 20),
    duplicateOf: duplicateOf && duplicateOf !== 'null' ? duplicateOf : null,
  };
}

/** Run one refinement; throws when the CLI fails or returns no usable block */
export async function runRoadmapFeatureRefine(input: RoadmapFeatureRefineInput): Promise<RoadmapFeatureRefineOutput> {
  const result = await runClaudeCliDetailed({
    prompt: buildFeatureRefinePrompt(input),
    cwd: input.projectDir,
    modelId: input.modelId,
    allowedTools: ['Read', 'Glob', 'Grep'],
    restrictTools: true,
    minimalContext: true,
    projectContext: true,
    maxTurns: FEATURE_REFINE_MAX_TURNS,
    abortSignal: input.abortSignal,
  });
  const refinement = parseFeatureRefineOutput(result.text) ?? parseFeatureRefineOutput(result.resultText);
  if (!refinement) throw new Error('No <feature_refine> block in the response');
  return { refinement, costUsd: result.totalCostUsd, numTurns: result.numTurns };
}
