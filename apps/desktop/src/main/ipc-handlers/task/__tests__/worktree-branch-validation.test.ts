/**
 * Tests for worktree branch validation logic.
 *
 * Issue #1479: When cleaning up a corrupted worktree, git rev-parse walks up
 * to the main project and returns its current branch instead of the worktree's branch.
 * This could cause deletion of the wrong branch.
 *
 * These tests verify the validation logic that prevents this.
 */

import { describe, expect, it } from 'vitest';
import { GIT_BRANCH_REGEX, validateWorktreeBranch } from '../worktree-handlers';

describe('GIT_BRANCH_REGEX', () => {
  it('should accept valid malvy branch names', () => {
    expect(GIT_BRANCH_REGEX.test('malvy/my-feature')).toBe(true);
    expect(GIT_BRANCH_REGEX.test('malvy/123-fix-bug')).toBe(true);
    expect(GIT_BRANCH_REGEX.test('malvy/feature_with_underscore')).toBe(true);
  });

  it('should accept valid feature branch names', () => {
    expect(GIT_BRANCH_REGEX.test('feature/my-feature')).toBe(true);
    expect(GIT_BRANCH_REGEX.test('fix/bug-123')).toBe(true);
    expect(GIT_BRANCH_REGEX.test('main')).toBe(true);
    expect(GIT_BRANCH_REGEX.test('develop')).toBe(true);
  });

  it('should accept single character branch names', () => {
    expect(GIT_BRANCH_REGEX.test('a')).toBe(true);
    expect(GIT_BRANCH_REGEX.test('1')).toBe(true);
  });

  it('should reject invalid branch names', () => {
    expect(GIT_BRANCH_REGEX.test('')).toBe(false);
    expect(GIT_BRANCH_REGEX.test('-invalid')).toBe(false);
    expect(GIT_BRANCH_REGEX.test('invalid-')).toBe(false);
    expect(GIT_BRANCH_REGEX.test('.invalid')).toBe(false);
  });

  it('should accept HEAD as syntactically valid (handled specially in validation logic)', () => {
    // HEAD is technically valid as a git branch name syntactically,
    // but when detected from rev-parse it indicates detached state.
    // The validateWorktreeBranch function handles this case specially.
    expect(GIT_BRANCH_REGEX.test('HEAD')).toBe(true);
  });
});

describe('validateWorktreeBranch', () => {
  const expectedBranch = 'malvy/my-feature-123';

  describe('exact match scenarios', () => {
    it('should use detected branch when it matches expected exactly', () => {
      const result = validateWorktreeBranch('malvy/my-feature-123', expectedBranch);
      expect(result.branchToDelete).toBe('malvy/my-feature-123');
      expect(result.usedFallback).toBe(false);
      expect(result.reason).toBe('exact_match');
    });
  });

  describe('pattern match scenarios', () => {
    it('should allow other malvy branches (specId renamed)', () => {
      const result = validateWorktreeBranch('malvy/renamed-feature', expectedBranch);
      expect(result.branchToDelete).toBe('malvy/renamed-feature');
      expect(result.usedFallback).toBe(false);
      expect(result.reason).toBe('pattern_match');
    });

    it('should allow malvy branches with different formats', () => {
      const result = validateWorktreeBranch('malvy/001-task', expectedBranch);
      expect(result.branchToDelete).toBe('malvy/001-task');
      expect(result.usedFallback).toBe(false);
      expect(result.reason).toBe('pattern_match');
    });
  });

  describe('security: corrupted worktree scenarios (issue #1479)', () => {
    it('should reject main project branch and use expected pattern', () => {
      // This is the critical case: corrupted worktree returns main project's branch
      const result = validateWorktreeBranch('feature/xstate-task-machine', expectedBranch);
      expect(result.branchToDelete).toBe(expectedBranch);
      expect(result.usedFallback).toBe(true);
      expect(result.reason).toBe('invalid_pattern');
    });

    it('should reject develop branch', () => {
      const result = validateWorktreeBranch('develop', expectedBranch);
      expect(result.branchToDelete).toBe(expectedBranch);
      expect(result.usedFallback).toBe(true);
      expect(result.reason).toBe('invalid_pattern');
    });

    it('should reject main branch', () => {
      const result = validateWorktreeBranch('main', expectedBranch);
      expect(result.branchToDelete).toBe(expectedBranch);
      expect(result.usedFallback).toBe(true);
      expect(result.reason).toBe('invalid_pattern');
    });

    it('should reject master branch', () => {
      const result = validateWorktreeBranch('master', expectedBranch);
      expect(result.branchToDelete).toBe(expectedBranch);
      expect(result.usedFallback).toBe(true);
      expect(result.reason).toBe('invalid_pattern');
    });

    it('should reject fix/ branches from main project', () => {
      const result = validateWorktreeBranch('fix/some-bug', expectedBranch);
      expect(result.branchToDelete).toBe(expectedBranch);
      expect(result.usedFallback).toBe(true);
      expect(result.reason).toBe('invalid_pattern');
    });

    it('should reject feature/ branches from main project', () => {
      const result = validateWorktreeBranch('feature/new-feature', expectedBranch);
      expect(result.branchToDelete).toBe(expectedBranch);
      expect(result.usedFallback).toBe(true);
      expect(result.reason).toBe('invalid_pattern');
    });
  });

  describe('detection failure scenarios', () => {
    it('should use expected pattern when detection returns null', () => {
      const result = validateWorktreeBranch(null, expectedBranch);
      expect(result.branchToDelete).toBe(expectedBranch);
      expect(result.usedFallback).toBe(true);
      expect(result.reason).toBe('detection_failed');
    });
  });

  describe('edge cases', () => {
    it('should handle empty detected branch', () => {
      const result = validateWorktreeBranch('', expectedBranch);
      expect(result.branchToDelete).toBe(expectedBranch);
      expect(result.usedFallback).toBe(true);
      expect(result.reason).toBe('invalid_pattern');
    });

    it('should handle HEAD (detached state)', () => {
      const result = validateWorktreeBranch('HEAD', expectedBranch);
      expect(result.branchToDelete).toBe(expectedBranch);
      expect(result.usedFallback).toBe(true);
      expect(result.reason).toBe('invalid_pattern');
    });

    it('should handle branch that starts with malvy but is malformed', () => {
      // "malvy" without a slash should still be rejected
      const result = validateWorktreeBranch('malvy', expectedBranch);
      expect(result.branchToDelete).toBe(expectedBranch);
      expect(result.usedFallback).toBe(true);
      expect(result.reason).toBe('invalid_pattern');
    });

    it('should reject malvy/ with no suffix (invalid branch name)', () => {
      // "malvy/" alone is not a valid branch name - needs actual specId
      const result = validateWorktreeBranch('malvy/', expectedBranch);
      expect(result.branchToDelete).toBe(expectedBranch);
      expect(result.usedFallback).toBe(true);
      expect(result.reason).toBe('invalid_pattern');
    });
  });

  describe('configured branch prefix', () => {
    const settings = { branchPrefix: 'feature/' };

    it('accepts a branch with the configured prefix', () => {
      const result = validateWorktreeBranch('feature/other-task', 'feature/my-task', settings);
      expect(result.branchToDelete).toBe('feature/other-task');
      expect(result.usedFallback).toBe(false);
      expect(result.reason).toBe('pattern_match');
    });

    it('still accepts legacy malvy/ branches', () => {
      const result = validateWorktreeBranch('malvy/old-task', 'feature/old-task', settings);
      expect(result.branchToDelete).toBe('malvy/old-task');
      expect(result.reason).toBe('pattern_match');
    });

    it('rejects the configured prefix when it is not configured', () => {
      const result = validateWorktreeBranch('feature/other-task', 'malvy/my-task');
      expect(result.branchToDelete).toBe('malvy/my-task');
      expect(result.usedFallback).toBe(true);
      expect(result.reason).toBe('invalid_pattern');
    });
  });
});
