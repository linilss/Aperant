/**
 * CLAUDE.local.md gets Malvy's import lines idempotently, keeps user content,
 * and is git-excluded together with .malvy/ — without touching tracked files.
 */
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../cli-tool-manager', () => ({
  getToolPath: () => 'git',
}));

import { CLAUDE_LOCAL_IMPORTS, ensureClaudeLocalImports } from '../claude-local';
import { getIsolatedGitEnv } from '../utils/git-isolation';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: getIsolatedGitEnv(),
  }).trim();
}

describe('ensureClaudeLocalImports', () => {
  let repo: string;
  const localFile = () => path.join(repo, 'CLAUDE.local.md');

  beforeEach(() => {
    repo = mkdtempSync(path.join(os.tmpdir(), 'malvy-claude-local-'));
    git(repo, ['init', '-q']);
    writeFileSync(path.join(repo, 'CLAUDE.md'), '# Team\n');
    writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'init']);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('creates CLAUDE.local.md with the import lines and excludes it via info/exclude', () => {
    const added = ensureClaudeLocalImports(repo);

    expect(added).toEqual(CLAUDE_LOCAL_IMPORTS);
    expect(readFileSync(localFile(), 'utf-8')).toBe('@.malvy/docs/CLAUDE.md\n@.malvy/pointers.md\n');

    const exclude = readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf-8');
    expect(exclude).toContain('.malvy/');
    expect(exclude).toContain('CLAUDE.local.md');
    expect(readFileSync(path.join(repo, '.gitignore'), 'utf-8')).toBe('node_modules/\n');
    expect(git(repo, ['status', '--porcelain'])).toBe('');
  });

  it('is idempotent', () => {
    ensureClaudeLocalImports(repo);
    const first = readFileSync(localFile(), 'utf-8');
    const exclude = readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf-8');

    expect(ensureClaudeLocalImports(repo)).toEqual([]);
    expect(readFileSync(localFile(), 'utf-8')).toBe(first);
    expect(readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf-8')).toBe(exclude);
  });

  it('appends to an existing file without removing user content', () => {
    writeFileSync(localFile(), '# My notes\nKeep this\n@.malvy/pointers.md');

    const added = ensureClaudeLocalImports(repo);

    expect(added).toEqual(['@.malvy/docs/CLAUDE.md']);
    expect(readFileSync(localFile(), 'utf-8')).toBe(
      '# My notes\nKeep this\n@.malvy/pointers.md\n\n@.malvy/docs/CLAUDE.md\n'
    );
  });

  it('still writes the file outside a git repository', () => {
    const plain = mkdtempSync(path.join(os.tmpdir(), 'malvy-claude-local-plain-'));
    try {
      expect(ensureClaudeLocalImports(plain)).toEqual(CLAUDE_LOCAL_IMPORTS);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
