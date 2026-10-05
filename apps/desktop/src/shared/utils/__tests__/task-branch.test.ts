import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TASK_BRANCH_PREFIX,
  getSpecIdFromTaskBranch,
  getTaskBranchCandidates,
  getTaskBranchName,
  getTaskBranchPrefix,
  isTaskBranch,
  isValidTaskBranchPrefix,
} from '../task-branch';

describe('task-branch', () => {
  describe('getTaskBranchName', () => {
    it('defaults to the malvy/ prefix', () => {
      expect(DEFAULT_TASK_BRANCH_PREFIX).toBe('malvy/');
      expect(getTaskBranchName('001-feature')).toBe('malvy/001-feature');
      expect(getTaskBranchName('001-feature', {})).toBe('malvy/001-feature');
      expect(getTaskBranchName('001-feature', null)).toBe('malvy/001-feature');
    });

    it('uses the configured prefix', () => {
      expect(getTaskBranchName('001-feature', { branchPrefix: 'feature/' })).toBe('feature/001-feature');
      expect(getTaskBranchName('001-feature', { branchPrefix: 'lnn-' })).toBe('lnn-001-feature');
    });

    it('trims whitespace around the prefix', () => {
      expect(getTaskBranchName('001', { branchPrefix: '  feature/ ' })).toBe('feature/001');
    });

    it('falls back to the default for empty or invalid prefixes', () => {
      for (const branchPrefix of ['', '   ', 'has space/', 'a..b/', '-x/', '/x/', 'x~/', 'x:/', 'x//']) {
        expect(getTaskBranchPrefix({ branchPrefix })).toBe('malvy/');
      }
    });
  });

  describe('isValidTaskBranchPrefix', () => {
    it('accepts common prefixes', () => {
      expect(isValidTaskBranchPrefix('feature/')).toBe(true);
      expect(isValidTaskBranchPrefix('users/linus/')).toBe(true);
      expect(isValidTaskBranchPrefix('task-')).toBe(true);
    });

    it('rejects empty and non-string values', () => {
      expect(isValidTaskBranchPrefix('')).toBe(false);
      expect(isValidTaskBranchPrefix(undefined)).toBe(false);
      expect(isValidTaskBranchPrefix(null)).toBe(false);
    });
  });

  describe('getTaskBranchCandidates', () => {
    it('lists the configured name first, then legacy names, without duplicates', () => {
      expect(getTaskBranchCandidates('001', { branchPrefix: 'feature/' })).toEqual([
        'feature/001',
        'malvy/001',
        'auto-claude/001',
      ]);
      expect(getTaskBranchCandidates('001')).toEqual(['malvy/001', 'auto-claude/001']);
    });
  });

  describe('isTaskBranch / getSpecIdFromTaskBranch', () => {
    const settings = { branchPrefix: 'feature/' };

    it('matches the configured prefix', () => {
      expect(isTaskBranch('feature/001-x', settings)).toBe(true);
      expect(getSpecIdFromTaskBranch('feature/001-x', settings)).toBe('001-x');
    });

    it('keeps matching legacy prefixes', () => {
      expect(isTaskBranch('malvy/001-x', settings)).toBe(true);
      expect(isTaskBranch('auto-claude/001-x', settings)).toBe(true);
      expect(getSpecIdFromTaskBranch('malvy/001-x', settings)).toBe('001-x');
    });

    it('rejects bare prefixes and unrelated branches', () => {
      expect(isTaskBranch('feature/', settings)).toBe(false);
      expect(isTaskBranch('malvy/', settings)).toBe(false);
      expect(isTaskBranch('main', settings)).toBe(false);
      expect(isTaskBranch('develop')).toBe(false);
      expect(isTaskBranch(null)).toBe(false);
      expect(isTaskBranch('')).toBe(false);
    });

    it('does not match a custom prefix unless configured', () => {
      expect(isTaskBranch('feature/001-x')).toBe(false);
    });
  });
});
