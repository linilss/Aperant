import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../cli-tool-manager', () => ({ getToolPath: () => 'git' }));
vi.mock('../ai/cli/claude-cli', () => ({ runClaudeCliDetailed: vi.fn() }));

import { commandIsFromRunbook, parsePlan, readDeployHistory, runDeploy } from '../deploy-runner';
import { extractClaudeMdDeployRules, parseVerifyCommands, seedRunbook, writeRunbook } from '../deploy-runbook';
import type { DeployRunRecord } from '../../shared/types';

let dir: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf-8' }).trim();
const script = (rel: string, body: string) => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), `#!/bin/bash\n${body}\n`);
  chmodSync(path.join(dir, rel), 0o755);
};
const RUNBOOK = '# Deploy\n\n## Steps\n\n1. **web**: `./deploy.sh`\n2. **ios**: `./apple/deploy-ios.sh` — only if apple/ changed\n\n## Verify\n\n```bash\ntest -f deployed.txt\n```\n';
const record = (): DeployRunRecord => ({
  id: 'run1', startedAt: new Date().toISOString(), status: 'running', commit: git('rev-parse', 'HEAD'), taskIds: ['t1'], log: '.malvy/deploys/run1.log'
});
const plan = (steps: unknown[]) => async () => `<deploy_plan>${JSON.stringify(steps)}</deploy_plan>`;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'deploy-runner-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(path.join(dir, '.gitignore'), '.malvy/\ndeployed.txt\n');
  script('deploy.sh', 'echo "Live: v42"; touch deployed.txt');
  script('apple/deploy-ios.sh', 'echo "==> Version 1.0.4 -> 1.0.5"; echo "TestFlight: 1.0.5 (202610140900) is VALID"');
  git('add', '.');
  git('commit', '-qm', 'init');
  writeRunbook(dir, RUNBOOK);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('runbook parsing', () => {
  it('reads Verify commands from fences and bullets', () => {
    expect(parseVerifyCommands(RUNBOOK)).toEqual(['test -f deployed.txt']);
    expect(parseVerifyCommands('## Verify\n- `curl -fsS https://x/health`\n- note')).toEqual(['curl -fsS https://x/health']);
  });

  it('seeds steps root first, conditional subfolders, and quotes CLAUDE.md rules', () => {
    const claudeMd = '# P\n\n## Definition of done\n1. `./deploy.sh`\n2. Commit + push to `main`.\n\n## Other\nx';
    expect(extractClaudeMdDeployRules(claudeMd)).toContain('Commit + push');
    const seeded = seedRunbook('Trainr', ['deploy.sh', 'apple/deploy-ios.sh'], ['scripts/smoke-prod.sh'], claudeMd);
    expect(seeded.indexOf('./deploy.sh')).toBeLessThan(seeded.indexOf('./scripts/smoke-prod.sh'));
    expect(seeded).toContain('only if files under `apple/` changed');
    expect(seeded).toContain('git push origin HEAD');
    expect(seeded).toContain('## Verify');
  });
});

describe('plan validation', () => {
  it('only accepts commands the runbook names', () => {
    expect(commandIsFromRunbook('./deploy.sh', RUNBOOK)).toBe(true);
    expect(commandIsFromRunbook('bash ./apple/deploy-ios.sh', RUNBOOK)).toBe(true);
    expect(commandIsFromRunbook('rm -rf /', RUNBOOK)).toBe(false);
    expect(commandIsFromRunbook('git push origin HEAD', RUNBOOK)).toBe(false);
    expect(parsePlan('<deploy_plan>[{"name":"x","command":"./evil.sh"}]</deploy_plan>', RUNBOOK)).toBeNull();
  });
});

describe('runDeploy', () => {
  it('runs the planned steps, skips the rest, verifies and records versions', async () => {
    const r = record();
    const out = await runDeploy({
      projectPath: dir, cwd: dir, cleanCheckout: false, taskTitles: ['A'], record: r,
      plan: plan([
        { name: 'web', command: './deploy.sh', run: true, reason: 'always' },
        { name: 'ios', command: './apple/deploy-ios.sh', run: false, reason: 'apple unchanged' }
      ])
    });
    expect(out.status).toBe('succeeded');
    expect(out.steps?.map((s) => [s.name, s.run, s.exitCode])).toEqual([['web', true, 0], ['ios', false, undefined]]);
    expect(out.version).toBe('v42');
    expect(readDeployHistory(dir)[0].status).toBe('succeeded');
    expect(readFileSync(path.join(dir, out.log), 'utf-8')).toContain('SKIP ios');
  });

  it('fails when a verify command fails even though the steps passed', async () => {
    script('deploy.sh', 'echo ok');
    git('commit', '-qam', 'no marker');
    const out = await runDeploy({
      projectPath: dir, cwd: dir, cleanCheckout: false, taskTitles: [], record: record(),
      plan: plan([{ name: 'web', command: './deploy.sh', run: true }])
    });
    expect(out.status).toBe('failed');
    expect(out.reason).toContain('Verify failed');
  });

  it('lets an agent fix a code failure, commits it and re-runs the step', async () => {
    script('deploy.sh', 'test -f fixed.txt || { echo "error CS1002"; exit 1; }; touch deployed.txt');
    git('commit', '-qam', 'needs fix');
    const fix = vi.fn(async () => {
      writeFileSync(path.join(dir, 'fixed.txt'), 'x');
      return 'FIXED: added the missing file';
    });
    const out = await runDeploy({
      projectPath: dir, cwd: dir, cleanCheckout: false, taskTitles: [], record: record(),
      plan: plan([{ name: 'web', command: './deploy.sh', run: true }]), fix
    });
    expect(fix).toHaveBeenCalledTimes(1);
    expect(out.reason).toBeUndefined();
    expect(out.status).toBe('succeeded');
    expect(out.fixed).toBe(true);
    expect(git('log', '-1', '--format=%s')).toContain('Fix deploy step web');
  });

  it('stops when the failure is not a code problem', async () => {
    script('deploy.sh', 'echo "az: please run az login"; exit 1');
    git('commit', '-qam', 'auth');
    const out = await runDeploy({
      projectPath: dir, cwd: dir, cleanCheckout: false, taskTitles: [], record: record(),
      plan: plan([{ name: 'web', command: './deploy.sh', run: true }]),
      fix: async () => 'NOT_FIXABLE: Azure login expired'
    });
    expect(out.status).toBe('failed');
    expect(out.reason).toContain('Azure login expired');
  });

  it('commits version bumps a step makes', async () => {
    writeFileSync(path.join(dir, 'version.txt'), '1.0.4\n');
    script('apple/deploy-ios.sh', 'echo 1.0.5 > version.txt; echo "==> Version 1.0.4 -> 1.0.5"; echo "TestFlight: 1.0.5 (202610140900) is VALID"; touch deployed.txt');
    git('add', '.');
    git('commit', '-qm', 'version file');
    const out = await runDeploy({
      projectPath: dir, cwd: dir, cleanCheckout: false, taskTitles: [], record: record(),
      plan: plan([{ name: 'ios', command: './apple/deploy-ios.sh', run: true }])
    });
    expect(out).toMatchObject({ status: 'succeeded', version: '1.0.5', build: '202610140900' });
    expect(git('log', '-1', '--format=%s')).toBe('Release 1.0.5 (build 202610140900)');
    expect(git('status', '--porcelain')).toBe('');
  });
});
