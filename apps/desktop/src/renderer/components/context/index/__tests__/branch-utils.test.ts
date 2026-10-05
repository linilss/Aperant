import { describe, expect, it } from 'vitest';
import type { ClaudeDocFile, CodeBranch, DocPointer } from '../../../../../shared/types';
import {
  branchForPath,
  buildBranchRows,
  docPathForBranch,
  documentedCount,
  pointerCountForBranch,
} from '../branch-utils';

const branch = (relativePath: string, status: CodeBranch['status'] = 'missing'): CodeBranch => ({
  relativePath,
  sourceFileCount: 5,
  hasTeamDoc: false,
  malvyDocLines: null,
  lastCommitAt: null,
  docOptimizedAt: null,
  status,
});

const branches = [branch(''), branch('src/main', 'documented'), branch('src/main/ai', 'team'), branch('src/renderer')];

describe('branch-utils', () => {
  it('builds an indented tree under the nearest parent branch', () => {
    expect(buildBranchRows(branches).map((r) => [r.branch.relativePath, r.depth, r.label])).toEqual([
      ['', 0, ''],
      ['src/main', 1, 'src/main'],
      ['src/main/ai', 2, 'ai'],
      ['src/renderer', 1, 'src/renderer'],
    ]);
  });

  it('links key module paths to the deepest containing branch', () => {
    expect(branchForPath('src/main/ai/runners', branches)).toBe('src/main/ai');
    expect(branchForPath('./src/main/', branches)).toBe('src/main');
    expect(branchForPath('package.json', branches)).toBeNull();
  });

  it('counts pointers anchored to docs in exactly the branch directory', () => {
    const p = (docPath?: string): DocPointer => ({ id: docPath ?? 'g', content: '', docPath, createdAt: '' });
    const pointers = [p('src/main/CLAUDE.md'), p('.malvy/docs/src/main/CLAUDE.md'), p('src/main/ai/CLAUDE.md'), p()];
    expect(pointerCountForBranch('src/main', pointers)).toBe(2);
    expect(pointerCountForBranch('', pointers)).toBe(0);
  });

  it('opens the Malvy doc before the team doc', () => {
    const doc = (relativePath: string, layer: ClaudeDocFile['layer']): ClaudeDocFile => ({
      relativePath,
      layerPath: relativePath.replace('.malvy/docs/', ''),
      layer,
      lines: 1,
      firstLine: '',
    });
    const docs = [doc('src/main/CLAUDE.md', 'team'), doc('.malvy/docs/src/main/CLAUDE.md', 'malvy')];
    expect(docPathForBranch(branches[1], docs)).toBe('.malvy/docs/src/main/CLAUDE.md');
    expect(docPathForBranch(branches[1], docs.slice(0, 1))).toBe('src/main/CLAUDE.md');
    expect(docPathForBranch(branches[3], docs)).toBeNull();
  });

  it('counts every non-missing branch as documented', () => {
    expect(documentedCount(branches)).toBe(2);
  });
});
