/**
 * Lean, inline description of "what this project is" for the competitor
 * prompts, so the CLI needs no Read turns. Each section names its source file
 * so the directions pass can cite it.
 *
 * Order: .malvy/docs/project_summary.json, else .malvy/docs/CLAUDE.md, else the
 * team CLAUDE.md / README.md; plus roadmap discovery output and a tiny slice of
 * project_index.json when present.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { safeParseJson } from '../../../utils/json-repair';

const MAX_DOC_CHARS = 4_000;
const MAX_DISCOVERY_CHARS = 2_500;

function read(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf-8') : null;
  } catch {
    return null;
  }
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}\n…(truncated)` : text);

function summarySection(projectDir: string): string | null {
  const raw = read(join(projectDir, '.malvy', 'docs', 'project_summary.json'));
  const data = raw ? safeParseJson<Record<string, unknown>>(raw) : null;
  if (!data || typeof data.overview !== 'string' || !data.overview.trim()) return null;
  const list = (v: unknown, key: string, val: string) =>
    Array.isArray(v)
      ? v
          .map((x) => (x && typeof x === 'object' ? `${(x as Record<string, unknown>)[key]}: ${(x as Record<string, unknown>)[val]}` : String(x)))
          .slice(0, 12)
      : [];
  const stack = Array.isArray(data.stack) ? data.stack.join(', ') : '';
  const modules = list(data.keyModules, 'path', 'summary');
  return [
    '### Source: .malvy/docs/project_summary.json',
    data.overview.trim(),
    stack ? `Stack: ${stack}` : '',
    modules.length ? `Key modules:\n${modules.map((m) => `- ${m}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function docSection(projectDir: string): string | null {
  for (const rel of ['.malvy/docs/CLAUDE.md', 'CLAUDE.md', 'README.md', 'readme.md']) {
    const text = read(join(projectDir, rel));
    if (text?.trim()) return `### Source: ${rel}\n${clip(text.trim(), MAX_DOC_CHARS)}`;
  }
  return null;
}

function discoverySection(projectDir: string): string | null {
  const raw = read(join(projectDir, '.malvy', 'roadmap', 'roadmap_discovery.json'));
  const data = raw ? safeParseJson<Record<string, unknown>>(raw) : null;
  if (!data) return null;
  const picked = {
    project_name: data.project_name,
    product_vision: data.product_vision,
    target_audience: data.target_audience,
    current_state: data.current_state,
  };
  return `### Source: .malvy/roadmap/roadmap_discovery.json\n${clip(JSON.stringify(picked), MAX_DISCOVERY_CHARS)}`;
}

function indexSection(projectDir: string): string | null {
  const raw = read(join(projectDir, '.malvy', 'project_index.json'));
  const data = raw ? safeParseJson<Record<string, unknown>>(raw) : null;
  if (!data) return null;
  const services = data.services && typeof data.services === 'object' ? Object.keys(data.services).slice(0, 10) : [];
  const type = typeof data.project_type === 'string' ? data.project_type : '';
  if (!type && services.length === 0) return null;
  return `### Source: .malvy/project_index.json\nType: ${type || 'unknown'}${services.length ? `; services: ${services.join(', ')}` : ''}`;
}

/** Build the brief; '' when nothing describes the project */
export function buildProjectBrief(projectDir: string): string {
  const sections = [
    summarySection(projectDir) ?? docSection(projectDir),
    discoverySection(projectDir),
    indexSection(projectDir),
  ].filter((s): s is string => !!s);
  return sections.join('\n\n');
}
