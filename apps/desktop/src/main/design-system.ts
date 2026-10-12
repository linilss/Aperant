/**
 * Design System (Context → Design)
 * ================================
 *
 * Finds a project's Claude Design System: an artifact link on claude.ai mentioned
 * near "design" wording in the team docs (CLAUDE.md / AGENTS.md, nested ones too),
 * plus the local source folder that mirrors the artifact (a documented path such as
 * `design/system/project/`, or a folder holding `design-system.json`).
 *
 * Invisible mode: Malvy only writes under `<project>/.malvy/`:
 * - `.malvy/design-system.json` — user overrides ({artifactUrl, sourceDir}) + syncedAt/publishedAt
 * - `.malvy/design-system/`     — snapshot of the artifact's text files (artifact paths)
 *
 * Pure Node `fs` only — no Electron imports.
 */

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type {
  DesignChangedFile,
  DesignComponentInfo,
  DesignDocInfo,
  DesignPublishPlan,
  DesignSystemConfig,
  DesignSystemData,
  DesignSystemDetection,
  DesignSystemLinkCandidate,
} from '../shared/types';
import {
  emptyTokens,
  type ParsedTokens,
  parseCssCustomProperties,
  parseDesignIndexJson,
  parseTokensJson,
  parseXamlColors,
} from './design-system-tokens';

export const DESIGN_CONFIG_FILE = '.malvy/design-system.json';
export const DESIGN_SNAPSHOT_DIR = '.malvy/design-system';
/** The artifact's index file; always published last */
export const DESIGN_INDEX_FILE = 'design-system.json';

const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', '.malvy', '.worktrees', 'bin', 'obj', 'dist', 'build', 'out', 'Pods',
  'DerivedData', '.venv', 'venv', 'vendor', '.next', '.build', 'coverage',
]);
const DOC_NAMES = new Set(['CLAUDE.md', 'AGENTS.md']);
const MAX_DOC_DEPTH = 3;
const MAX_INDEX_DEPTH = 3;
const MAX_LIST_FILES = 2_000;
const MAX_READ_BYTES = 512 * 1024;

/** claude.ai artifact or design links */
export const CLAUDE_DESIGN_URL_RE = /https:\/\/claude\.ai\/(?:code\/artifact|artifact|design)(?:\/[A-Za-z0-9_-]+)+/g;
const DESIGN_WORD_RE = /design/i;
const NEAR_LINES = 3;

const toPosix = (p: string) => p.split(path.sep).join('/');

// =============================================================================
// Config (.malvy/design-system.json)
// =============================================================================

export function readDesignConfig(projectDir: string): DesignSystemConfig {
  try {
    const file = path.join(projectDir, DESIGN_CONFIG_FILE);
    if (!existsSync(file)) return {};
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
    const config: DesignSystemConfig = {};
    for (const key of ['artifactUrl', 'sourceDir', 'syncedAt', 'syncedVersion', 'publishedAt'] as const) {
      if (typeof raw[key] === 'string' && raw[key]) config[key] = raw[key] as string;
    }
    return config;
  } catch {
    return {};
  }
}

export function writeDesignConfig(projectDir: string, config: DesignSystemConfig): DesignSystemConfig {
  const file = path.join(projectDir, DESIGN_CONFIG_FILE);
  mkdirSync(path.dirname(file), { recursive: true });
  const clean = Object.fromEntries(Object.entries(config).filter(([, v]) => typeof v === 'string' && v));
  writeFileSync(file, `${JSON.stringify(clean, null, 2)}\n`, 'utf-8');
  return clean as DesignSystemConfig;
}

export function updateDesignConfig(projectDir: string, patch: Partial<DesignSystemConfig>): DesignSystemConfig {
  return writeDesignConfig(projectDir, { ...readDesignConfig(projectDir), ...patch });
}

export function isClaudeDesignUrl(url: string): boolean {
  return new RegExp(`^${CLAUDE_DESIGN_URL_RE.source}/?$`).test(url.trim());
}

/** Resolve a project-relative path; null when it escapes the project */
export function resolveInsideProject(projectDir: string, rel: string): string | null {
  if (!rel || path.isAbsolute(rel)) return null;
  const abs = path.resolve(projectDir, rel);
  const relBack = path.relative(projectDir, abs);
  if (relBack.startsWith('..') || path.isAbsolute(relBack)) return null;
  return abs;
}

/**
 * Save the user's link/source overrides. Empty strings clear an override so detection
 * takes over again. Throws on an invalid URL or a source folder outside the project.
 */
export function saveDesignOverrides(
  projectDir: string,
  input: { artifactUrl?: string; sourceDir?: string }
): DesignSystemConfig {
  const patch: Partial<DesignSystemConfig> = {};
  if (input.artifactUrl !== undefined) {
    const url = input.artifactUrl.trim().replace(/\/$/, '');
    if (url && !isClaudeDesignUrl(url)) throw new Error('Not a claude.ai artifact or design link');
    patch.artifactUrl = url || undefined;
  }
  if (input.sourceDir !== undefined) {
    const dir = toPosix(input.sourceDir.trim()).replace(/^\.\//, '').replace(/\/$/, '');
    if (dir) {
      const abs = resolveInsideProject(projectDir, dir);
      if (!abs || !existsSync(abs) || !statSync(abs).isDirectory()) throw new Error('Source folder not found');
    }
    patch.sourceDir = dir || undefined;
  }
  return updateDesignConfig(projectDir, patch);
}

// =============================================================================
// Detection
// =============================================================================

function walk(
  root: string,
  maxDepth: number,
  onFile: (abs: string, rel: string) => void,
  rel = '',
  depth = 0
): void {
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      if (depth < maxDepth) walk(root, maxDepth, onFile, childRel, depth + 1);
    } else if (entry.isFile()) {
      onFile(path.join(root, childRel), childRel);
    }
  }
}

/** Team docs: root CLAUDE.md/AGENTS.md first, then nested ones (≤ 3 levels) */
export function listTeamDocs(projectDir: string): string[] {
  const docs: string[] = [];
  walk(projectDir, MAX_DOC_DEPTH, (_abs, rel) => {
    if (DOC_NAMES.has(path.posix.basename(rel))) docs.push(rel);
  });
  return docs.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
}

/** `XR/Resources/Styles/{Colors,Styles}.xaml` → two paths */
export function expandBraces(p: string): string[] {
  const m = /^(.*?)\{([^{}]+)\}(.*)$/.exec(p);
  if (!m) return [p];
  return m[2].split(',').flatMap((part) => expandBraces(`${m[1]}${part.trim()}${m[3]}`));
}

/** Backticked path-like tokens in text (`design/system/project/`, `app.css`) */
function backtickedPaths(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/`([^`\s]+)`/g)) {
    const token = m[1].replace(/^\.\//, '').replace(/[,;:]$/, '');
    if (/[/.]/.test(token) && !/^https?:/.test(token)) out.push(...expandBraces(token));
  }
  return out;
}

function isDesignSourceDir(abs: string): boolean {
  try {
    if (!statSync(abs).isDirectory()) return false;
    return existsSync(path.join(abs, 'tokens.json')) || existsSync(path.join(abs, DESIGN_INDEX_FILE));
  } catch {
    return false;
  }
}

function isTokenFile(abs: string): boolean {
  try {
    const st = statSync(abs);
    if (!st.isFile() || st.size > MAX_READ_BYTES * 4) return false;
    const lower = abs.toLowerCase();
    if (lower.endsWith('.css')) return readFileSync(abs, 'utf-8').includes(':root');
    if (lower.endsWith('.xaml')) return /<Color\s/.test(readFileSync(abs, 'utf-8'));
    return /tokens[^/]*\.json$/.test(lower);
  } catch {
    return false;
  }
}

/** Resolve a doc-mentioned path against the doc's folder, then the project root */
function resolveMentioned(projectDir: string, docRel: string, mentioned: string): string | null {
  const docDir = path.posix.dirname(docRel);
  const tries = docDir && docDir !== '.' ? [path.posix.join(docDir, mentioned), mentioned] : [mentioned];
  for (const rel of tries) {
    const abs = resolveInsideProject(projectDir, rel);
    if (abs && existsSync(abs)) return toPosix(path.relative(projectDir, abs));
  }
  return null;
}

function findIndexDir(projectDir: string): string | null {
  const found: string[] = [];
  walk(projectDir, MAX_INDEX_DEPTH, (_abs, rel) => {
    if (path.posix.basename(rel) === DESIGN_INDEX_FILE) found.push(path.posix.dirname(rel));
  });
  found.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  return found[0] ?? null;
}

/** "Claude Design System" names the artifact type, not this design system */
const GENERIC_NAME_RE = /^claude design system$/i;

function extractName(text: string): string | null {
  const names = [
    ...[...text.matchAll(/\*\*([^*\n]{1,60}?design system)\*\*/gi)].map((m) => m[1].trim()),
    ...[...text.matchAll(/\b([A-Z][\w-]*(?: [A-Z][\w-]*)* Design System)\b/g)].map((m) => m[1].trim()),
  ];
  return names.find((n) => !GENERIC_NAME_RE.test(n)) ?? null;
}

const isAncestorOrSelf = (ancestor: string, child: string) =>
  ancestor === '' || child === ancestor || child.startsWith(`${ancestor}/`);

/** `root: design/system` as documented in a doc (publishing rules) */
function documentedRoots(text: string): string[] {
  return [...text.matchAll(/\broot:\s*`?([\w./-]+?)`?(?=[\s,;)`]|$)/g)].map((m) => m[1].replace(/\/$/, ''));
}

export function detectDesignSystem(projectDir: string, config = readDesignConfig(projectDir)): DesignSystemDetection {
  const candidates: DesignSystemLinkCandidate[] = [];
  let chosen: { candidate: DesignSystemLinkCandidate; context: string; docText: string } | null = null;

  for (const docRel of listTeamDocs(projectDir)) {
    let text: string;
    try {
      text = readFileSync(path.join(projectDir, docRel), 'utf-8');
    } catch {
      continue;
    }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(CLAUDE_DESIGN_URL_RE)) {
        const url = m[0].replace(/[.,;:)]+$/, '');
        const window = lines.slice(Math.max(0, i - NEAR_LINES), i + NEAR_LINES + 1).join('\n');
        const candidate: DesignSystemLinkCandidate = {
          url,
          file: docRel,
          line: i + 1,
          nearDesignWording: DESIGN_WORD_RE.test(window),
        };
        if (candidates.some((c) => c.url === url)) continue;
        candidates.push(candidate);
        if (!chosen && candidate.nearDesignWording) {
          // Wider context for paths: the link's paragraph/list that follows it
          const context = lines.slice(Math.max(0, i - NEAR_LINES), i + 12).join('\n');
          chosen = { candidate, context, docText: text };
        }
      }
    }
  }

  let sourceDir: string | null = null;
  const tokenFiles: string[] = [];
  let publishRoot: string | null = null;
  let name: string | null = null;

  if (chosen) {
    const { candidate, context, docText } = chosen;
    name = extractName(context);
    for (const mentioned of backtickedPaths(context)) {
      const rel = resolveMentioned(projectDir, candidate.file, mentioned.replace(/\/$/, ''));
      if (!rel) continue;
      const abs = path.join(projectDir, rel);
      if (!sourceDir && isDesignSourceDir(abs)) sourceDir = rel;
      else if (isTokenFile(abs) && !tokenFiles.includes(rel)) tokenFiles.push(rel);
    }
    const roots = documentedRoots(docText);
    publishRoot = roots[0] ?? null;
  }
  if (!sourceDir) sourceDir = findIndexDir(projectDir);

  const overridden = { artifactUrl: !!config.artifactUrl, sourceDir: !!config.sourceDir };
  if (config.sourceDir) sourceDir = config.sourceDir;
  const artifactUrl = config.artifactUrl ?? chosen?.candidate.url ?? null;

  if (sourceDir) {
    if (!publishRoot || !isAncestorOrSelf(publishRoot, sourceDir) || publishRoot === sourceDir) {
      const parent = path.posix.dirname(sourceDir);
      publishRoot = parent === '.' ? '' : parent;
    }
  } else {
    publishRoot = null;
  }

  return {
    name,
    artifactUrl,
    sourceDir,
    publishRoot,
    tokenFiles,
    docFile: chosen?.candidate.file ?? null,
    candidates,
    overridden,
  };
}

// =============================================================================
// Display data
// =============================================================================

function listFiles(rootAbs: string, maxDepth = 6): string[] {
  const out: string[] = [];
  const visit = (rel: string, depth: number) => {
    if (out.length >= MAX_LIST_FILES) return;
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(path.join(rootAbs, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name) && depth < maxDepth) visit(childRel, depth + 1);
      } else if (entry.isFile()) {
        out.push(childRel);
      }
    }
  };
  visit('', 0);
  return out.sort();
}

function readJson(abs: string): unknown {
  try {
    return JSON.parse(readFileSync(abs, 'utf-8'));
  } catch {
    return null;
  }
}

function readText(abs: string): string {
  try {
    if (statSync(abs).size > MAX_READ_BYTES * 4) return '';
    return readFileSync(abs, 'utf-8');
  } catch {
    return '';
  }
}

/** First paragraph of a README that isn't a heading */
function firstParagraph(md: string): string | undefined {
  const para = md
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p && !p.startsWith('#') && !p.startsWith('```') && !p.startsWith('|'));
  if (!para) return undefined;
  const flat = para.replace(/\s+/g, ' ');
  return flat.length > 220 ? `${flat.slice(0, 219)}…` : flat;
}

function mdTitle(md: string, fallback: string): string {
  const heading = /^#\s+(.+)$/m.exec(md);
  return heading ? heading[1].trim() : fallback;
}

function mergeTokens(target: ParsedTokens, extra: ParsedTokens): void {
  const add = <T extends { name: string }>(list: T[], items: T[]) => {
    const names = new Set(list.map((x) => x.name));
    for (const item of items) if (!names.has(item.name)) list.push(item);
  };
  add(target.colors, extra.colors);
  add(target.typography, extra.typography);
  add(target.radii, extra.radii);
  add(target.spacing, extra.spacing);
  if (!target.name && extra.name) target.name = extra.name;
}

/** Snapshot folder that holds the design files (`project/` when the artifact uses it) */
function snapshotBase(projectDir: string): string | null {
  const snap = path.join(projectDir, DESIGN_SNAPSHOT_DIR);
  if (!existsSync(snap)) return null;
  const project = path.join(snap, 'project');
  return toPosix(path.relative(projectDir, existsSync(project) ? project : snap));
}

export function hasDesignSnapshot(projectDir: string): boolean {
  return existsSync(path.join(projectDir, DESIGN_SNAPSHOT_DIR));
}

/** Files that belong to the artifact type's runtime, not the design system itself */
const SNAPSHOT_SKIP_RE = /^(artifact-type\/|SKILL\.md$|index\.html$)/;

export function loadDesignData(projectDir: string, detection: DesignSystemDetection): DesignSystemData {
  const sourceAbs = detection.sourceDir ? path.join(projectDir, detection.sourceDir) : null;
  let baseRel: string | null = null;
  let origin: DesignSystemData['origin'] = 'none';
  if (sourceAbs && existsSync(sourceAbs)) {
    baseRel = detection.sourceDir;
    origin = 'source';
  } else {
    const snap = snapshotBase(projectDir);
    if (snap) {
      baseRel = snap;
      origin = 'snapshot';
    }
  }

  const tokens = emptyTokens();
  const parsedFiles: string[] = [];
  const components: DesignComponentInfo[] = [];
  const docs: DesignDocInfo[] = [];
  let rawFiles: string[] = [];

  if (baseRel !== null) {
    const baseAbs = path.join(projectDir, baseRel);
    const files = listFiles(baseAbs).filter((f) => origin !== 'snapshot' || !SNAPSHOT_SKIP_RE.test(f));
    const join = (rel: string) => (baseRel ? `${baseRel}/${rel}` : rel);
    rawFiles = files.map(join);

    // tokens.json (shallowest first)
    for (const rel of files.filter((f) => /(^|\/)tokens\.json$/.test(f)).sort((a, b) => a.split('/').length - b.split('/').length)) {
      mergeTokens(tokens, parseTokensJson(readJson(path.join(baseAbs, rel))));
      parsedFiles.push(join(rel));
    }
    // Index → name
    const indexRel = files.find((f) => path.posix.basename(f) === DESIGN_INDEX_FILE);
    if (indexRel) {
      const index = parseDesignIndexJson(readJson(path.join(baseAbs, indexRel)));
      if (index.name && !tokens.name) tokens.name = index.name;
      parsedFiles.push(join(indexRel));
    }
    // Components: components/<Name>/{README.md,preview.html}
    const byComponent = new Map<string, DesignComponentInfo>();
    for (const rel of files) {
      const m = /^components\/([^/]+)\/(README\.md|preview\.html)$/i.exec(rel);
      if (!m) continue;
      const info = byComponent.get(m[1]) ?? { name: m[1] };
      if (m[2].toLowerCase() === 'readme.md') {
        info.path = join(rel);
        info.description = firstParagraph(readText(path.join(baseAbs, rel)));
      } else {
        info.previewPath = join(rel);
      }
      byComponent.set(m[1], info);
    }
    components.push(...[...byComponent.values()].sort((a, b) => a.name.localeCompare(b.name)));
    // Docs: markdown outside components/
    for (const rel of files) {
      if (!rel.toLowerCase().endsWith('.md') || rel.startsWith('components/')) continue;
      docs.push({ title: mdTitle(readText(path.join(baseAbs, rel)), rel), path: join(rel) });
    }
    docs.sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path));
  }

  // Token files from the docs (app.css :root, Colors.xaml) fill in what the source lacks
  if (tokens.colors.length === 0 || origin === 'none') {
    for (const rel of detection.tokenFiles) {
      const text = readText(path.join(projectDir, rel));
      if (!text) continue;
      const lower = rel.toLowerCase();
      let parsed = emptyTokens();
      if (lower.endsWith('.css')) parsed = parseCssCustomProperties(text);
      else if (lower.endsWith('.xaml')) parsed = { ...emptyTokens(), colors: parseXamlColors(text) };
      else if (lower.endsWith('.json')) parsed = parseTokensJson(readJson(path.join(projectDir, rel)));
      // Several token files (web app.css + app Colors.xaml): group colors by file
      if (detection.tokenFiles.length > 1) {
        const file = path.posix.basename(rel);
        parsed.colors = parsed.colors.map((c) => (c.group ? c : { ...c, group: file }));
      }
      mergeTokens(tokens, parsed);
      parsedFiles.push(rel);
    }
    if (origin === 'none' && parsedFiles.length > 0) {
      origin = 'tokenFiles';
      rawFiles = [...detection.tokenFiles];
    }
  }

  return {
    origin,
    ...(tokens.name ? { name: tokens.name } : {}),
    colors: tokens.colors,
    typography: tokens.typography,
    radii: tokens.radii,
    spacing: tokens.spacing,
    components,
    docs,
    parsedFiles,
    rawFiles: rawFiles.slice(0, 300),
  };
}

/**
 * Read a design file for the tab (component README/preview, docs). Only files inside the
 * source folder, the snapshot or a detected token file are allowed.
 */
export function readDesignFile(projectDir: string, detection: DesignSystemDetection, rel: string): string {
  const abs = resolveInsideProject(projectDir, rel);
  if (!abs) throw new Error('Invalid path');
  const relPosix = toPosix(path.relative(projectDir, abs));
  const allowed =
    (detection.sourceDir && isAncestorOrSelf(detection.sourceDir, relPosix)) ||
    isAncestorOrSelf(DESIGN_SNAPSHOT_DIR, relPosix) ||
    detection.tokenFiles.includes(relPosix);
  if (!allowed) throw new Error('Path is not part of the design system');
  const st = statSync(abs);
  if (!st.isFile()) throw new Error('Not a file');
  if (st.size > MAX_READ_BYTES) throw new Error('File too large to show');
  return readFileSync(abs, 'utf-8');
}

// =============================================================================
// Publish diff + snapshot
// =============================================================================

function sha256(abs: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(abs)).digest('hex');
  } catch {
    return null;
  }
}

/** Index file last, everything else alphabetical */
export function sortForPublish<T extends { path: string }>(files: T[]): T[] {
  const isIndex = (p: string) => path.posix.basename(p) === DESIGN_INDEX_FILE;
  return [...files].sort((a, b) => Number(isIndex(a.path)) - Number(isIndex(b.path)) || a.path.localeCompare(b.path));
}

/**
 * Files in the source folder that differ from the snapshot (by sha256). Artifact paths are
 * relative to the publish root, matching the snapshot layout.
 */
export function computePublishPlan(projectDir: string, detection: DesignSystemDetection): DesignPublishPlan | null {
  const { sourceDir, artifactUrl } = detection;
  if (!sourceDir || !artifactUrl) return null;
  const publishRoot = detection.publishRoot ?? '';
  const sourceAbs = path.join(projectDir, sourceDir);
  if (!existsSync(sourceAbs)) return null;
  const snapshotAbs = path.join(projectDir, DESIGN_SNAPSHOT_DIR);
  const noBaseline = !existsSync(snapshotAbs);

  const files: DesignChangedFile[] = [];
  for (const rel of listFiles(sourceAbs)) {
    const sourcePath = `${sourceDir}/${rel}`;
    const artifactPath = toPosix(path.posix.relative(publishRoot || '.', sourcePath));
    const snapshotFile = path.join(snapshotAbs, artifactPath);
    if (!existsSync(snapshotFile)) {
      files.push({ path: artifactPath, sourcePath, change: 'added' });
    } else if (sha256(path.join(projectDir, sourcePath)) !== sha256(snapshotFile)) {
      files.push({ path: artifactPath, sourcePath, change: 'modified' });
    }
  }
  return { artifactUrl, publishRoot, sourceDir, files: sortForPublish(files), noBaseline };
}

function assertSafeArtifactPath(p: string): void {
  if (!p || path.isAbsolute(p) || p.split(/[\\/]/).includes('..')) throw new Error(`Unsafe artifact path: ${p}`);
}

/** After a publish: copy the published source files into the snapshot so the diff resets */
export function recordPublished(projectDir: string, files: DesignChangedFile[], now = new Date()): DesignSystemConfig {
  const snapshotAbs = path.join(projectDir, DESIGN_SNAPSHOT_DIR);
  for (const file of files) {
    assertSafeArtifactPath(file.path);
    const target = path.join(snapshotAbs, file.path);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(projectDir, file.sourcePath), target);
  }
  return updateDesignConfig(projectDir, { publishedAt: now.toISOString() });
}

/**
 * Replace the snapshot with files the CLI saved from the artifact (`savedDir/<artifact path>`).
 * Returns the artifact paths written.
 */
export function writeSnapshotFromSaved(
  projectDir: string,
  saved: Array<{ dir: string; paths: string[] }>,
  meta: { version?: string; now?: Date } = {}
): string[] {
  const snapshotAbs = path.join(projectDir, DESIGN_SNAPSHOT_DIR);
  const tmpAbs = `${snapshotAbs}.tmp`;
  rmSync(tmpAbs, { recursive: true, force: true });
  const written: string[] = [];
  for (const { dir, paths } of saved) {
    for (const p of paths) {
      assertSafeArtifactPath(p);
      const from = path.join(dir, p);
      try {
        if (!statSync(from).isFile()) continue;
      } catch {
        continue;
      }
      const to = path.join(tmpAbs, p);
      mkdirSync(path.dirname(to), { recursive: true });
      copyFileSync(from, to);
      if (!written.includes(p)) written.push(p);
    }
  }
  if (written.length === 0) {
    rmSync(tmpAbs, { recursive: true, force: true });
    throw new Error('No files were saved from the artifact');
  }
  rmSync(snapshotAbs, { recursive: true, force: true });
  renameSync(tmpAbs, snapshotAbs);
  updateDesignConfig(projectDir, {
    syncedAt: (meta.now ?? new Date()).toISOString(),
    ...(meta.version ? { syncedVersion: meta.version } : {}),
  });
  return written.sort();
}
