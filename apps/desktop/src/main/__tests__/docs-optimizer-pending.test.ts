import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearPendingDocsRun,
  readPendingDocsRun,
  removeAppliedFromPending,
  writePendingDocsRun,
} from '../docs-optimizer-pending';
import type { DocProposal } from '../../shared/types/claude-docs';

const proposal = (p: string): DocProposal => ({
  path: p,
  action: 'create',
  content: '# Doc',
  reason: 'new',
  appliedPointerIds: [],
  before: null,
});

describe('docs optimizer pending run', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'pending-docs-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns null when nothing is pending', () => {
    expect(readPendingDocsRun(root)).toBeNull();
  });

  it('round-trips proposals under .malvy/docs', () => {
    writePendingDocsRun(root, { proposals: [proposal('a/CLAUDE.md')], projectSummary: null });

    expect(existsSync(path.join(root, '.malvy/docs/.pending.json'))).toBe(true);
    const pending = readPendingDocsRun(root);
    expect(pending?.proposals.map((p) => p.path)).toEqual(['a/CLAUDE.md']);
    expect(pending?.finishedAt).toBeTruthy();
  });

  it('keeps the error of a failed run', () => {
    writePendingDocsRun(root, { proposals: [], projectSummary: null, error: 'HTTP 429' });

    expect(readPendingDocsRun(root)?.error).toBe('HTTP 429');
  });

  it('drops applied proposals and removes the file when none are left', () => {
    writePendingDocsRun(root, { proposals: [proposal('a/CLAUDE.md'), proposal('b/CLAUDE.md')], projectSummary: null });

    removeAppliedFromPending(root, ['a/CLAUDE.md']);
    expect(readPendingDocsRun(root)?.proposals.map((p) => p.path)).toEqual(['b/CLAUDE.md']);

    removeAppliedFromPending(root, ['b/CLAUDE.md']);
    expect(readPendingDocsRun(root)).toBeNull();
  });

  it('clears the pending run', () => {
    writePendingDocsRun(root, { proposals: [proposal('a/CLAUDE.md')], projectSummary: null });
    clearPendingDocsRun(root);

    expect(readPendingDocsRun(root)).toBeNull();
  });
});
