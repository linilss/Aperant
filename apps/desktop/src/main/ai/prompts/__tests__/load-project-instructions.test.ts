import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadProjectInstructions } from '../prompt-loader';

describe('loadProjectInstructions', () => {
  let root: string;

  const write = (base: string, rel: string, content: string) => {
    mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
    writeFileSync(path.join(base, rel), content);
  };

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'project-instructions-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns null when there are no docs or pointers', async () => {
    await expect(loadProjectInstructions(root)).resolves.toBeNull();
  });

  it('keeps returning just the team root doc when nothing else exists', async () => {
    write(root, 'CLAUDE.md', '# Team root\nRules');

    const result = await loadProjectInstructions(root);

    expect(result).toEqual({ content: '# Team root\nRules', source: 'CLAUDE.md' });
  });

  it('prefers AGENTS.md over CLAUDE.md', async () => {
    write(root, 'CLAUDE.md', '# Claude');
    write(root, 'AGENTS.md', '# Agents');

    const result = await loadProjectInstructions(root);

    expect(result?.content.startsWith('# Agents')).toBe(true);
    expect(result?.source).toBe('AGENTS.md');
  });

  it('adds the documentation map, Malvy root doc and developer pointers', async () => {
    write(root, 'CLAUDE.md', '# Team root');
    write(root, 'src/main/CLAUDE.md', '# Main process\n');
    write(root, '.malvy/docs/CLAUDE.md', '# Malvy root\nExtra rules');
    write(root, '.malvy/docs/src/main/CLAUDE.md', '# Malvy main\n');
    write(root, '.malvy/pointers.md', '# Developer pointers\n\nIntro\n\n## General\n- Not X, rather Y\n');

    const result = await loadProjectInstructions(root);
    const content = result!.content;

    expect(content.startsWith('# Team root')).toBe(true);
    expect(content).toContain('## DOCUMENTATION MAP');
    expect(content).toContain('- `CLAUDE.md` (included above) — Team root');
    expect(content).toContain('- `src/main/CLAUDE.md` — Main process');
    expect(content).toContain('- `.malvy/docs/CLAUDE.md` [malvy] (included below) — Malvy root');
    expect(content).toContain('- `.malvy/docs/src/main/CLAUDE.md` [malvy] — Malvy main');
    expect(content).toContain('## MALVY DOCS\n\n# Malvy root\nExtra rules');
    expect(content).toContain('## DEVELOPER POINTERS (override docs where they conflict)\n\nIntro');
    expect(content).toContain('- Not X, rather Y');
    expect(content).not.toContain('# Developer pointers');
    expect(content.indexOf('DOCUMENTATION MAP')).toBeLessThan(content.indexOf('DEVELOPER POINTERS'));
    expect(result!.source).toBe('CLAUDE.md, .malvy/docs/CLAUDE.md, .malvy/pointers.md');
  });

  it('skips team docs but keeps the Malvy layer when includeTeamDocs is false', async () => {
    write(root, 'CLAUDE.md', '# Team root');
    write(root, 'AGENTS.md', '# Team agents');
    write(root, 'src/main/CLAUDE.md', '# Main process\n');
    write(root, '.malvy/docs/CLAUDE.md', '# Malvy root');
    write(root, '.malvy/docs/src/main/CLAUDE.md', '# Malvy main\n');
    write(root, '.malvy/pointers.md', '# Developer pointers\n\n- Pointer\n');

    const result = await loadProjectInstructions(root, { includeTeamDocs: false });
    const content = result!.content;

    expect(content).not.toContain('# Team root');
    expect(content).not.toContain('# Team agents');
    expect(content).not.toContain('src/main/CLAUDE.md` —');
    expect(content).toContain('- `.malvy/docs/src/main/CLAUDE.md` [malvy] — Malvy main');
    expect(content).toContain('## MALVY DOCS\n\n# Malvy root');
    expect(content).toContain('- Pointer');
    expect(result!.source).toBe('.malvy/docs/CLAUDE.md, .malvy/pointers.md');
  });

  it('reads the Malvy layer from the owning project when running in a task worktree', async () => {
    const worktree = path.join(root, '.malvy', 'worktrees', 'tasks', '001-task');
    write(worktree, 'CLAUDE.md', '# Team root (worktree)');
    write(root, '.malvy/docs/src/CLAUDE.md', '# Malvy src\n');
    write(root, '.malvy/pointers.md', '# Developer pointers\n\n- Pointer from owner\n');

    const result = await loadProjectInstructions(worktree);
    const content = result!.content;

    expect(content.startsWith('# Team root (worktree)')).toBe(true);
    expect(content).toContain(`\`${path.join(root, '.malvy/docs/src/CLAUDE.md')}\` [malvy] — Malvy src`);
    expect(content).toContain('- Pointer from owner');
  });

  it('returns the core values separately (owning project), not inside the instructions', async () => {
    write(root, 'CLAUDE.md', '# Team root');
    write(root, '.malvy/core-values.md', '- Kids can never lose.\n');
    const worktree = path.join(root, '.malvy', 'worktrees', 'tasks', '001-task');
    write(worktree, 'CLAUDE.md', '# Team root (worktree)');

    const result = await loadProjectInstructions(root);
    expect(result).toEqual({
      content: '# Team root',
      source: '.malvy/core-values.md, CLAUDE.md',
      coreValues: '- Kids can never lose.',
    });
    expect((await loadProjectInstructions(worktree))?.coreValues).toBe('- Kids can never lose.');
  });

  it('returns core values even when there are no docs', async () => {
    write(root, '.malvy/core-values.md', 'Calm over flashy.');
    expect(await loadProjectInstructions(root)).toEqual({
      content: '',
      source: '.malvy/core-values.md',
      coreValues: 'Calm over flashy.',
    });
  });
});
