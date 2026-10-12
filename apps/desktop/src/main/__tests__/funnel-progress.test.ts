/**
 * Plan-funnel progress: each step on/off from its files under `.malvy/`,
 * everything done, and malformed files counting as "not done".
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getFunnelProgress } from '../funnel-progress';
import type { FunnelStepId } from '../../shared/types/funnel';

describe('getFunnelProgress', () => {
  let dir: string;

  const write = (rel: string, content: string | Record<string, unknown>) => {
    const file = path.join(dir, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  };
  const step = (id: FunnelStepId) => getFunnelProgress(dir).steps.find((s) => s.id === id);
  const done = (id: FunnelStepId) => step(id)?.done;

  const writeCoreValues = () => write('.malvy/core-values.md', '- Kids can never lose.\n');
  const writeContext = () => write('.malvy/docs/.meta.json', { lastOptimizedAt: '2026-10-01T10:00:00.000Z', branches: {} });
  const writeDesign = () => write('.malvy/design-system/project/tokens.json', { colors: {} });
  const writeCompetitors = () => {
    write('.malvy/roadmap/competitor_analysis.json', {
      competitors: [{ id: 'c-1', name: 'Rival', status: 'done' }],
    });
    write('.malvy/roadmap/strategy.json', { directions: [], ranking_saved_at: '2026-10-02T10:00:00.000Z' });
  };
  const writeRoadmap = () => write('.malvy/roadmap/roadmap.json', { features: [{ id: 'f-1', title: 'One' }] });
  const writeIdeation = () => write('.malvy/ideation/ideation.json', { ideas: [{ id: 'i-1' }, { id: 'i-2' }] });

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'funnel-progress-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports all six steps in funnel order, none done for an empty project', () => {
    const progress = getFunnelProgress(dir);
    expect(progress.steps.map((s) => s.id)).toEqual([
      'coreValues',
      'context',
      'design',
      'competitors',
      'roadmap',
      'ideation',
    ]);
    expect(progress.steps.every((s) => !s.done)).toBe(true);
    expect(progress).toMatchObject({ completed: 0, total: 6 });
  });

  it('does not throw for a missing project folder', () => {
    expect(getFunnelProgress(path.join(dir, 'missing'))).toMatchObject({ completed: 0, total: 6 });
  });

  describe('core values', () => {
    it('is done when core-values.md has text', () => {
      writeCoreValues();
      expect(done('coreValues')).toBe(true);
    });

    it('is not done when the file is blank', () => {
      write('.malvy/core-values.md', '  \n\n');
      expect(done('coreValues')).toBe(false);
    });
  });

  describe('context', () => {
    it('is done when the docs were optimized', () => {
      writeContext();
      expect(done('context')).toBe(true);
    });

    it('is done when only a project summary exists', () => {
      write('.malvy/docs/project_summary.json', { overview: 'A chores app.' });
      expect(done('context')).toBe(true);
    });

    it('is not done when .meta.json has no timestamp', () => {
      write('.malvy/docs/.meta.json', { lastOptimizedAt: null, branches: {} });
      expect(done('context')).toBe(false);
    });
  });

  describe('design', () => {
    it('is done with a synced snapshot', () => {
      writeDesign();
      expect(done('design')).toBe(true);
    });

    it('is not done with an empty snapshot folder', () => {
      mkdirSync(path.join(dir, '.malvy/design-system'), { recursive: true });
      expect(done('design')).toBe(false);
    });

    it('is done with a source folder that holds tokens', () => {
      write('design/system/project/tokens.json', { colors: {} });
      write('.malvy/design-system.json', { sourceDir: 'design/system/project' });
      expect(done('design')).toBe(true);
    });

    it('is done with an artifact link next to a token file in the docs', () => {
      write('app.css', ':root { --primary: #000; }');
      write(
        'CLAUDE.md',
        '## Design system\n\nThe design lives at https://claude.ai/artifact/abc123 — tokens in `app.css`.\n'
      );
      expect(done('design')).toBe(true);
    });

    it('is not done with only an artifact link', () => {
      write('.malvy/design-system.json', { artifactUrl: 'https://claude.ai/artifact/abc123' });
      expect(done('design')).toBe(false);
    });
  });

  describe('competitors', () => {
    it('is done with an analyzed competitor and a saved ranking', () => {
      writeCompetitors();
      expect(step('competitors')).toEqual({ id: 'competitors', done: true, detail: '1' });
    });

    it('is not done without a saved ranking', () => {
      write('.malvy/roadmap/competitor_analysis.json', { competitors: [{ id: 'c-1', name: 'Rival', status: 'done' }] });
      write('.malvy/roadmap/strategy.json', { directions: [] });
      expect(done('competitors')).toBe(false);
    });

    it('is not done when only pool (unanalyzed) competitors exist', () => {
      write('.malvy/roadmap/competitor_analysis.json', { competitors: [], competitor_pool: [{ name: 'Maybe' }] });
      write('.malvy/roadmap/strategy.json', { ranking_saved_at: '2026-10-02T10:00:00.000Z' });
      expect(done('competitors')).toBe(false);
    });
  });

  describe('roadmap', () => {
    it('is done with at least one feature', () => {
      writeRoadmap();
      expect(step('roadmap')).toEqual({ id: 'roadmap', done: true, detail: '1' });
    });

    it('is not done with an empty feature list', () => {
      write('.malvy/roadmap/roadmap.json', { features: [] });
      expect(done('roadmap')).toBe(false);
    });
  });

  describe('ideation', () => {
    it('is done with at least one idea', () => {
      writeIdeation();
      expect(step('ideation')).toEqual({ id: 'ideation', done: true, detail: '2' });
    });

    it('is not done with no ideas', () => {
      write('.malvy/ideation/ideation.json', { ideas: [] });
      expect(done('ideation')).toBe(false);
    });
  });

  it('counts every step when all are done', () => {
    writeCoreValues();
    writeContext();
    writeDesign();
    writeCompetitors();
    writeRoadmap();
    writeIdeation();
    const progress = getFunnelProgress(dir);
    expect(progress.steps.every((s) => s.done)).toBe(true);
    expect(progress).toMatchObject({ completed: 6, total: 6 });
  });

  it('counts only the finished steps', () => {
    writeCoreValues();
    writeRoadmap();
    expect(getFunnelProgress(dir)).toMatchObject({ completed: 2, total: 6 });
  });

  it('treats malformed files as not done', () => {
    write('.malvy/docs/.meta.json', '{not json');
    write('.malvy/docs/project_summary.json', '[]');
    write('.malvy/design-system.json', '{"sourceDir": ');
    write('.malvy/roadmap/competitor_analysis.json', 'nope');
    write('.malvy/roadmap/strategy.json', '{"ranking_saved_at": 42}');
    write('.malvy/roadmap/roadmap.json', '{"features": "many"}');
    write('.malvy/ideation/ideation.json', '[{"id": "i-1"}]');
    const progress = getFunnelProgress(dir);
    expect(progress.completed).toBe(0);
    expect(progress.steps.every((s) => !s.done)).toBe(true);
  });
});
