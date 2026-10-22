/**
 * AI conflict resolution against real git repos: every conflicted file is either resolved
 * and staged or reported back with a reason, and nothing silently stays unmerged.
 */
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../cli-tool-manager', () => ({ getToolPath: () => 'git' }));
vi.mock('../../../app-logger', () => ({ appLog: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../../ai/runners/merge-resolver', () => ({ resolveMergeConflict: vi.fn() }));

import {
  UnresolvedConflictsError,
  assertAllConflictsResolved,
  conflictFailureMessage,
  isGeneratedArtifact,
  listUnmergedFiles,
  resolveAllConflictsOrThrow,
  resolveGitConflictsWithAI
} from '../git-conflict-resolution';
import type { resolveMergeConflict } from '../../../ai/runners/merge-resolver';

let repo: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function write(rel: string, content: string | Buffer): void {
  mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  writeFileSync(path.join(repo, rel), content);
}

function commitAll(msg: string): void {
  git('add', '-A');
  git('commit', '-q', '-m', msg);
}

/** main and feature both change `files`; leaves the repo mid-merge of feature into main. */
function conflict(files: Record<string, [string | Buffer, string | Buffer, string | Buffer]>): void {
  for (const [rel, [base]] of Object.entries(files)) write(rel, base);
  commitAll('base');
  git('checkout', '-q', '-b', 'feature');
  for (const [rel, [, , theirs]] of Object.entries(files)) write(rel, theirs);
  commitAll('feature');
  git('checkout', '-q', 'main');
  for (const [rel, [, ours]] of Object.entries(files)) write(rel, ours);
  commitAll('main');
  expect(() => git('merge', '--no-ff', '--no-commit', 'feature')).toThrow();
}

const ok = (text: string) => vi.fn<typeof resolveMergeConflict>().mockResolvedValue({ success: true, text });

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'conflict-res-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  git('config', 'commit.gpgsign', 'false');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('isGeneratedArtifact', () => {
  it('matches cache and build output', () => {
    expect(isGeneratedArtifact('src/__pycache__/x.cpython-312.pyc')).toBe(true);
    expect(isGeneratedArtifact('tools/x.pyc')).toBe(true);
    expect(isGeneratedArtifact('App/bin/Debug/App.dll')).toBe(true);
    expect(isGeneratedArtifact('App/obj/project.assets.json')).toBe(true);
    expect(isGeneratedArtifact('.DS_Store')).toBe(true);
  });

  it('does not match source files', () => {
    expect(isGeneratedArtifact('src/binary.ts')).toBe(false);
    expect(isGeneratedArtifact('logo.png')).toBe(false);
    expect(isGeneratedArtifact('objects/x.ts')).toBe(false);
  });
});

describe('resolveGitConflictsWithAI', () => {
  it('writes and stages the AI resolution', async () => {
    conflict({ 'a.txt': ['base\n', 'ours\n', 'theirs\n'] });
    const resolve = ok('ours and theirs');

    const unresolved = await resolveGitConflictsWithAI(repo, repo, { targetSide: 'ours', resolve });

    expect(unresolved).toEqual([]);
    expect(listUnmergedFiles(repo)).toEqual([]);
    expect(readFileSync(path.join(repo, 'a.txt'), 'utf-8')).toBe('ours and theirs\n');
  });

  it('reports the AI error (e.g. expired login) and leaves the file unmerged', async () => {
    conflict({ 'a.txt': ['base\n', 'ours\n', 'theirs\n'] });
    const resolve = vi.fn<typeof resolveMergeConflict>().mockResolvedValue({
      success: false,
      text: '',
      error: 'Refresh token expired'
    });

    const unresolved = await resolveGitConflictsWithAI(repo, repo, { targetSide: 'ours', resolve });

    expect(unresolved).toEqual([{ file: 'a.txt', reason: 'AI resolution failed: Refresh token expired' }]);
    expect(listUnmergedFiles(repo)).toEqual(['a.txt']);
  });

  it('rejects an answer that still has conflict markers', async () => {
    conflict({ 'a.txt': ['base\n', 'ours\n', 'theirs\n'] });
    const resolve = ok('<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> feature');

    const unresolved = await resolveGitConflictsWithAI(repo, repo, { targetSide: 'ours', resolve });

    expect(unresolved[0].reason).toMatch(/conflict markers/);
    expect(listUnmergedFiles(repo)).toEqual(['a.txt']);
  });

  it('takes the target side for generated binaries, without asking the AI', async () => {
    const bin = (s: string) => Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(s)]);
    conflict({ 'pkg/__pycache__/m.cpython-312.pyc': [bin('base'), bin('main'), bin('feature')] });
    const resolve = ok('unused');

    const unresolved = await resolveGitConflictsWithAI(repo, repo, { targetSide: 'ours', resolve });

    expect(unresolved).toEqual([]);
    expect(resolve).not.toHaveBeenCalled();
    expect(readFileSync(path.join(repo, 'pkg/__pycache__/m.cpython-312.pyc'))).toEqual(bin('main'));
  });

  it('takes "theirs" when the target is the branch being merged in', async () => {
    const bin = (s: string) => Buffer.concat([Buffer.from([0]), Buffer.from(s)]);
    conflict({ 'App/obj/App.dll': [bin('base'), bin('main'), bin('feature')] });

    await resolveGitConflictsWithAI(repo, repo, { targetSide: 'theirs', resolve: ok('unused') });

    expect(readFileSync(path.join(repo, 'App/obj/App.dll'))).toEqual(bin('feature'));
  });

  it('reports other binary files as unresolvable', async () => {
    const bin = (s: string) => Buffer.concat([Buffer.from([0]), Buffer.from(s)]);
    conflict({ 'logo.png': [bin('base'), bin('main'), bin('feature')] });
    const resolve = ok('unused');

    const unresolved = await resolveGitConflictsWithAI(repo, repo, { targetSide: 'ours', resolve });

    expect(unresolved).toEqual([{ file: 'logo.png', reason: 'binary file, cannot be merged automatically' }]);
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe('assertAllConflictsResolved / resolveAllConflictsOrThrow', () => {
  it('throws a message naming each file and its reason', async () => {
    const bin = (s: string) => Buffer.concat([Buffer.from([0]), Buffer.from(s)]);
    conflict({ 'a.txt': ['base\n', 'ours\n', 'theirs\n'], 'logo.png': [bin('b'), bin('m'), bin('f')] });
    const resolve = vi.fn<typeof resolveMergeConflict>().mockResolvedValue({ success: false, text: '', error: 'Empty response from AI' });

    const err = await resolveAllConflictsOrThrow(repo, repo, { targetSide: 'ours', resolve }).catch((e) => e);

    expect(err).toBeInstanceOf(UnresolvedConflictsError);
    expect(err.message).toContain('a.txt (AI resolution failed: Empty response from AI)');
    expect(err.message).toContain('logo.png (binary file');
    expect(conflictFailureMessage(err)).toMatch(/^Conflicts could not be resolved automatically in: /);
  });

  it('passes when nothing is unmerged', () => {
    write('a.txt', 'x');
    commitAll('init');
    expect(() => assertAllConflictsResolved(repo, [])).not.toThrow();
  });
});
