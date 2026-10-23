import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const cliMock = vi.fn();
vi.mock('../../cli/claude-cli', () => ({
  runClaudeCliDetailed: (opts: unknown) => cliMock(opts),
}));
vi.mock('../../prompts/prompt-loader', () => ({
  tryLoadPrompt: (name: string) =>
    readFileSync(path.join(__dirname, '..', '..', '..', '..', '..', 'prompts', `${name}.md`), 'utf-8'),
}));

import {
  buildMergeAgentPrompt,
  describeConflictCode,
  isModifyDeleteCode,
  MERGE_AGENT_SPEC_MAX_CHARS,
  parseMergeResult,
  runMergeConflictAgent,
  type MergeAgentInput,
} from '../merge-conflict-agent';

const input: MergeAgentInput = {
  cwd: '/tmp/wt',
  projectPath: '/tmp/project',
  targetBranch: 'dev',
  featureBranch: 'malvy/002-prune',
  mergeBase: 'abc123',
  conflicts: [
    { file: 'src/github/client.ts', code: 'DU' },
    { file: 'src/app.ts', code: 'UU' },
  ],
  specText: 'Remove the GitHub integration.',
  verifyCommand: 'npm run typecheck',
};

beforeEach(() => cliMock.mockReset());

describe('buildMergeAgentPrompt', () => {
  it('fills in the branches and merge base and lists every conflict with its type', () => {
    const prompt = buildMergeAgentPrompt(input);
    expect(prompt).not.toContain('{{');
    expect(prompt).toContain('merge of the target branch `dev` into the task branch `malvy/002-prune`');
    expect(prompt).toContain('git diff abc123 MERGE_HEAD --stat');
    expect(prompt).toContain('- src/github/client.ts [DU: deleted by the task, changed on dev]');
    expect(prompt).toContain('- src/app.ts [UU: both changed]');
    expect(prompt).toContain('Remove the GitHub integration.');
    expect(prompt).toContain('npm run typecheck');
    expect(prompt).toContain('<merge_result>');
  });

  it('truncates a long spec and says when there is no spec or verify command', () => {
    const long = buildMergeAgentPrompt({ ...input, specText: 'x'.repeat(MERGE_AGENT_SPEC_MAX_CHARS + 500) });
    expect(long).toContain('[... spec truncated ...]');
    expect(long).not.toContain('x'.repeat(MERGE_AGENT_SPEC_MAX_CHARS + 1));

    const bare = buildMergeAgentPrompt({ ...input, specText: undefined, verifyCommand: undefined });
    expect(bare).toContain('(no spec found');
    expect(bare).toMatch(/## Verify command\nnone/);
  });
});

describe('parseMergeResult', () => {
  it('reads the last block', () => {
    const text =
      'first <merge_result>{"status":"failed","notes":"draft","verify":"none"}</merge_result>\n' +
      'done <merge_result>{"status":"resolved","notes":"kept GitHub deleted","verify":"passed"}</merge_result>';
    expect(parseMergeResult(text)).toEqual({ status: 'resolved', notes: 'kept GitHub deleted', verify: 'passed' });
  });

  it('accepts a fenced block and normalises unknown values', () => {
    const text = '<merge_result>\n```json\n{"status":"maybe","verify":"skipped"}\n```\n</merge_result>';
    expect(parseMergeResult(text)).toEqual({ status: 'failed', notes: '', verify: 'none' });
  });

  it('returns null without a block', () => {
    expect(parseMergeResult('I resolved everything')).toBeNull();
    expect(parseMergeResult('<merge_result>not json</merge_result>')).toBeNull();
  });
});

describe('conflict codes', () => {
  it('treats only both-sides codes as per-file mergeable', () => {
    expect(isModifyDeleteCode('UU')).toBe(false);
    expect(isModifyDeleteCode('AA')).toBe(false);
    for (const code of ['DU', 'UD', 'AU', 'UA', 'DD']) expect(isModifyDeleteCode(code)).toBe(true);
  });

  it('describes codes from the task worktree point of view', () => {
    expect(describeConflictCode('UD', 'main')).toBe('changed by the task, deleted on main');
  });
});

describe('runMergeConflictAgent', () => {
  it('runs the CLI in the worktree with edit tools, the project account and the abort signal', async () => {
    cliMock.mockResolvedValue({ text: 'out', resultText: 'out' });
    const controller = new AbortController();

    await expect(runMergeConflictAgent({ ...input, abortSignal: controller.signal })).resolves.toBe('out');

    const opts = cliMock.mock.calls[0][0];
    expect(opts.cwd).toBe('/tmp/wt');
    expect(opts.projectPath).toBe('/tmp/project');
    expect(opts.allowedTools).toEqual(['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep']);
    expect(opts.maxTurns).toBeGreaterThanOrEqual(100);
    expect(opts.abortSignal).toBe(controller.signal);
  });
});
