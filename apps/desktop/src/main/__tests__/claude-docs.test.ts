import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyDocProposals,
  branchOfDocPath,
  findClaudeDocs,
  isDocOverBudget,
  MALVY_POINTERS_FILE,
  readClaudeDoc,
  readDocsMeta,
  readProjectSummary,
  recordDocsOptimized,
  renderPointersMarkdown,
  resolveMalvyDocTarget,
  resolveMalvyRoot,
  writePointersFile,
} from '../claude-docs';
import type { DocPointer, DocProposal } from '../../shared/types/claude-docs';

describe('claude-docs', () => {
  let root: string;

  const write = (rel: string, content = '# Title\n') => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  };

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'claude-docs-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('findClaudeDocs', () => {
    it('finds team docs and .malvy/docs files, team first and root first', async () => {
      write('CLAUDE.md', '# Root\n\nline\n');
      write('AGENTS.md');
      write('src/main/CLAUDE.md', '\n\n## Main process\nmore\n');
      write('src/CLAUDE.md');
      write('.malvy/docs/CLAUDE.md', '# Malvy root\n');
      write('.malvy/docs/src/main/CLAUDE.md', '# Malvy main\n');

      const docs = await findClaudeDocs(root);

      expect(docs.map((d) => [d.layer, d.relativePath])).toEqual([
        ['team', 'AGENTS.md'],
        ['team', 'CLAUDE.md'],
        ['team', 'src/CLAUDE.md'],
        ['team', 'src/main/CLAUDE.md'],
        ['malvy', '.malvy/docs/CLAUDE.md'],
        ['malvy', '.malvy/docs/src/main/CLAUDE.md'],
      ]);
      const main = docs.find((d) => d.relativePath === 'src/main/CLAUDE.md')!;
      expect(main.firstLine).toBe('Main process');
      expect(main.lines).toBe(4);
      expect(docs.find((d) => d.relativePath === '.malvy/docs/src/main/CLAUDE.md')!.layerPath).toBe(
        'src/main/CLAUDE.md'
      );
    });

    it('skips .git, node_modules, worktrees, build output, other .malvy content and deep folders', async () => {
      write('.git/CLAUDE.md');
      write('node_modules/pkg/CLAUDE.md');
      write('worktrees/x/CLAUDE.md');
      write('.malvy/worktrees/tasks/001/CLAUDE.md');
      write('.malvy/specs/CLAUDE.md');
      write('dist/CLAUDE.md');
      write('build/CLAUDE.md');
      write('out/CLAUDE.md');
      write('a/b/c/d/e/f/g/CLAUDE.md');
      write('a/b/c/d/e/f/CLAUDE.md');
      write('CLAUDE.local.md');
      write('.malvy/docs/README.md');

      const docs = await findClaudeDocs(root);

      expect(docs.map((d) => d.relativePath)).toEqual(['a/b/c/d/e/f/CLAUDE.md']);
    });

    it('flags docs over their line budget', () => {
      expect(isDocOverBudget({ layerPath: 'CLAUDE.md', lines: 100 })).toBe(false);
      expect(isDocOverBudget({ layerPath: 'CLAUDE.md', lines: 101 })).toBe(true);
      expect(isDocOverBudget({ layerPath: 'src/CLAUDE.md', lines: 61 })).toBe(true);
    });
  });

  describe('readClaudeDoc', () => {
    it('reads doc files but refuses other files and traversal', async () => {
      write('src/CLAUDE.md', 'hello');
      write('secret.txt', 'nope');

      await expect(readClaudeDoc(root, 'src/CLAUDE.md')).resolves.toBe('hello');
      await expect(readClaudeDoc(root, 'secret.txt')).rejects.toThrow();
      await expect(readClaudeDoc(root, '../CLAUDE.md')).rejects.toThrow();
    });
  });

  describe('resolveMalvyRoot', () => {
    it('maps a task worktree back to its owning project', () => {
      const project = path.join(root, 'proj');
      expect(resolveMalvyRoot(path.join(project, '.malvy', 'worktrees', 'tasks', '001-x'))).toBe(project);
      expect(resolveMalvyRoot(project)).toBe(project);
    });
  });

  describe('apply proposals', () => {
    const proposal = (p: Partial<DocProposal>): DocProposal => ({
      path: 'CLAUDE.md',
      action: 'create',
      content: '# Doc',
      reason: '',
      appliedPointerIds: [],
      ...p,
    });

    it.each([
      '../CLAUDE.md',
      '../../etc/CLAUDE.md',
      'src/../../CLAUDE.md',
      '/etc/CLAUDE.md',
      'src/README.md',
      'src/claude.md',
      'CLAUDE.md.bak',
      'src/project_summary.json',
      '../project_summary.json',
      '/tmp/project_summary.json',
      'project_summary.json.bak',
      '',
    ])('rejects %j', (p) => {
      expect(() => resolveMalvyDocTarget(root, p)).toThrow();
    });

    it('accepts paths relative to .malvy/docs (and tolerates the prefix)', () => {
      const docsRoot = path.join(root, '.malvy', 'docs');
      expect(resolveMalvyDocTarget(root, 'src/main/CLAUDE.md')).toBe(path.join(docsRoot, 'src', 'main', 'CLAUDE.md'));
      expect(resolveMalvyDocTarget(root, '.malvy/docs/CLAUDE.md')).toBe(path.join(docsRoot, 'CLAUDE.md'));
    });

    it('writes only under .malvy/docs, reports invalid paths and records the optimization time', () => {
      write('CLAUDE.md', '# Team\n');
      write('.malvy/docs/old/CLAUDE.md', '# Old\n');

      const result = applyDocProposals(root, [
        proposal({ path: 'CLAUDE.md', content: '# Malvy root' }),
        proposal({ path: 'src/main/CLAUDE.md', action: 'update', content: '# Main\n' }),
        proposal({ path: 'old/CLAUDE.md', action: 'delete', content: '' }),
        proposal({ path: '../CLAUDE.md', content: 'overwrite team doc' }),
        proposal({ path: 'notes.md', content: 'x' }),
      ]);

      expect(result.applied.map((p) => p.path)).toEqual(['CLAUDE.md', 'src/main/CLAUDE.md', 'old/CLAUDE.md']);
      expect(result.errors.map((e) => e.path)).toEqual(['../CLAUDE.md', 'notes.md']);
      expect(readFileSync(path.join(root, 'CLAUDE.md'), 'utf-8')).toBe('# Team\n');
      expect(readFileSync(path.join(root, '.malvy/docs/CLAUDE.md'), 'utf-8')).toBe('# Malvy root\n');
      expect(readFileSync(path.join(root, '.malvy/docs/src/main/CLAUDE.md'), 'utf-8')).toBe('# Main\n');
      expect(existsSync(path.join(root, '.malvy/docs/old/CLAUDE.md'))).toBe(false);
      expect(existsSync(path.join(root, 'notes.md'))).toBe(false);
      expect(readDocsMeta(root).lastOptimizedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('does not touch .meta.json when nothing was applied', () => {
      applyDocProposals(root, [proposal({ path: '../CLAUDE.md' })]);
      expect(readDocsMeta(root).lastOptimizedAt).toBeNull();
    });

    it('records per-branch optimization times for applied docs and keeps other branches', () => {
      recordDocsOptimized(root, ['src/other'], '2024-01-01T00:00:00.000Z');

      applyDocProposals(root, [
        proposal({ path: 'CLAUDE.md' }),
        proposal({ path: 'src/main/CLAUDE.md' }),
        proposal({ path: '.malvy/docs/src/gone/CLAUDE.md', action: 'delete', content: '' }),
        proposal({ path: 'project_summary.json', content: JSON.stringify({ overview: 'x' }) }),
      ]);

      const meta = readDocsMeta(root);
      expect(Object.keys(meta.branches).sort()).toEqual(['', 'src/gone', 'src/main', 'src/other']);
      expect(meta.branches['src/other']).toBe('2024-01-01T00:00:00.000Z');
      expect(meta.branches['src/main']).toBe(meta.lastOptimizedAt);
    });

    it('writes a validated project_summary.json under .malvy/docs', () => {
      const result = applyDocProposals(root, [
        proposal({
          path: 'project_summary.json',
          content: JSON.stringify({
            overview: ' A project. ',
            stack: ['TS', 3, ''],
            entryPoints: [{ path: 'src/index.ts', description: 'Entry' }, { description: 'no path' }],
            commands: [{ command: 'npm test' }],
            keyModules: 'nope',
          }),
        }),
      ]);

      expect(result.errors).toEqual([]);
      expect(existsSync(path.join(root, 'project_summary.json'))).toBe(false);
      expect(readProjectSummary(root)).toEqual({
        overview: 'A project.',
        stack: ['TS'],
        entryPoints: [{ path: 'src/index.ts', description: 'Entry' }],
        commands: [{ command: 'npm test', description: '' }],
        keyModules: [],
      });
    });

    it('rejects an invalid project summary', () => {
      const result = applyDocProposals(root, [
        proposal({ path: 'project_summary.json', content: '{"stack": []}' }),
        proposal({ path: 'project_summary.json', content: 'not json' }),
      ]);

      expect(result.applied).toEqual([]);
      expect(result.errors).toHaveLength(2);
      expect(readProjectSummary(root)).toBeNull();
    });

    it('maps doc paths to their code branch', () => {
      expect(branchOfDocPath('CLAUDE.md')).toBe('');
      expect(branchOfDocPath('.malvy/docs/src/main/CLAUDE.md')).toBe('src/main');
      expect(branchOfDocPath('src/AGENTS.md')).toBe('src');
      expect(branchOfDocPath('project_summary.json')).toBeNull();
    });
  });

  describe('pointers mirror', () => {
    const pointer = (p: Partial<DocPointer>): DocPointer => ({
      id: 'id',
      content: 'text',
      createdAt: '2026-01-01T00:00:00.000Z',
      ...p,
    });

    it('groups pointers by doc file and heading, general first', () => {
      const md = renderPointersMarkdown([
        pointer({ id: '1', content: 'Use X, not Y', docPath: 'src/main/CLAUDE.md', heading: 'Invisible mode' }),
        pointer({ id: '2', content: 'Prefer small PRs', createdAt: '2026-01-02T00:00:00.000Z' }),
        pointer({
          id: '3',
          content: 'Second\nline',
          docPath: 'src/main/CLAUDE.md',
          heading: 'Invisible mode',
          createdAt: '2026-01-03T00:00:00.000Z',
        }),
        pointer({ id: '4', content: 'File-level', docPath: 'CLAUDE.md' }),
      ]);

      expect(md).toBe(
        [
          '# Developer pointers',
          '',
          'Short corrections from the developer. They override the docs where they conflict.',
          '',
          '## General',
          '- Prefer small PRs',
          '',
          '## CLAUDE.md',
          '- File-level',
          '',
          '## src/main/CLAUDE.md',
          '',
          '### Invisible mode',
          '- Use X, not Y',
          '- Second line',
          '',
        ].join('\n')
      );
    });

    it('writes .malvy/pointers.md and removes it when there are no pointers', () => {
      writePointersFile(root, [pointer({ content: 'Hello' })]);
      const file = path.join(root, MALVY_POINTERS_FILE);
      expect(readFileSync(file, 'utf-8')).toContain('- Hello');

      writePointersFile(root, []);
      expect(existsSync(file)).toBe(false);
    });
  });
});
