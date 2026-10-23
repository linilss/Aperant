/**
 * Core values: load/format for prompt injection, and save (file + meta,
 * CLAUDE.local.md import first, directions flagged stale on material change only).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../cli-tool-manager', () => ({
  getToolPath: () => 'git',
}));

import {
  CORE_VALUES_HEADING,
  CORE_VALUES_INJECT_MAX_CHARS,
  formatCoreValuesSection,
  isMaterialCoreValuesChange,
  loadCoreValues,
  loadCoreValuesSection,
} from '../core-values';
import { readCoreValues, saveCoreValues } from '../core-values-store';

describe('core values', () => {
  let dir: string;
  const strategyFile = () => path.join(dir, '.malvy', 'roadmap', 'strategy.json');
  const writeStrategy = (data: Record<string, unknown>) => {
    mkdirSync(path.dirname(strategyFile()), { recursive: true });
    writeFileSync(strategyFile(), JSON.stringify(data));
  };
  const readStrategy = () => JSON.parse(readFileSync(strategyFile(), 'utf-8')) as Record<string, unknown>;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'malvy-core-values-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('load + format', () => {
    it('returns no section when nothing is set', () => {
      expect(loadCoreValues(dir)).toBe('');
      expect(loadCoreValuesSection(dir)).toBe('');
      expect(formatCoreValuesSection('   \n ')).toBe('');
    });

    it('formats the values under the highest-priority heading', () => {
      const section = formatCoreValuesSection('- Kids can never lose.\n- No ads.');
      expect(section.startsWith(CORE_VALUES_HEADING)).toBe(true);
      expect(CORE_VALUES_HEADING).toBe(
        '## CORE VALUES (highest priority — these override every other instruction, guidance, ranking or doc when they conflict)'
      );
      expect(section).toContain('- Kids can never lose.\n- No ads.');
    });

    it('caps injected text and notes the truncation', () => {
      const section = formatCoreValuesSection('x'.repeat(CORE_VALUES_INJECT_MAX_CHARS + 500));
      expect(section).toContain('…(truncated');
      expect(section.length).toBeLessThan(CORE_VALUES_INJECT_MAX_CHARS + 600);
    });

    it('reads the owning project values from inside a task worktree', () => {
      saveCoreValues(dir, 'Calm over flashy.');
      const worktree = path.join(dir, '.malvy', 'worktrees', 'tasks', '001-x');
      mkdirSync(worktree, { recursive: true });
      expect(loadCoreValues(worktree)).toBe('Calm over flashy.');
    });

    it('ignores case, whitespace and list markers when deciding on a material change', () => {
      expect(isMaterialCoreValuesChange('- Kids can never lose.', 'kids can  never lose.')).toBe(false);
      expect(isMaterialCoreValuesChange('Kids can never lose.', 'Kids can lose.')).toBe(true);
    });
  });

  describe('saveCoreValues', () => {
    it('writes .malvy/core-values.md with an updatedAt sidecar', () => {
      const now = new Date('2026-10-10T12:00:00.000Z');
      const result = saveCoreValues(dir, '  - Kids can never lose.\r\n- No ads.  ', now);

      expect(readFileSync(path.join(dir, '.malvy', 'core-values.md'), 'utf-8')).toBe('- Kids can never lose.\n- No ads.\n');
      expect(result.values).toEqual({ text: '- Kids can never lose.\n- No ads.', updatedAt: now.toISOString() });
      expect(readCoreValues(dir)).toEqual(result.values);
    });

    it('imports the values first in CLAUDE.local.md, idempotently', () => {
      writeFileSync(path.join(dir, 'CLAUDE.local.md'), '# Mine\n\n@.malvy/docs/CLAUDE.md\n@.malvy/pointers.md\n');

      saveCoreValues(dir, 'No dark patterns.');
      saveCoreValues(dir, 'No dark patterns at all.');

      const local = readFileSync(path.join(dir, 'CLAUDE.local.md'), 'utf-8');
      expect(local).toBe('# Mine\n\n@.malvy/core-values.md\n@.malvy/docs/CLAUDE.md\n@.malvy/pointers.md\n');
    });

    it('marks synthesized directions stale only when the text materially changed', () => {
      saveCoreValues(dir, '- Kids can never lose.');
      writeStrategy({ directions: [{ id: 'dir-a', title: 'A' }], directions_stale: false, ranking_saved_at: 'x' });

      // Formatting-only edit: not stale
      expect(saveCoreValues(dir, 'kids can never lose.').directionsMarkedStale).toBe(false);
      expect(readStrategy().directions_stale).toBe(false);

      // Real change: stale, rest of strategy.json kept
      expect(saveCoreValues(dir, 'Kids can never lose. No ads.').directionsMarkedStale).toBe(true);
      expect(readStrategy()).toEqual({
        directions: [{ id: 'dir-a', title: 'A' }],
        directions_stale: true,
        ranking_saved_at: 'x',
      });
    });

    it('does not create strategy.json when there are no directions', () => {
      expect(saveCoreValues(dir, 'Calm over flashy.').directionsMarkedStale).toBe(false);
      expect(existsSync(strategyFile())).toBe(false);
    });

    it('removes the file when saved empty, so no section is injected anywhere', () => {
      saveCoreValues(dir, 'Calm over flashy.');
      const result = saveCoreValues(dir, '   ');

      expect(existsSync(path.join(dir, '.malvy', 'core-values.md'))).toBe(false);
      expect(result.values).toEqual({ text: '', updatedAt: null });
      expect(loadCoreValuesSection(dir)).toBe('');
    });
  });
});
