/**
 * Roadmap Feature Proofread (planning intake)
 * ===========================================
 *
 * When a roadmap feature is moved to Planned, a quick read-only `claude` CLI pass
 * checks that it is still relevant and fills gaps (criteria, stories, risks)
 * before it becomes a task. One `<feature_proofread>` JSON block out.
 */

import { runClaudeCliDetailed } from '../cli/claude-cli';
import { tryLoadPrompt } from '../prompts/prompt-loader';
import { safeParseJson } from '../../utils/json-repair';
import { loadCoreValuesSection } from '../../core-values';
import { buildProjectBrief } from './competitors/project-brief';

/** Agentic turn cap: a handful of Glob/Grep/Read calls plus the answer */
export const FEATURE_PROOFREAD_MAX_TURNS = 12;

export interface FeatureProofreadInput {
  projectDir: string;
  feature: {
    title: string;
    description: string;
    rationale: string;
    acceptanceCriteria: string[];
    userStories: string[];
  };
  modelId: string;
  abortSignal?: AbortSignal;
}

export interface FeatureProofread {
  verdict: 'ready' | 'obsolete';
  note: string;
  title: string;
  description: string;
  rationale: string;
  acceptanceCriteria: string[];
  userStories: string[];
}

const FALLBACK_PROMPT =
  'Proofread this roadmap feature before it becomes a coding task: check it is still relevant (not already built) ' +
  'and fill gaps in acceptance criteria and user stories. Output one <feature_proofread>{"verdict":"ready|obsolete",' +
  '"note","title","description","rationale","acceptance_criteria","user_stories"}</feature_proofread> block.';

const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join('\n') : '(none)');

export function buildFeatureProofreadPrompt(input: FeatureProofreadInput): string {
  const f = input.feature;
  return [
    loadCoreValuesSection(input.projectDir).trim(),
    tryLoadPrompt('roadmap_feature_proofread') ?? FALLBACK_PROMPT,
    '---',
    `## The feature\nTitle: ${f.title}\n\nDescription:\n${f.description || '(none)'}\n\nRationale:\n${f.rationale || '(none)'}\n\n` +
      `Acceptance criteria:\n${list(f.acceptanceCriteria)}\n\nUser stories:\n${list(f.userStories)}`,
    `## Project brief\n${buildProjectBrief(input.projectDir) || '(none — rely on CLAUDE.md / the code)'}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const strings = (v: unknown, max: number) =>
  Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.replace(/^\s*(?:[-*]\s*(?:\[[ x]\]\s*)?|\d+[.)]\s*)/i, '').trim())
        .filter(Boolean)
        .slice(0, max)
    : [];

/** Parse the last `<feature_proofread>` block; null when absent or unusable */
export function parseFeatureProofread(text: string): FeatureProofread | null {
  const body = [...text.matchAll(/<feature_proofread>([\s\S]*?)<\/feature_proofread>/g)].at(-1)?.[1];
  if (!body) return null;
  const raw = safeParseJson<Record<string, unknown>>(body.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const verdict = str(raw.verdict).toLowerCase();
  if (verdict !== 'ready' && verdict !== 'obsolete') return null;
  const result: FeatureProofread = {
    verdict,
    note: str(raw.note),
    title: str(raw.title),
    description: str(raw.description),
    rationale: str(raw.rationale),
    acceptanceCriteria: strings(raw.acceptance_criteria ?? raw.acceptanceCriteria, 10),
    userStories: strings(raw.user_stories ?? raw.userStories, 6),
  };
  // A "ready" answer must carry the feature; an obsolete one must say why
  if (verdict === 'ready' && !result.title) return null;
  if (verdict === 'obsolete' && !result.note) return null;
  return result;
}

/** Run one proofread; throws when the CLI fails or returns no usable block */
export async function runFeatureProofread(input: FeatureProofreadInput): Promise<FeatureProofread> {
  const result = await runClaudeCliDetailed({
    prompt: buildFeatureProofreadPrompt(input),
    cwd: input.projectDir,
    projectPath: input.projectDir,
    modelId: input.modelId,
    allowedTools: ['Read', 'Glob', 'Grep'],
    restrictTools: true,
    minimalContext: true,
    projectContext: true,
    maxTurns: FEATURE_PROOFREAD_MAX_TURNS,
    abortSignal: input.abortSignal,
  });
  const parsed = parseFeatureProofread(result.text) ?? parseFeatureProofread(result.resultText);
  if (!parsed) throw new Error('No <feature_proofread> block in the response');
  return parsed;
}
