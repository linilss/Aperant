/**
 * Code branch discovery for the Context hub.
 *
 * A "code branch" is a directory that deserves its own CLAUDE.md: the project
 * root, every service root from the project index, and every directory (max
 * depth 4 below the project root or its service root) holding at least 5
 * source files that are not already owned by a deeper branch. Single-child
 * directory chains collapse to their deepest node.
 *
 * Each branch is annotated with its documentation status from both doc layers,
 * `.malvy/docs/.meta.json` and one `git log` call (tolerates non-git projects).
 */

import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { CodeBranch, CodeBranchStatus } from '../shared/types/claude-docs';
import type { ProjectIndex } from '../shared/types/project';
import {
  branchDocPath,
  countLines,
  MALVY_DOCS_DIR,
  NESTED_DOC_LINE_LIMIT,
  readDocsMeta,
  ROOT_DOC_LINE_LIMIT,
  TEAM_DOC_PATTERN,
} from './claude-docs';
import { getToolPath } from './cli-tool-manager';
import { getIsolatedGitEnv } from './utils/git-isolation';

const execFileAsync = promisify(execFile);

export const MAX_BRANCH_DEPTH = 4;
export const MIN_BRANCH_SOURCE_FILES = 5;
/** Beyond MAX_BRANCH_DEPTH, a directory still becomes its own branch when it owns this many source files */
export const DEEP_BRANCH_MIN_SOURCE_FILES = 15;
/** How deep files are still counted towards their ancestor branch */
const MAX_SCAN_DEPTH = 12;
/** Upper bound on directories read per scan */
const MAX_SCANNED_DIRS = 5000;
const GIT_CONCURRENCY = 4;
const GIT_TIMEOUT_MS = 10_000;

const IGNORED_DIRS = new Set([
  'node_modules',
  'worktrees',
  'dist',
  'build',
  'out',
  'bin',
  'obj',
  'vendor',
  'Pods',
  'target',
  'coverage',
  '__pycache__',
]);

/** Test/fixture folders never become branches; their files count toward the enclosing branch */
const TEST_DIRS = new Set([
  '__tests__', '__mocks__', '__snapshots__', '__fixtures__', 'test', 'tests', 'spec', 'specs',
  'fixtures', 'mocks', 'e2e',
]);

// Swift/.NET/JVM style: `TrainrKitTests`, `App.UnitTests`, `FooTest`
// a separator before "test(s)", or a camel-case "Test(s)" word at the end (not `Latest`)
const TEST_DIR_SEPARATED = /[.\-_]tests?$/i;
const TEST_DIR_CAMEL = /[a-z0-9]Tests?$/;

function isInTestDir(rel: string): boolean {
  return rel
    .split('/')
    .some(
      (segment) =>
        TEST_DIRS.has(segment.toLowerCase()) || TEST_DIR_SEPARATED.test(segment) || TEST_DIR_CAMEL.test(segment)
    );
}

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.astro',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.kts', '.scala', '.groovy',
  '.swift', '.m', '.mm', '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.fs', '.vb',
  '.php', '.ex', '.exs', '.erl', '.hs', '.clj', '.lua', '.dart', '.elm', '.ml',
  '.r', '.jl', '.zig', '.nim', '.sql', '.sh', '.ps1',
]);

interface DirNode {
  rel: string;
  depth: number;
  /** Source files directly in this directory */
  directSource: number;
  /** Non-hidden files of any kind directly in this directory */
  fileCount: number;
  hasTeamDoc: boolean;
  children: DirNode[];
}

export function isSourceFile(name: string): boolean {
  return SOURCE_EXTENSIONS.has(path.extname(name).toLowerCase());
}

async function scanDir(root: string, rel: string, depth: number, budget: { dirs: number }): Promise<DirNode> {
  const node: DirNode = { rel, depth, directSource: 0, fileCount: 0, hasTeamDoc: false, children: [] };
  budget.dirs--;
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(path.join(root, rel), { withFileTypes: true });
  } catch {
    return node;
  }

  const subdirs: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isFile()) {
      node.fileCount++;
      if (isSourceFile(entry.name)) node.directSource++;
      if (TEAM_DOC_PATTERN.test(entry.name)) node.hasTeamDoc = true;
    } else if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name)) {
      subdirs.push(entry.name);
    }
  }

  if (depth < MAX_SCAN_DEPTH) {
    for (const name of subdirs.sort()) {
      if (budget.dirs <= 0) break;
      node.children.push(await scanDir(root, rel ? `${rel}/${name}` : name, depth + 1, budget));
    }
  }
  return node;
}

/**
 * Bottom-up: a directory is a branch when it owns enough source files not
 * claimed by a deeper branch. Depth is measured from the nearest service root
 * (or the project root), so monorepo services can be split like single repos.
 */
function selectBranches(node: DirNode, forced: Set<string>, branches: Set<string>, baseDepth = 0): number {
  const isForced = node.rel === '' || forced.has(node.rel);
  const base = isForced ? node.depth : baseDepth;
  let own = node.directSource;
  for (const child of node.children) own += selectBranches(child, forced, branches, base);
  const isBranch =
    isForced ||
    (!isInTestDir(node.rel) &&
      own >= (node.depth - base <= MAX_BRANCH_DEPTH ? MIN_BRANCH_SOURCE_FILES : DEEP_BRANCH_MIN_SOURCE_FILES));
  if (isBranch) {
    branches.add(node.rel);
    return 0;
  }
  return own;
}

/** Move a branch down a chain of directories that contain nothing but the next directory */
function collapseChains(node: DirNode, branches: Set<string>): void {
  for (const child of node.children) collapseChains(child, branches);
  if (node.rel === '' || !branches.has(node.rel)) return;
  let deepest = node;
  while (deepest.fileCount === 0 && deepest.children.length === 1) deepest = deepest.children[0];
  if (deepest !== node) {
    branches.delete(node.rel);
    branches.add(deepest.rel);
  }
}

/** Source files owned by each branch (stopping at child branches) */
function countOwned(node: DirNode, branches: Set<string>, counts: Map<string, number>): number {
  let own = node.directSource;
  for (const child of node.children) own += countOwned(child, branches, counts);
  if (branches.has(node.rel)) {
    counts.set(node.rel, own);
    return 0;
  }
  return own;
}

function indexNodes(node: DirNode, out: Map<string, DirNode>): Map<string, DirNode> {
  out.set(node.rel, node);
  for (const child of node.children) indexNodes(child, out);
  return out;
}

/** Service roots from the project index, relative to the project (POSIX) */
function serviceRoots(projectPath: string, projectIndex: ProjectIndex | null): Set<string> {
  const roots = new Set<string>();
  for (const service of Object.values(projectIndex?.services ?? {})) {
    if (!service?.path) continue;
    const rel = path.relative(projectPath, path.resolve(projectPath, service.path)).split(path.sep).join('/');
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
    roots.add(rel === '.' ? '' : rel);
  }
  return roots;
}

/** Nearest ancestor branch of a path (`''` when none) */
export function parentBranch(rel: string, branches: Iterable<string>): string | null {
  if (rel === '') return null;
  let best = '';
  for (const candidate of branches) {
    if (candidate && candidate !== rel && rel.startsWith(`${candidate}/`) && candidate.length > best.length) {
      best = candidate;
    }
  }
  return best;
}

export function computeBranchStatus(branch: {
  relativePath: string;
  hasTeamDoc: boolean;
  malvyDocLines: number | null;
  lastCommitAt: string | null;
  docOptimizedAt: string | null;
}): CodeBranchStatus {
  const limit = branch.relativePath === '' ? ROOT_DOC_LINE_LIMIT : NESTED_DOC_LINE_LIMIT;
  if (branch.malvyDocLines !== null && branch.malvyDocLines > limit) return 'over_budget';
  if (
    branch.docOptimizedAt &&
    branch.lastCommitAt &&
    Date.parse(branch.lastCommitAt) > Date.parse(branch.docOptimizedAt)
  ) {
    return 'stale';
  }
  if (branch.malvyDocLines !== null || branch.docOptimizedAt) return 'documented';
  if (branch.hasTeamDoc) return 'team';
  return 'missing';
}

async function git(projectPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(getToolPath('git'), args, {
    cwd: projectPath,
    env: getIsolatedGitEnv(),
    timeout: GIT_TIMEOUT_MS,
    encoding: 'utf-8',
  });
  return stdout.trim();
}

/** Last commit time for a branch, excluding its child branches */
async function lastCommitFor(projectPath: string, rel: string, childBranches: string[]): Promise<string | null> {
  const pathspecs = [rel || '.', ...childBranches.map((child) => `:(exclude)${child}`)];
  try {
    const out = await git(projectPath, ['log', '-1', '--format=%cI', '--', ...pathspecs]);
    return out || null;
  } catch {
    return null;
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Discover the project's code branches and their documentation status.
 * Sorted with the root first, then alphabetically by path.
 */
export async function findCodeBranches(projectPath: string, projectIndex: ProjectIndex | null): Promise<CodeBranch[]> {
  const tree = await scanDir(projectPath, '', 0, { dirs: MAX_SCANNED_DIRS });
  const nodes = indexNodes(tree, new Map());

  const forced = new Set([...serviceRoots(projectPath, projectIndex)].filter((rel) => nodes.has(rel)));
  const branchSet = new Set<string>();
  selectBranches(tree, forced, branchSet);
  collapseChains(tree, branchSet);

  const counts = new Map<string, number>();
  countOwned(tree, branchSet, counts);

  const paths = [...branchSet].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
  const meta = readDocsMeta(projectPath);

  let isGitRepo = false;
  try {
    isGitRepo = (await git(projectPath, ['rev-parse', '--is-inside-work-tree'])) === 'true';
  } catch {
    isGitRepo = false;
  }

  return mapLimit(paths, GIT_CONCURRENCY, async (rel): Promise<CodeBranch> => {
    const docContent = await readFile(path.join(projectPath, MALVY_DOCS_DIR, branchDocPath(rel)), 'utf-8').catch(
      () => null
    );
    const children = paths.filter((other) => parentBranch(other, paths) === rel && other !== rel);
    const branch = {
      relativePath: rel,
      sourceFileCount: counts.get(rel) ?? 0,
      hasTeamDoc: nodes.get(rel)?.hasTeamDoc ?? false,
      malvyDocLines: docContent === null ? null : countLines(docContent),
      lastCommitAt: isGitRepo ? await lastCommitFor(projectPath, rel, children) : null,
      docOptimizedAt: meta.branches[rel] ?? null,
    };
    return { ...branch, status: computeBranchStatus(branch) };
  });
}
