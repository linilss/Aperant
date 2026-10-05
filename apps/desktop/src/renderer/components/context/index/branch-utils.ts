import type { ClaudeDocFile, CodeBranch, DocPointer } from '../../../../shared/types';

const MALVY_DOCS_PREFIX = '.malvy/docs/';

/** Directory (code branch path) of a doc file path; `''` for root docs */
export function docDirectory(docPath: string): string {
  const rel = docPath.startsWith(MALVY_DOCS_PREFIX) ? docPath.slice(MALVY_DOCS_PREFIX.length) : docPath;
  const idx = rel.lastIndexOf('/');
  return idx === -1 ? '' : rel.slice(0, idx);
}

/** Pointers anchored to a doc (team or Malvy layer) in exactly this branch directory */
export function pointerCountForBranch(branch: string, pointers: DocPointer[]): number {
  return pointers.filter((p) => p.docPath && docDirectory(p.docPath) === branch).length;
}

/** Doc to open for a branch: the Malvy doc when present, otherwise a team doc */
export function docPathForBranch(branch: CodeBranch, docs: ClaudeDocFile[]): string | null {
  const inDir = docs.filter((d) => docDirectory(d.relativePath) === branch.relativePath);
  return (inDir.find((d) => d.layer === 'malvy') ?? inDir.find((d) => d.layer === 'team'))?.relativePath ?? null;
}

/** Nearest enclosing branch path of `path` among `branches` (not the root), or null */
export function parentBranchPath(path: string, branches: CodeBranch[]): string | null {
  let best: string | null = null;
  for (const b of branches) {
    const p = b.relativePath;
    if (p && p !== path && path.startsWith(`${p}/`) && (best === null || p.length > best.length)) best = p;
  }
  return best;
}

/** Deepest non-root branch containing a project-relative path (e.g. a key module), or null */
export function branchForPath(path: string, branches: CodeBranch[]): string | null {
  const clean = path.replace(/^\.\//, '').replace(/\/+$/, '');
  if (branches.some((b) => b.relativePath && b.relativePath === clean)) return clean;
  return parentBranchPath(clean, branches);
}

export interface BranchRow {
  branch: CodeBranch;
  /** Nesting level in the branch tree (root = 0) */
  depth: number;
  /** Path relative to the parent branch */
  label: string;
}

/** Branches as an indented tree (root first, children under their nearest parent branch) */
export function buildBranchRows(branches: CodeBranch[]): BranchRow[] {
  const rows: BranchRow[] = [];
  const children = new Map<string, CodeBranch[]>();
  const root = branches.find((b) => b.relativePath === '');
  for (const b of branches) {
    if (b.relativePath === '') continue;
    const parent = parentBranchPath(b.relativePath, branches) ?? '';
    children.set(parent, [...(children.get(parent) ?? []), b]);
  }
  const visit = (parent: string, depth: number) => {
    const items = (children.get(parent) ?? []).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    for (const b of items) {
      rows.push({ branch: b, depth, label: parent ? b.relativePath.slice(parent.length + 1) : b.relativePath });
      visit(b.relativePath, depth + 1);
    }
  };
  if (root) rows.push({ branch: root, depth: 0, label: '' });
  visit('', root ? 1 : 0);
  return rows;
}

/** Branches with any documentation (team or Malvy) or already reviewed by the optimizer */
export function documentedCount(branches: CodeBranch[]): number {
  return branches.filter((b) => b.status !== 'missing').length;
}
