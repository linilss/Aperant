/**
 * CLAUDE.md documentation tree helpers.
 *
 * Two layers exist side by side:
 * - **team**: `CLAUDE.md` / `AGENTS.md` files tracked in the repository. Read-only for Malvy.
 * - **malvy**: `<project>/.malvy/docs/<same relative path>/CLAUDE.md`, Malvy's local,
 *   git-excluded layer that the docs optimizer writes.
 *
 * Developer pointers are mirrored to `<project>/.malvy/pointers.md` so that the
 * agent worker thread (which has no access to memory.db) can inject them.
 *
 * Pure Node `fs` only — no Electron imports — so the worker thread can use it.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ClaudeDocFile,
  ClaudeDocLayer,
  DocPointer,
  DocProposal,
  ProjectSummary,
} from '../shared/types/claude-docs';

export const MALVY_DOCS_DIR = '.malvy/docs';
export const MALVY_POINTERS_FILE = '.malvy/pointers.md';
export const MALVY_DOCS_META_FILE = '.malvy/docs/.meta.json';
/** Project summary written by the optimizer's root pass (relative to `.malvy/docs/`) */
export const PROJECT_SUMMARY_FILE = 'project_summary.json';

/** Root doc line budget (always loaded) and per-directory budget */
export const ROOT_DOC_LINE_LIMIT = 100;
export const NESTED_DOC_LINE_LIMIT = 60;

export const TEAM_DOC_PATTERN = /^(claude|agents)\.md$/i;
const MALVY_DOC_NAME = 'CLAUDE.md';
const IGNORED_DIRS = new Set([
  'node_modules',
  'worktrees',
  'dist',
  'build',
  'out',
  'vendor',
  'Pods',
  'bin',
  'obj',
  'target',
  'coverage',
]);
const MAX_DEPTH = 6;

// ============================================================
// DISCOVERY
// ============================================================

/**
 * Find all doc files in both layers. Team docs are found anywhere in the repo
 * (skipping hidden, dependency and build folders); Malvy docs only under
 * `.malvy/docs/`. Sorted team first, then root-first within each layer.
 */
export async function findClaudeDocs(projectPath: string): Promise<ClaudeDocFile[]> {
  const team: string[] = [];
  await walk(projectPath, '', 0, team, (name) => TEAM_DOC_PATTERN.test(name));

  const malvyRoot = path.join(projectPath, MALVY_DOCS_DIR);
  const malvy: string[] = [];
  if (existsSync(malvyRoot)) {
    await walk(malvyRoot, '', 0, malvy, (name) => name === MALVY_DOC_NAME);
  }

  const describe = async (layer: ClaudeDocLayer, layerPath: string): Promise<ClaudeDocFile> => {
    const relativePath = layer === 'malvy' ? `${MALVY_DOCS_DIR}/${layerPath}` : layerPath;
    const content = await readFile(path.join(projectPath, relativePath), 'utf-8').catch(() => '');
    return { relativePath, layerPath, layer, lines: countLines(content), firstLine: firstLineOf(content) };
  };

  const byDepth = (a: string, b: string) =>
    a.split('/').length - b.split('/').length || a.localeCompare(b);

  return Promise.all([
    ...team.sort(byDepth).map((p) => describe('team', p)),
    ...malvy.sort(byDepth).map((p) => describe('malvy', p)),
  ]);
}

async function walk(
  root: string,
  rel: string,
  depth: number,
  found: string[],
  matches: (name: string) => boolean
): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(path.join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isFile() && matches(entry.name)) {
      found.push(entryRel);
    } else if (
      entry.isDirectory() &&
      depth < MAX_DEPTH &&
      !entry.name.startsWith('.') &&
      !IGNORED_DIRS.has(entry.name)
    ) {
      await walk(root, entryRel, depth + 1, found, matches);
    }
  }
}

export function countLines(content: string): number {
  if (!content) return 0;
  const trimmed = content.endsWith('\n') ? content.slice(0, -1) : content;
  return trimmed.split('\n').length;
}

function firstLineOf(content: string): string {
  const line = content.split('\n').find((l) => l.trim() !== '') ?? '';
  return line.replace(/^#+\s*/, '').trim();
}

/** True when a doc is over its line budget (root files: 100, nested: 60) */
export function isDocOverBudget(doc: Pick<ClaudeDocFile, 'layerPath' | 'lines'>): boolean {
  const isRoot = !doc.layerPath.includes('/');
  return doc.lines > (isRoot ? ROOT_DOC_LINE_LIMIT : NESTED_DOC_LINE_LIMIT);
}

/**
 * Read a doc file by its project-relative path. Only CLAUDE.md / AGENTS.md
 * files inside the project can be read.
 */
export async function readClaudeDoc(projectPath: string, relativePath: string): Promise<string> {
  const resolved = path.resolve(projectPath, relativePath);
  const root = path.resolve(projectPath);
  if (!resolved.startsWith(root + path.sep) || !TEAM_DOC_PATTERN.test(path.basename(resolved))) {
    throw new Error(`Not a doc file: ${relativePath}`);
  }
  return readFile(resolved, 'utf-8');
}

/**
 * Resolve the project root that owns `.malvy/` for a directory that may be a
 * task worktree (`<project>/.malvy/worktrees/...`). Worktrees don't contain the
 * git-excluded Malvy layer, so docs and pointers are read from the owner.
 */
export function resolveMalvyRoot(projectDir: string): string {
  const normalized = projectDir.split(path.sep).join('/');
  const marker = '/.malvy/worktrees/';
  const idx = normalized.indexOf(marker);
  if (idx === -1) return projectDir;
  return projectDir.slice(0, idx);
}

// ============================================================
// MALVY LAYER WRITES
// ============================================================

/**
 * Validate a proposal path and resolve it to an absolute path under
 * `<project>/.malvy/docs/`. Throws for absolute paths, traversal, or files
 * not named `CLAUDE.md` (the only exception is `project_summary.json` at the
 * docs root).
 */
export function resolveMalvyDocTarget(projectPath: string, docPath: string): string {
  if (typeof docPath !== 'string' || docPath.trim() === '') {
    throw new Error('Empty path');
  }
  let rel = docPath.trim().replace(/\\/g, '/');
  if (rel.startsWith(`${MALVY_DOCS_DIR}/`)) {
    rel = rel.slice(MALVY_DOCS_DIR.length + 1);
  }
  if (path.isAbsolute(rel) || path.posix.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) {
    throw new Error(`Absolute paths are not allowed: ${docPath}`);
  }
  if (rel.split('/').some((segment) => segment === '..')) {
    throw new Error(`Path traversal is not allowed: ${docPath}`);
  }
  if (rel !== PROJECT_SUMMARY_FILE && path.posix.basename(rel) !== MALVY_DOC_NAME) {
    throw new Error(`Only CLAUDE.md files can be written: ${docPath}`);
  }

  const docsRoot = path.resolve(projectPath, MALVY_DOCS_DIR);
  const target = path.resolve(docsRoot, rel);
  if (!target.startsWith(docsRoot + path.sep)) {
    throw new Error(`Path escapes ${MALVY_DOCS_DIR}: ${docPath}`);
  }
  return target;
}

/** Read the current content of a Malvy doc, or null if it doesn't exist / is invalid */
export function readMalvyDoc(projectPath: string, docPath: string): string | null {
  try {
    return readFileSync(resolveMalvyDocTarget(projectPath, docPath), 'utf-8');
  } catch {
    return null;
  }
}

/** Malvy doc path (relative to `.malvy/docs/`) for a code branch; `''` is the root */
export function branchDocPath(branch: string): string {
  return branch ? `${branch}/${MALVY_DOC_NAME}` : MALVY_DOC_NAME;
}

/**
 * Code branch a `CLAUDE.md` path belongs to (its directory). Accepts paths
 * relative to `.malvy/docs/` or project-relative `.malvy/docs/...` paths.
 * Returns null for anything that is not a CLAUDE.md / AGENTS.md file.
 */
export function branchOfDocPath(docPath: string): string | null {
  let rel = docPath.trim().replace(/\\/g, '/');
  if (rel.startsWith(`${MALVY_DOCS_DIR}/`)) rel = rel.slice(MALVY_DOCS_DIR.length + 1);
  if (!TEAM_DOC_PATTERN.test(path.posix.basename(rel))) return null;
  const dir = path.posix.dirname(rel);
  return dir === '.' ? '' : dir;
}

/**
 * Write approved proposals. Writes ONLY under `.malvy/docs/`; invalid paths are
 * reported as errors and skipped. `project_summary.json` must contain a valid
 * project summary. Records the optimization time in `.meta.json` (globally and
 * per code branch) when at least one proposal was applied.
 */
export function applyDocProposals(
  projectPath: string,
  proposals: DocProposal[]
): { applied: DocProposal[]; errors: Array<{ path: string; error: string }> } {
  const applied: DocProposal[] = [];
  const errors: Array<{ path: string; error: string }> = [];

  for (const proposal of proposals) {
    try {
      const target = resolveMalvyDocTarget(projectPath, proposal.path);
      const isSummary = path.basename(target) === PROJECT_SUMMARY_FILE;
      if (proposal.action === 'delete') {
        rmSync(target, { force: true });
      } else {
        if (typeof proposal.content !== 'string') throw new Error('Missing content');
        let content = proposal.content;
        if (isSummary) {
          const summary = normalizeProjectSummary(safeJsonParse(content));
          if (!summary) throw new Error('Invalid project summary');
          content = JSON.stringify(summary, null, 2);
        }
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, content.endsWith('\n') ? content : `${content}\n`, 'utf-8');
      }
      applied.push(proposal);
    } catch (err) {
      errors.push({ path: String(proposal.path), error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (applied.length > 0) {
    const branches = applied
      .map((p) => branchOfDocPath(p.path))
      .filter((b): b is string => b !== null);
    recordDocsOptimized(projectPath, branches);
  }
  return { applied, errors };
}

// ============================================================
// META (.malvy/docs/.meta.json)
// ============================================================

export interface DocsMeta {
  lastOptimizedAt: string | null;
  /** Per code branch (`''` = root): ISO time it was last documented or skipped */
  branches: Record<string, string>;
}

export function readDocsMeta(projectPath: string): DocsMeta {
  try {
    const raw = JSON.parse(readFileSync(path.join(projectPath, MALVY_DOCS_META_FILE), 'utf-8'));
    const branches: Record<string, string> = {};
    if (raw?.branches && typeof raw.branches === 'object') {
      for (const [key, value] of Object.entries(raw.branches)) {
        if (typeof value === 'string') branches[key] = value;
      }
    }
    return { lastOptimizedAt: typeof raw?.lastOptimizedAt === 'string' ? raw.lastOptimizedAt : null, branches };
  } catch {
    return { lastOptimizedAt: null, branches: {} };
  }
}

/**
 * Record an optimization: sets `lastOptimizedAt` and the per-branch time for
 * each given branch. Other branches keep their previous time.
 */
export function recordDocsOptimized(projectPath: string, branches: string[], at = new Date().toISOString()): void {
  const meta = readDocsMeta(projectPath);
  meta.lastOptimizedAt = at;
  for (const branch of branches) meta.branches[branch] = at;
  const metaPath = path.join(projectPath, MALVY_DOCS_META_FILE);
  mkdirSync(path.dirname(metaPath), { recursive: true });
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf-8');
}

// ============================================================
// PROJECT SUMMARY (.malvy/docs/project_summary.json)
// ============================================================

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function pairs<K extends string, V extends string>(raw: unknown, key: K, value: V): Array<Record<K | V, string>> {
  if (!Array.isArray(raw)) return [];
  const out: Array<Record<K | V, string>> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const k = str((item as Record<string, unknown>)[key]);
    if (!k) continue;
    out.push({ [key]: k, [value]: str((item as Record<string, unknown>)[value]) } as Record<K | V, string>);
  }
  return out;
}

/** Validate and normalise a project summary; null when it has no overview */
export function normalizeProjectSummary(raw: unknown): ProjectSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const overview = str(r.overview);
  if (!overview) return null;
  return {
    overview,
    stack: Array.isArray(r.stack) ? r.stack.map(str).filter(Boolean) : [],
    entryPoints: pairs(r.entryPoints, 'path', 'description'),
    commands: pairs(r.commands, 'command', 'description'),
    keyModules: pairs(r.keyModules, 'path', 'summary'),
  };
}

/** Read `.malvy/docs/project_summary.json`, or null when absent / invalid */
export function readProjectSummary(projectPath: string): ProjectSummary | null {
  try {
    const raw = readFileSync(path.join(projectPath, MALVY_DOCS_DIR, PROJECT_SUMMARY_FILE), 'utf-8');
    return normalizeProjectSummary(JSON.parse(raw));
  } catch {
    return null;
  }
}

// ============================================================
// POINTERS MIRROR
// ============================================================

const POINTERS_TITLE = '# Developer pointers';
const UNANCHORED_GROUP = 'General';

/**
 * Render pointers as a short Markdown list grouped by doc file, then heading.
 * Unanchored pointers come first under "General".
 */
export function renderPointersMarkdown(pointers: DocPointer[]): string {
  const groups = new Map<string, Map<string, DocPointer[]>>();
  const sorted = [...pointers].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const pointer of sorted) {
    const file = pointer.docPath || UNANCHORED_GROUP;
    const heading = pointer.heading ?? '';
    const byHeading = groups.get(file) ?? new Map<string, DocPointer[]>();
    groups.set(file, byHeading);
    byHeading.set(heading, [...(byHeading.get(heading) ?? []), pointer]);
  }

  const files = [...groups.keys()].sort((a, b) => {
    if (a === UNANCHORED_GROUP) return -1;
    if (b === UNANCHORED_GROUP) return 1;
    return a.localeCompare(b);
  });

  const lines: string[] = [
    POINTERS_TITLE,
    '',
    'Short corrections from the developer. They override the docs where they conflict.',
  ];
  for (const file of files) {
    lines.push('', `## ${file}`);
    for (const [heading, items] of groups.get(file) ?? []) {
      if (heading) lines.push('', `### ${heading}`);
      for (const item of items) {
        lines.push(`- ${item.content.replace(/\s*\n\s*/g, ' ').trim()}`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

/** Write `.malvy/pointers.md`. An empty pointer list removes the file. */
export function writePointersFile(projectPath: string, pointers: DocPointer[]): void {
  const filePath = path.join(projectPath, MALVY_POINTERS_FILE);
  if (pointers.length === 0) {
    rmSync(filePath, { force: true });
    return;
  }
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, renderPointersMarkdown(pointers), 'utf-8');
}

/** Pointers file body without its H1 title, for prompt injection */
export function stripPointersTitle(content: string): string {
  return content.replace(/^# Developer pointers\s*\n/, '').trim();
}
