/**
 * Funnel context for roadmap feature generation: what the Context and Design steps
 * produced, so the roadmap builds on the developer's pointers, the documented
 * architecture and the design system. Pointers are inlined (short, binding); docs and
 * the design system are given as paths for the agent to read with its Read tools.
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { findClaudeDocs, MALVY_POINTERS_FILE, stripPointersTitle } from '../../claude-docs';
import { detectDesignSystem, DESIGN_SNAPSHOT_DIR } from '../../design-system';

const POINTERS_MAX_CHARS = 3_000;
const MAX_DOCS_LISTED = 25;

export function loadPointersSection(projectDir: string): string {
  const file = path.join(projectDir, MALVY_POINTERS_FILE);
  if (!existsSync(file)) return '';
  let body: string;
  try {
    body = stripPointersTitle(readFileSync(file, 'utf-8')).trim();
  } catch {
    return '';
  }
  if (!body) return '';
  const clipped = body.length > POINTERS_MAX_CHARS ? `${body.slice(0, POINTERS_MAX_CHARS)}\n…` : body;
  return (
    '\n## DEVELOPER POINTERS (binding — from the Context step)\n' +
    'Short corrections the developer pinned to the docs. Features must not contradict them; ' +
    'where a pointer says "not X, rather Y", plan for Y.\n\n' +
    `${clipped}\n`
  );
}

export async function loadDocsSection(projectDir: string): Promise<string> {
  let docs: Awaited<ReturnType<typeof findClaudeDocs>>;
  try {
    docs = await findClaudeDocs(projectDir);
  } catch {
    return '';
  }
  if (docs.length === 0) return '';
  const listed = docs.slice(0, MAX_DOCS_LISTED).map((d) => `- ${d.relativePath}${d.firstLine ? ` — ${d.firstLine}` : ''}`);
  return (
    '\n## PROJECT DOCUMENTATION (Context step)\n' +
    'Read the root doc and the ones relevant to each area you plan features for. Use them to ' +
    'judge what already exists, what is hard, and to avoid proposing what is already built.\n' +
    `${listed.join('\n')}\n` +
    (docs.length > MAX_DOCS_LISTED ? `- …and ${docs.length - MAX_DOCS_LISTED} more\n` : '')
  );
}

export function loadDesignSection(projectDir: string): string {
  let lines: string[] = [];
  try {
    const detection = detectDesignSystem(projectDir);
    if (detection.name) lines.push(`Name: ${detection.name}`);
    if (detection.sourceDir) lines.push(`Source: ${detection.sourceDir}/ (README, tokens, components)`);
    if (existsSync(path.join(projectDir, DESIGN_SNAPSHOT_DIR))) lines.push(`Synced snapshot: ${DESIGN_SNAPSHOT_DIR}/`);
    if (detection.tokenFiles.length > 0) lines.push(`Token files: ${detection.tokenFiles.join(', ')}`);
  } catch {
    lines = [];
  }
  if (lines.length === 0) return '';
  return (
    '\n## DESIGN SYSTEM (Design step)\n' +
    `${lines.map((l) => `- ${l}`).join('\n')}\n` +
    'Skim it before writing UI features: describe them with its components and patterns, and ' +
    'keep them consistent with its look and tone. A component or pattern the roadmap needs but ' +
    'the design system lacks can be its own feature.\n'
  );
}

/** Pointers, docs map and design system, in that order (pointers weigh heaviest). */
export async function loadFunnelContextSection(projectDir: string): Promise<string> {
  return loadPointersSection(projectDir) + (await loadDocsSection(projectDir)) + loadDesignSection(projectDir);
}

/** Competitor guidance for ideation: features worth matching, as ideas. */
export function buildCompetitorIdeasSection(competitorFile: string): string {
  return (
    `\n## COMPETITORS (Competitors step)\nAnalysis file: ${competitorFile}\n` +
    'Read it. Competitor key features and strengths worth striving for — that users would expect or ' +
    'that make competitors win — are good ideas when they fit the core values and this product ' +
    "doesn't have them yet; name the competitor in the idea's rationale. Pain points and market gaps " +
    'are openings too. Skip what conflicts with the core values.\n'
  );
}

/** Competitor guidance for the features phase, given an analysis file. */
export function buildCompetitorSection(competitorFile: string): string {
  return (
    `**Competitor Analysis File**: ${competitorFile}\n` +
    'Read it and use it two ways:\n' +
    '1. Prioritize features that address competitor pain points and market gaps; put the addressed ' +
    'pain point / gap IDs in each feature\'s "competitor_insight_ids".\n' +
    '2. Look at each competitor\'s key features and strengths. Include the ones worth striving for — ' +
    'that users of this product would expect or that make competitors win — when they fit the core ' +
    'values and the product\'s direction, and the product doesn\'t have them yet. Name the competitor(s) ' +
    'in the feature\'s rationale. Skip what conflicts with the core values.\n'
  );
}
