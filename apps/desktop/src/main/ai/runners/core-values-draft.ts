/**
 * Core Values Draft (one-shot)
 * ============================
 *
 * Asks the `claude` CLI for a first draft of the project's core values, based on
 * the project summary and root docs (CLAUDE.md + CLAUDE.local.md are loaded via
 * `projectContext`). Read-only tools; the text goes back to the editor for the
 * user to edit — nothing is written.
 */

import { runClaudeCliDetailed } from '../cli/claude-cli';
import { buildProjectBrief } from './competitors/project-brief';

export const CORE_VALUES_DRAFT_MAX_TURNS = 4;
const DRAFT_MAX_CHARS = 2_000;

export function buildCoreValuesDraftPrompt(projectDir: string): string {
  const brief = buildProjectBrief(projectDir);
  return [
    'Draft the CORE VALUES of this product: the few principles its owner would never trade away, which will steer ' +
      'every later AI decision (competitor strategy, roadmap, feature priorities, code).',
    '',
    'Rules:',
    '- 3 to 6 short markdown bullets, each one sentence, written as firm commitments (e.g. "Kids can never lose.", ' +
      '"No ads or dark patterns.", "Calm over flashy.").',
    '- About values and the user experience the product protects, not features, tech stack or tasks.',
    '- Ground them in what the docs say about the audience and purpose; do not invent facts.',
    '- Read a root doc or README only if the brief below is not enough. Never write anything.',
    '',
    `## Project brief\n${brief || '(none — read README.md / CLAUDE.md)'}`,
    '',
    'Output only one block: <core_values>\n- …\n</core_values>',
  ].join('\n');
}

/** Body of the last `<core_values>` block; null when absent or empty */
export function parseCoreValuesDraft(text: string): string | null {
  const blocks = [...text.matchAll(/<core_values>([\s\S]*?)<\/core_values>/g)];
  const body = blocks.at(-1)?.[1]?.trim();
  if (!body) return null;
  return body.replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```$/, '').trim().slice(0, DRAFT_MAX_CHARS) || null;
}

export async function runCoreValuesDraft(input: {
  projectDir: string;
  modelId: string;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const result = await runClaudeCliDetailed({
    prompt: buildCoreValuesDraftPrompt(input.projectDir),
    cwd: input.projectDir,
    projectPath: input.projectDir,
    modelId: input.modelId,
    allowedTools: ['Read', 'Glob', 'Grep'],
    restrictTools: true,
    minimalContext: true,
    projectContext: true,
    maxTurns: CORE_VALUES_DRAFT_MAX_TURNS,
    abortSignal: input.abortSignal,
  });
  const draft = parseCoreValuesDraft(result.text) ?? parseCoreValuesDraft(result.resultText);
  if (!draft) throw new Error('No <core_values> block in the response');
  return draft;
}
