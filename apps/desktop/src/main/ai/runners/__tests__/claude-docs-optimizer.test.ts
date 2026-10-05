import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../cli/claude-cli', () => ({
  runClaudeCli: vi.fn(),
}));
vi.mock('../../config/phase-config', () => ({
  resolveModelId: (model: string) => `model-${model}`,
}));
vi.mock('../../prompts/prompt-loader', () => ({
  tryLoadPrompt: (name: string) => `SYSTEM:${name}`,
}));
vi.mock('../../../cli-tool-manager', () => ({
  getToolPath: () => 'git',
}));

import { runClaudeCli } from '../../cli/claude-cli';
import {
  assignPointersToBranches,
  type ClaudeDocsOptimizerEvent,
  extractTagBlock,
  normalizeBranchDoc,
  runClaudeDocsOptimizer,
  toDocProposal,
} from '../claude-docs-optimizer';
import type { DocPointer } from '../../../../shared/types/claude-docs';

// =============================================================================
// Mocked model
// =============================================================================

interface Call {
  kind: 'branch' | 'root';
  branch: string;
  system: string;
  prompt: string;
  start: number;
  end?: number;
}

type Responder = (call: Call) => string | Promise<string>;

let calls: Call[];
let active = 0;
let maxActive = 0;

function mockModel(respond: Responder, delayMs = 20) {
  vi.mocked(runClaudeCli).mockImplementation(async (opts) => {
    const separator = opts.prompt.indexOf('\n\n---\n\n');
    const system = opts.prompt.slice(0, separator);
    const prompt = opts.prompt.slice(separator + 7);
    const branchMatch = prompt.match(/^Branch: `([^`]*)`/m);
    const call: Call = {
      kind: branchMatch ? 'branch' : 'root',
      branch: branchMatch ? branchMatch[1] : '',
      system,
      prompt,
      start: Date.now(),
    };
    calls.push(call);
    active++;
    maxActive = Math.max(maxActive, active);
    try {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (opts.abortSignal?.aborted) throw new Error('aborted');
      opts.onToolUse?.('Read', { file_path: `${call.branch}/x.ts` });
      const text = await respond(call);
      opts.onText?.(text);
      return text;
    } finally {
      active--;
      call.end = Date.now();
    }
  });
}

const branchDoc = (obj: Record<string, unknown>) => `Done.\n<branch_doc>${JSON.stringify(obj)}</branch_doc>`;
const rootOutput = (summary: Record<string, unknown> | null, doc: Record<string, unknown>) =>
  `<root_doc>${JSON.stringify(doc)}</root_doc>\n${summary ? `<project_summary>${JSON.stringify(summary)}</project_summary>` : ''}`;

const SUMMARY = {
  overview: 'A test project.',
  stack: ['TypeScript'],
  entryPoints: [{ path: 'src/a/f0.ts', description: 'Entry' }],
  commands: [{ command: 'npm test', description: 'Tests' }],
  keyModules: [{ path: 'src/a', summary: 'Module A' }],
};

// =============================================================================
// Orchestration
// =============================================================================

describe('runClaudeDocsOptimizer orchestration', () => {
  let root: string;

  const write = (rel: string, content = 'export {};\n') => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  };

  async function run(
    config: Partial<Parameters<typeof runClaudeDocsOptimizer>[0]> = {}
  ): Promise<ClaudeDocsOptimizerEvent[]> {
    const events: ClaudeDocsOptimizerEvent[] = [];
    await runClaudeDocsOptimizer({ projectDir: root, pointers: [], ...config }, (e) => events.push(e));
    return events;
  }

  const progressOf = (events: ClaudeDocsOptimizerEvent[], branch: string) =>
    events.filter((e) => e.type === 'branch-progress' && e.branch === branch).map((e) => (e as { status: string }).status);
  const completeOf = (events: ClaudeDocsOptimizerEvent[]) =>
    events.find((e) => e.type === 'complete') as Extract<ClaudeDocsOptimizerEvent, { type: 'complete' }> | undefined;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'docs-optimizer-'));
    for (const dir of ['src/a', 'src/b', 'src/c', 'src/d', 'src/e']) {
      for (let i = 0; i < 5; i++) write(`${dir}/f${i}.ts`);
    }
    calls = [];
    active = 0;
    maxActive = 0;
    vi.mocked(runClaudeCli).mockReset();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('runs one pass per branch with concurrency 3, then the root pass', async () => {
    mockModel((call) =>
      call.kind === 'branch'
        ? branchDoc({ action: 'create', content: `# ${call.branch}\n`, reason: 'r', summary: `Summary ${call.branch}` })
        : rootOutput(SUMMARY, { action: 'create', content: '# Root\n', reason: 'root' })
    );

    const events = await run();

    const branchCalls = calls.filter((c) => c.kind === 'branch');
    expect(branchCalls.map((c) => c.branch).sort()).toEqual(['src/a', 'src/b', 'src/c', 'src/d', 'src/e']);
    expect(branchCalls.every((c) => c.system === 'SYSTEM:claude_docs_branch')).toBe(true);
    expect(maxActive).toBe(3);

    const rootCall = calls.find((c) => c.kind === 'root');
    expect(rootCall?.system).toBe('SYSTEM:claude_docs_root');
    expect(Math.max(...branchCalls.map((c) => c.end ?? 0))).toBeLessThanOrEqual(rootCall?.start ?? 0);

    expect(progressOf(events, 'src/a')).toEqual(['queued', 'running', 'done']);
    expect(progressOf(events, '')).toEqual(['queued', 'running', 'done']);

    const complete = completeOf(events);
    expect(complete?.proposals.map((p) => p.path).sort()).toEqual([
      'CLAUDE.md',
      'project_summary.json',
      'src/a/CLAUDE.md',
      'src/b/CLAUDE.md',
      'src/c/CLAUDE.md',
      'src/d/CLAUDE.md',
      'src/e/CLAUDE.md',
    ]);
    expect(complete?.projectSummary).toEqual(SUMMARY);
    expect(complete?.skippedBranches).toEqual([]);

    // Streamed events carry their branch
    expect(events).toContainEqual({ type: 'tool-use', branch: 'src/a', toolName: 'Read', input: 'src/a/x.ts' });
  });

  it('handles skip, unchanged, delete-without-doc and invalid output per branch', async () => {
    write('.malvy/docs/src/b/CLAUDE.md', '# Same\n');
    mockModel((call) => {
      switch (call.branch) {
        case 'src/a':
          return branchDoc({ action: 'skip', reason: 'trivial', summary: 'Fixtures' });
        case 'src/b':
          return branchDoc({ action: 'update', content: '# Same', reason: 'r', summary: 'B' });
        case 'src/c':
          return branchDoc({ action: 'delete', reason: 'redundant', summary: 'C' });
        case 'src/d':
          return 'I forgot the tags';
        default:
          return branchDoc({ action: 'create', content: '# E\n', reason: 'r', summary: 'E' });
      }
    });

    const events = await run({ branches: ['src/a', 'src/b', 'src/c', 'src/d', 'src/e'] });

    expect(progressOf(events, 'src/a')).toEqual(['queued', 'running', 'skipped']);
    expect(progressOf(events, 'src/b')).toEqual(['queued', 'running', 'skipped']);
    expect(progressOf(events, 'src/c')).toEqual(['queued', 'running', 'skipped']);
    expect(progressOf(events, 'src/d')).toEqual(['queued', 'running', 'error']);
    expect(progressOf(events, '')).toEqual([]);

    const complete = completeOf(events);
    expect(complete?.proposals.map((p) => [p.path, p.action])).toEqual([['src/e/CLAUDE.md', 'create']]);
    expect(complete?.skippedBranches.sort()).toEqual(['src/a', 'src/b', 'src/c']);
    expect(complete?.projectSummary).toBeNull();
    // Selected branches only: no root pass by default
    expect(calls.some((c) => c.kind === 'root')).toBe(false);
  });

  it('gives the root pass every branch summary and the general pointers', async () => {
    const pointers: DocPointer[] = [
      { id: 'p-general', content: 'Use pnpm, never npm', createdAt: '2024-01-01T00:00:00Z' },
      { id: 'p-a', content: 'Never import from b', docPath: '.malvy/docs/src/a/CLAUDE.md', createdAt: '2024-01-02T00:00:00Z' },
    ];
    write('.malvy/docs/src/e/CLAUDE.md', '# Existing E doc\n');
    mockModel((call) =>
      call.kind === 'branch'
        ? branchDoc({ action: 'create', content: `# ${call.branch}\n`, reason: 'r', summary: `Summary of ${call.branch}` })
        : rootOutput(SUMMARY, { action: 'skip', reason: 'fine' })
    );

    // Re-document a and b only, but run the root pass too
    const events = await run({ pointers, branches: ['src/a', 'src/b'], includeRoot: true });

    const rootCall = calls.find((c) => c.kind === 'root');
    expect(rootCall?.prompt).toContain('- src/a [missing]: Summary of src/a');
    expect(rootCall?.prompt).toContain('- src/b [missing]: Summary of src/b');
    // Branches not run this time fall back to their existing doc's first line
    expect(rootCall?.prompt).toContain('- src/e [documented]: Existing E doc');
    expect(rootCall?.prompt).toContain('- src/c [missing]: (not documented yet)');
    expect(rootCall?.prompt).toContain('id=p-general');
    expect(rootCall?.prompt).not.toContain('id=p-a');

    const aCall = calls.find((c) => c.branch === 'src/a');
    expect(aCall?.prompt).toContain('id=p-a');
    expect(aCall?.prompt).not.toContain('id=p-general');

    const complete = completeOf(events);
    expect(complete?.skippedBranches).toEqual(['']);
    expect(complete?.proposals.map((p) => p.path)).toContain('project_summary.json');
    expect(progressOf(events, '')).toEqual(['queued', 'running', 'skipped']);
  });

  it('stops starting passes and emits no completion when aborted', async () => {
    const controller = new AbortController();
    mockModel((call) => branchDoc({ action: 'create', content: `# ${call.branch}\n`, reason: 'r', summary: 's' }), 30);

    const events: ClaudeDocsOptimizerEvent[] = [];
    let running = 0;
    await runClaudeDocsOptimizer({ projectDir: root, pointers: [], abortSignal: controller.signal }, (e) => {
      events.push(e);
      // Abort once the first three (concurrent) passes are running
      if (e.type === 'branch-progress' && e.status === 'running' && ++running === 3) controller.abort();
    });

    expect(calls.filter((c) => c.kind === 'branch')).toHaveLength(3);
    expect(calls.some((c) => c.kind === 'root')).toBe(false);
    expect(events.some((e) => e.type === 'complete' || e.type === 'error')).toBe(false);
    expect(progressOf(events, 'src/d')).toEqual(['queued']);
    expect(progressOf(events, 'src/e')).toEqual(['queued']);
  });

  it('reports an error when every pass fails', async () => {
    mockModel(() => 'no tags at all');

    const events = await run({ branches: ['src/a'] });

    expect(events.at(-1)).toMatchObject({ type: 'error' });
  });
});

// =============================================================================
// Parsing helpers
// =============================================================================

describe('claude-docs-optimizer parsing', () => {
  it('extracts the last block for a tag', () => {
    const text = 'I will output <branch_doc> tags.\n<branch_doc>{"a":1}</branch_doc>';
    expect(extractTagBlock(text, 'branch_doc')).toBe('{"a":1}');
    expect(extractTagBlock('no block', 'branch_doc')).toBeNull();
  });

  it('validates branch docs', () => {
    expect(normalizeBranchDoc({ action: 'create', content: '# x', summary: ' one\nline ', appliedPointerIds: ['p', 2] })).toEqual({
      action: 'create',
      content: '# x',
      reason: '',
      summary: 'one line',
      appliedPointerIds: ['p'],
    });
    expect(normalizeBranchDoc({ action: 'update' })).toBeNull();
    expect(normalizeBranchDoc({ action: 'rename', content: 'x' })).toBeNull();
    expect(normalizeBranchDoc({ action: 'skip', reason: 'trivial' })?.action).toBe('skip');
  });

  it('turns branch docs into proposals with create/update decided by the existing doc', () => {
    const doc = { action: 'create' as const, content: '# New', reason: 'r', summary: 's', appliedPointerIds: [] };
    expect(toDocProposal('src/a', doc, null)).toMatchObject({ path: 'src/a/CLAUDE.md', action: 'create', before: null });
    expect(toDocProposal('src/a', doc, '# Old\n')).toMatchObject({ action: 'update', before: '# Old\n' });
    expect(toDocProposal('', doc, '# New\n')).toBeNull();
    expect(toDocProposal('src/a', { ...doc, action: 'delete' }, null)).toBeNull();
    expect(toDocProposal('src/a', { ...doc, action: 'delete' }, '# Old')).toMatchObject({ action: 'delete', content: '' });
  });

  it('assigns pointers to the branch of their anchor doc or the nearest ancestor', () => {
    const p = (id: string, docPath?: string): DocPointer => ({ id, content: id, docPath, createdAt: '' });
    const map = assignPointersToBranches(
      [p('general'), p('team-a', 'src/a/CLAUDE.md'), p('malvy-a', '.malvy/docs/src/a/CLAUDE.md'), p('deep', 'src/a/x/y/AGENTS.md'), p('root', 'CLAUDE.md')],
      ['', 'src/a']
    );
    expect(map.get('')?.map((x) => x.id)).toEqual(['general', 'root']);
    expect(map.get('src/a')?.map((x) => x.id)).toEqual(['team-a', 'malvy-a', 'deep']);
  });
});
