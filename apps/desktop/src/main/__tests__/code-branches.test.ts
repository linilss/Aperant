import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../cli-tool-manager', () => ({
  getToolPath: () => 'git',
}));

import { computeBranchStatus, findCodeBranches } from '../code-branches';
import { recordDocsOptimized } from '../claude-docs';
import { getIsolatedGitEnv } from '../utils/git-isolation';
import type { ProjectIndex } from '../../shared/types/project';

function git(cwd: string, args: string[], env: Record<string, string> = {}): string {
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...getIsolatedGitEnv(), ...env },
  }).trim();
}

describe('findCodeBranches', () => {
  let root: string;

  const write = (rel: string, content = 'export {};\n') => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  };
  const files = (dir: string, n: number, ext = 'ts') => {
    for (let i = 0; i < n; i++) write(`${dir}/f${i}.${ext}`);
  };
  const byPath = async (index: ProjectIndex | null = null) =>
    Object.fromEntries((await findCodeBranches(root, index)).map((b) => [b.relativePath, b]));

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'code-branches-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('always includes the root and picks directories with >= 5 owned source files', async () => {
    files('src/main', 6);
    files('src/renderer', 4);
    write('src/index.ts');
    write('README.md', '# readme\n');

    const branches = await findCodeBranches(root, null);

    expect(branches.map((b) => b.relativePath)).toEqual(['', 'src', 'src/main']);
    const map = Object.fromEntries(branches.map((b) => [b.relativePath, b]));
    // src owns its own file + renderer's 4 (renderer is not a branch); main is excluded
    expect(map.src.sourceFileCount).toBe(5);
    expect(map['src/main'].sourceFileCount).toBe(6);
    expect(map[''].sourceFileCount).toBe(0);
  });

  it('counts deep files towards the nearest branch within max depth 4', async () => {
    files('a/b/c/d/e/f', 5);

    const map = await byPath();

    expect(Object.keys(map)).toEqual(['', 'a/b/c/d/e/f']);
    expect(map['a/b/c/d/e/f'].sourceFileCount).toBe(5);
  });

  it('stops at depth 4 when the deeper directory has its own files', async () => {
    files('a/b/c/d/e', 3);
    files('a/b/c/d/e/f', 3);
    write('a/b/c/d/notes.md', 'x');

    const map = await byPath();

    // d (depth 4) owns e + f: 6 files; e and f are deeper than 4 and never branches
    expect(Object.keys(map)).toEqual(['', 'a/b/c/d']);
    expect(map['a/b/c/d'].sourceFileCount).toBe(6);
  });

  it('collapses single-child chains to the deepest meaningful node', async () => {
    files('packages/core/src/lib', 6);
    write('packages/core/package.json', '{}');

    const index = {
      project_root: root,
      project_type: 'monorepo',
      services: {
        wrapper: { name: 'wrapper', path: path.join(root, 'apps/wrapper') },
      },
      infrastructure: {},
      conventions: {},
    } as unknown as ProjectIndex;
    files('apps/wrapper/inner/src', 2);
    write('apps/wrapper/inner/README.md', 'x');

    const map = await byPath(index);

    // service root apps/wrapper only contains `inner/` → collapsed to apps/wrapper/inner
    expect(Object.keys(map)).toEqual(['', 'apps/wrapper/inner', 'packages/core/src/lib']);
  });

  it('measures max depth from the nearest service root', async () => {
    files('apps/web/src/main/ai/runners', 5);
    files('apps/web/src/main/ai', 5);
    write('apps/web/src/main/README.md', 'x');
    write('apps/web/package.json', '{}');
    const index = {
      project_root: root,
      project_type: 'monorepo',
      services: { web: { name: 'web', path: path.join(root, 'apps/web') } },
      infrastructure: {},
      conventions: {},
    } as unknown as ProjectIndex;

    // Without the service root, depth 4 stops at apps/web/src/main
    expect(Object.keys(await byPath())).toEqual(['', 'apps/web/src/main']);
    // With it, apps/web/src/main/ai/runners is depth 4 below the service
    expect(Object.keys(await byPath(index))).toEqual(['', 'apps/web', 'apps/web/src/main/ai', 'apps/web/src/main/ai/runners']);
  });

  it('includes service roots even with few source files', async () => {
    write('services/api/main.py', 'print(1)\n');
    write('services/api/requirements.txt', 'x');
    const index = {
      project_root: root,
      project_type: 'monorepo',
      services: { api: { name: 'api', path: path.join(root, 'services/api') }, gone: { name: 'gone', path: '/elsewhere' } },
      infrastructure: {},
      conventions: {},
    } as unknown as ProjectIndex;

    const map = await byPath(index);

    expect(Object.keys(map)).toEqual(['', 'services/api']);
    expect(map['services/api'].sourceFileCount).toBe(1);
  });

  it('splits out a deep directory once it owns 15+ source files', async () => {
    files('a/b/c/d', 5);
    files('a/b/c/d/big', 15);
    files('a/b/c/d/small', 6);

    const branches = await byPath();

    expect(branches['a/b/c/d/big']?.sourceFileCount).toBe(15);
    expect(branches['a/b/c/d/small']).toBeUndefined();
    expect(branches['a/b/c/d'].sourceFileCount).toBe(11);
  });

  it('folds test folders into the enclosing branch', async () => {
    files('src/core', 5);
    files('src/core/__tests__', 6);
    files('src/core/__tests__/integration', 6);
    files('tests', 7);

    const branches = await byPath();

    expect(Object.keys(branches).sort()).toEqual(['', 'src/core']);
    expect(branches['src/core'].sourceFileCount).toBe(17);
  });

  it('recognises Swift/.NET style test folders', async () => {
    files('Kit/Sources/Kit', 6);
    files('Kit/Tests/KitTests', 11);
    files('App.UnitTests', 8);
    files('Latest', 6);

    const branches = await byPath();

    // KitTests folds into Kit, which then owns enough files to be a branch itself
    expect(Object.keys(branches).sort()).toEqual(['', 'Kit', 'Kit/Sources/Kit', 'Latest']);
    expect(branches.Kit.sourceFileCount).toBe(11);
  });

  it('skips hidden, dependency and build folders', async () => {
    for (const dir of ['.git/x', '.malvy/worktrees/t', 'node_modules/p', 'worktrees/w', 'dist', 'build', 'out', 'bin', 'obj', 'vendor', 'Pods', '.hidden']) {
      files(dir, 6);
    }

    expect(Object.keys(await byPath())).toEqual(['']);
  });

  it('reports team docs, Malvy doc lines and status', async () => {
    files('src/main', 5);
    files('src/team', 5);
    files('src/big', 5);
    write('src/team/CLAUDE.md', '# Team\n');
    write('.malvy/docs/src/main/CLAUDE.md', '# Main\nline\n');
    write('.malvy/docs/src/big/CLAUDE.md', `${'x\n'.repeat(61)}`);

    const map = await byPath();

    expect(map['src/team']).toMatchObject({ hasTeamDoc: true, malvyDocLines: null, status: 'team' });
    expect(map['src/main']).toMatchObject({ hasTeamDoc: false, malvyDocLines: 2, status: 'documented' });
    expect(map['src/big'].status).toBe('over_budget');
    expect(map['']).toMatchObject({ status: 'missing', lastCommitAt: null });
  });

  it('marks a branch stale when it was committed after it was optimized', async () => {
    git(root, ['init', '-q']);
    writeFileSync(path.join(root, '.git/info/exclude'), '.malvy/\n');
    files('src/a', 5);
    files('src/b', 5);
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'init'], {
      GIT_AUTHOR_DATE: '2024-01-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2024-01-01T00:00:00Z',
    });
    recordDocsOptimized(root, ['src/a', 'src/b'], '2024-06-01T00:00:00.000Z');
    write('src/a/new.ts');
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'change a'], {
      GIT_AUTHOR_DATE: '2024-07-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2024-07-01T00:00:00Z',
    });

    const map = await byPath();

    expect(map['src/a'].status).toBe('stale');
    expect(Date.parse(map['src/a'].lastCommitAt ?? '')).toBe(Date.parse('2024-07-01T00:00:00Z'));
    expect(map['src/b'].status).toBe('documented');
    expect(Date.parse(map['src/b'].lastCommitAt ?? '')).toBe(Date.parse('2024-01-01T00:00:00Z'));
    expect(map['src/b'].docOptimizedAt).toBe('2024-06-01T00:00:00.000Z');
    // The root excludes its child branches and owns no tracked files
    expect(map[''].lastCommitAt).toBeNull();
  });
});

describe('computeBranchStatus', () => {
  const base = { relativePath: 'src', hasTeamDoc: false, malvyDocLines: null, lastCommitAt: null, docOptimizedAt: null };

  it('uses the 100-line budget for the root and 60 elsewhere', () => {
    expect(computeBranchStatus({ ...base, malvyDocLines: 61 })).toBe('over_budget');
    expect(computeBranchStatus({ ...base, relativePath: '', malvyDocLines: 61 })).toBe('documented');
    expect(computeBranchStatus({ ...base, relativePath: '', malvyDocLines: 101 })).toBe('over_budget');
  });

  it('treats a reviewed (skipped) branch without docs as documented', () => {
    expect(computeBranchStatus({ ...base, docOptimizedAt: '2024-01-01T00:00:00Z' })).toBe('documented');
  });
});
