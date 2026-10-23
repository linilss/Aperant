/**
 * Tests for ensureGitExcludeEntries — Malvy must exclude its files via the
 * untracked <git-dir>/info/exclude and never modify tracked files.
 */
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../cli-tool-manager', () => ({
  getToolPath: () => 'git',
}));

import { ensureGitExcludeEntries, GIT_EXCLUDE_HEADER, MALVY_GIT_EXCLUDE_ENTRIES } from '../git-exclude';
import { getIsolatedGitEnv } from '../utils/git-isolation';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: getIsolatedGitEnv(),
  }).trim();
}

function readExclude(repo: string): string {
  return readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf-8');
}

describe('ensureGitExcludeEntries', () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(path.join(os.tmpdir(), 'malvy-git-exclude-'));
    git(repo, ['init', '-q']);
    writeFileSync(path.join(repo, 'README.md'), '# test\n');
    writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'init']);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('writes the entries to .git/info/exclude with a single header', () => {
    const added = ensureGitExcludeEntries(repo, MALVY_GIT_EXCLUDE_ENTRIES);

    expect(added).toEqual(['.malvy/', 'CLAUDE.local.md']);
    const content = readExclude(repo);
    expect(content).toContain(`${GIT_EXCLUDE_HEADER}\n.malvy/\nCLAUDE.local.md\n`);
    expect(content.endsWith('\n')).toBe(true);
  });

  it('is idempotent', () => {
    ensureGitExcludeEntries(repo, MALVY_GIT_EXCLUDE_ENTRIES);
    const first = readExclude(repo);

    const added = ensureGitExcludeEntries(repo, MALVY_GIT_EXCLUDE_ENTRIES);

    expect(added).toEqual([]);
    expect(readExclude(repo)).toBe(first);
    expect(first.split(GIT_EXCLUDE_HEADER).length - 1).toBe(1);
  });

  it('only appends missing entries and does not repeat the header', () => {
    ensureGitExcludeEntries(repo, ['.malvy/']);
    const added = ensureGitExcludeEntries(repo, ['.malvy', 'CLAUDE.local.md']);

    expect(added).toEqual(['CLAUDE.local.md']);
    const content = readExclude(repo);
    expect(content.split(GIT_EXCLUDE_HEADER).length - 1).toBe(1);
    expect(content.match(/^\.malvy\/$/gm)).toHaveLength(1);
  });

  it('adds a newline before appending to a file without trailing newline', () => {
    writeFileSync(path.join(repo, '.git', 'info', 'exclude'), '*.log');

    ensureGitExcludeEntries(repo, ['.malvy/']);

    expect(readExclude(repo)).toBe(`*.log\n${GIT_EXCLUDE_HEADER}\n.malvy/\n`);
  });

  it('creates the info directory when missing', () => {
    rmSync(path.join(repo, '.git', 'info'), { recursive: true, force: true });

    ensureGitExcludeEntries(repo, ['.malvy/']);

    expect(readExclude(repo)).toBe(`${GIT_EXCLUDE_HEADER}\n.malvy/\n`);
  });

  it('never touches .gitignore', () => {
    ensureGitExcludeEntries(repo, MALVY_GIT_EXCLUDE_ENTRIES);

    expect(readFileSync(path.join(repo, '.gitignore'), 'utf-8')).toBe('node_modules/\n');
  });

  it('leaves git status clean after adding Malvy files', () => {
    ensureGitExcludeEntries(repo, MALVY_GIT_EXCLUDE_ENTRIES);
    mkdirSync(path.join(repo, '.malvy', 'specs'), { recursive: true });
    writeFileSync(path.join(repo, '.malvy', 'specs', '.gitkeep'), '');
    writeFileSync(path.join(repo, 'CLAUDE.local.md'), 'local notes\n');

    expect(git(repo, ['status', '--porcelain'])).toBe('');
  });

  it('writes to the shared exclude file when called from a linked worktree', () => {
    const worktree = path.join(repo, '.malvy', 'worktrees', 'tasks', '001-test');
    git(repo, ['worktree', 'add', '-q', '-b', 'malvy/001-test', worktree]);

    ensureGitExcludeEntries(worktree, ['.malvy/']);

    expect(readExclude(repo)).toContain('.malvy/\n');
    expect(existsSync(path.join(repo, '.git', 'worktrees', '001-test', 'info', 'exclude'))).toBe(false);
  });
});
