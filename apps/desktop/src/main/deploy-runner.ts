/**
 * Runbook-driven deploys started by the Kanban Deploy button.
 *
 * 1. A planning agent (read-only tools) reads `.malvy/deploy.md` plus what changed since
 *    the last verified deploy and returns the steps to run now (conditions applied).
 *    Every command must come from the runbook — Malvy rejects anything else.
 * 2. Malvy runs the steps itself, in order, logging to `.malvy/deploys/<id>.log`, and reads
 *    exit codes directly. Agents never deploy or push (the release guard stays on).
 * 3. A failing step gets up to two fix attempts by a guarded agent (code fixes only,
 *    committed), then Malvy re-runs it. Failures outside the code stop the deploy.
 * 4. Malvy runs the runbook's Verify commands. Only then does the deploy count as live.
 */

import { execFileSync } from 'child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { getToolPath } from './cli-tool-manager';
import { runVerifyCommand } from './ai/orchestration/verify-command';
import { runClaudeCliDetailed } from './ai/cli/claude-cli';
import { resolveModelId } from './ai/config/phase-config';
import { parseVerifyCommands, readRunbook } from './deploy-runbook';
import { parseDeployLog } from './deploy-log';
import type { DeployRunRecord, DeployRunStep } from '../shared/types';

export const DEPLOY_DIR = '.malvy/deploys';
const HISTORY_FILE = 'history.json';
const HISTORY_CAP = 50;
const STEP_TIMEOUT_MS = 90 * 60 * 1000;
const FIX_ATTEMPTS = 2;

export interface PlannedStep {
  name: string;
  command: string;
  run: boolean;
  reason: string;
}

// ------------------------------------------------------------------ history

export function readDeployHistory(projectPath: string): DeployRunRecord[] {
  const file = path.join(projectPath, DEPLOY_DIR, HISTORY_FILE);
  try {
    const data = JSON.parse(readFileSync(file, 'utf-8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeRecord(projectPath: string, record: DeployRunRecord): void {
  const dir = path.join(projectPath, DEPLOY_DIR);
  mkdirSync(dir, { recursive: true });
  const rest = readDeployHistory(projectPath).filter((r) => r.id !== record.id);
  writeFileSync(path.join(dir, HISTORY_FILE), JSON.stringify([record, ...rest].slice(0, HISTORY_CAP), null, 2), 'utf-8');
}

export function lastVerifiedDeploy(history: DeployRunRecord[]): DeployRunRecord | undefined {
  return history.find((r) => r.status === 'succeeded' && r.commit);
}

// ------------------------------------------------------------------ planning

/** A planned command is accepted only if the runbook names it (its script path, or `git push`). */
export function commandIsFromRunbook(command: string, runbook: string): boolean {
  const cmd = command.trim();
  if (!cmd) return false;
  if (/^git\s+push\b/.test(cmd)) return /git push/.test(runbook);
  if (runbook.includes(cmd)) return true;
  // `./x.sh args`, `bash ./x.sh`, `sh scripts/x.sh`: the script itself must be in the runbook
  const tokens = cmd.split(/\s+/).map((t) => t.replace(/^['"]|['"]$/g, ''));
  const first = /^(bash|sh|zsh)$/.test(tokens[0] ?? '') ? tokens[1] : tokens[0];
  const target = (first ?? '').replace(/^\.\//, '');
  if (!/^[\w.-]+(\/[\w.-]+)*$/.test(target) || !/[A-Za-z]/.test(target) || target.startsWith('-')) return false;
  if (!target.includes('/') && !/\.(sh|py|js|ts|rb)$/.test(target)) return false;
  return runbook.includes(target);
}

export function parsePlan(text: string, runbook: string): PlannedStep[] | null {
  const match = text.match(/<deploy_plan>([\s\S]*?)<\/deploy_plan>/);
  if (!match) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(match[1].trim());
  } catch {
    return null;
  }
  const items = Array.isArray(raw) ? raw : (raw as { steps?: unknown })?.steps;
  if (!Array.isArray(items)) return null;
  const steps: PlannedStep[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') return null;
    const s = item as Record<string, unknown>;
    const name = String(s.name ?? '').trim();
    const command = String(s.command ?? '').trim();
    if (!name || !command || !commandIsFromRunbook(command, runbook)) return null;
    steps.push({ name, command, run: s.run !== false, reason: String(s.reason ?? '') });
  }
  return steps;
}

function git(cwd: string, args: string[]): string {
  return execFileSync(getToolPath('git'), args, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

export function changeContext(projectPath: string, sinceCommit: string | undefined): string {
  if (!sinceCommit) return 'No previous verified deploy is known: treat every conditional step as needed.';
  try {
    const log = git(projectPath, ['log', '--oneline', '-40', `${sinceCommit}..HEAD`]);
    const files = git(projectPath, ['diff', '--name-only', `${sinceCommit}..HEAD`]).split('\n').filter(Boolean);
    if (!log && files.length === 0) return `Nothing changed since the last verified deploy (${sinceCommit.slice(0, 8)}).`;
    return (
      `Changes since the last verified deploy (${sinceCommit.slice(0, 8)}):\n${log}\n\n` +
      `Changed files (${files.length}):\n${files.slice(0, 300).join('\n')}${files.length > 300 ? '\n…' : ''}`
    );
  } catch {
    return 'The last verified deploy commit is not in this history: treat every conditional step as needed.';
  }
}

export function buildPlanPrompt(runbook: string, context: string, taskTitles: string[]): string {
  return (
    'You plan a deploy. Read the runbook and decide which of its steps to run now.\n\n' +
    `## Runbook (.malvy/deploy.md)\n\n${runbook}\n\n## What is being deployed\n\n` +
    `${taskTitles.length ? `Tasks: ${taskTitles.join('; ')}\n\n` : ''}${context}\n\n` +
    '## Rules\n' +
    '- Use only steps from the runbook, in its order, with the exact commands it gives (relative to the repo root).\n' +
    '- Apply each step\'s conditions to the changes above; when unsure, run the step. Never drop an unconditional step.\n' +
    '- You may read files to judge a condition. Do not run anything.\n' +
    '- Answer with only:\n<deploy_plan>[{"name": "web", "command": "./deploy.sh", "run": true, "reason": "backend changed"}]</deploy_plan>\n' +
    'Include every runbook step, with "run": false and the reason for the ones you skip.'
  );
}

// ------------------------------------------------------------------ runner

export interface DeployRunOptions {
  projectPath: string;
  /** Where steps run: the project root, or a clean checkout when the root has uncommitted work */
  cwd: string;
  cleanCheckout: boolean;
  taskTitles: string[];
  record: DeployRunRecord;
  abortSignal?: AbortSignal;
  onUpdate?: (record: DeployRunRecord) => void;
  /** Injection points for tests */
  plan?: (prompt: string) => Promise<string>;
  fix?: (prompt: string) => Promise<string>;
}

const tail = (text: string, lines = 80) => text.split('\n').slice(-lines).join('\n');

/** Run a deploy to completion; resolves to the final record (also written to history). */
export async function runDeploy(options: DeployRunOptions): Promise<DeployRunRecord> {
  const { projectPath, cwd, record } = options;
  const logFile = path.join(projectPath, record.log);
  mkdirSync(path.dirname(logFile), { recursive: true });
  const log = (line: string) => appendFileSync(logFile, line.endsWith('\n') ? line : `${line}\n`);
  const update = (patch: Partial<DeployRunRecord>) => {
    Object.assign(record, patch);
    writeRecord(projectPath, record);
    options.onUpdate?.({ ...record });
  };
  const fail = (reason: string) => {
    log(`\n==> Deploy failed: ${reason}`);
    update({ status: 'failed', reason, finishedAt: new Date().toISOString(), phase: undefined, currentStep: undefined });
    return record;
  };

  const runbook = readRunbook(projectPath);
  if (!runbook) return fail('No deploy runbook (.malvy/deploy.md). Create it under Ship → Deploy.');

  // 1. Plan
  update({ phase: 'planning' });
  log(`==> Planning from .malvy/deploy.md (commit ${record.commit.slice(0, 8)})`);
  const context = changeContext(projectPath, lastVerifiedDeploy(readDeployHistory(projectPath).filter((r) => r.id !== record.id))?.commit);
  const planPrompt = buildPlanPrompt(runbook, context, options.taskTitles);
  const planText = options.plan
    ? await options.plan(planPrompt)
    : (
        await runClaudeCliDetailed({
          prompt: planPrompt,
          cwd: projectPath,
          modelId: resolveModelId('sonnet'),
          allowedTools: ['Read', 'Glob', 'Grep'],
          restrictTools: true,
          maxTurns: 25,
          projectPath,
          abortSignal: options.abortSignal
        })
      ).text;
  const planned = parsePlan(planText, runbook);
  if (!planned) return fail('Could not plan the deploy from the runbook (no valid plan, or a command not in the runbook).');
  const isPush = (command: string) => /^git\s+push\b/.test(command);
  const steps: DeployRunStep[] = planned.map((p) =>
    options.cleanCheckout && isPush(p.command) && p.run
      ? { name: p.name, command: p.command, run: false, reason: 'the project has uncommitted work, so Malvy deploys from a clean copy and does not push' }
      : { name: p.name, command: p.command, run: p.run, reason: p.reason }
  );
  // Files the deploy itself changes (version bumps) get committed before a push and at the end
  const commitDeployChanges = (message: string) => {
    if (options.cleanCheckout) return;
    if (git(cwd, ['status', '--porcelain', '--untracked-files=no', '--', '.', ':(exclude).malvy'])) {
      git(cwd, ['add', '-u', '--', '.', ':(exclude).malvy']);
      git(cwd, ['commit', '-m', message]);
      log(`==> Committed: ${message}`);
    }
  };
  const releaseMessage = () => {
    const parsed = parseDeployLog(`${existsSync(logFile) ? readFileSync(logFile, 'utf-8') : ''}\n__MALVY_DEPLOY_EXIT=0`);
    return parsed.version ? `Release ${parsed.version}${parsed.build ? ` (build ${parsed.build})` : ''}` : 'Deploy: version bump';
  };
  update({ steps });
  for (const s of steps) log(`    ${s.run ? 'RUN ' : 'SKIP'} ${s.name}: ${s.command}${s.reason ? ` — ${s.reason}` : ''}`);
  if (!steps.some((s) => s.run)) return fail('The plan runs no steps.');

  // 2. Run steps (3. fix on failure)
  update({ phase: 'running' });
  for (const step of steps.filter((s) => s.run)) {
    if (options.abortSignal?.aborted) return fail('Cancelled');
    if (isPush(step.command)) {
      try {
        commitDeployChanges(releaseMessage());
      } catch (err) {
        return fail(`Could not commit the deploy's version changes: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    for (let attempt = 0; ; attempt++) {
      update({ currentStep: step.name });
      log(`\n==> Step ${step.name}: ${step.command}${attempt > 0 ? ` (retry ${attempt})` : ''}`);
      const result = await runVerifyCommand(step.command, cwd, {
        timeoutMs: STEP_TIMEOUT_MS,
        abortSignal: options.abortSignal,
        onOutput: (chunk) => appendFileSync(logFile, chunk),
        maxLines: 120
      });
      step.exitCode = result.exitCode ?? -1;
      update({ steps });
      if (result.passed) break;
      log(`==> Step ${step.name} failed (exit ${result.exitCode ?? '?'}${result.timedOut ? ', timed out' : ''})`);
      if (options.cleanCheckout || attempt >= FIX_ATTEMPTS || options.abortSignal?.aborted) {
        return fail(`Step "${step.name}" failed${options.cleanCheckout ? ' (no fixes while deploying from a clean copy)' : ''}: ${tail(result.output, 3)}`);
      }
      update({ phase: 'fixing' });
      log(`==> Asking an agent to fix step ${step.name} (attempt ${attempt + 1} of ${FIX_ATTEMPTS})`);
      const fixPrompt =
        `A deploy step failed.\n\nStep: ${step.name}\nCommand: ${step.command}\n\nOutput (tail):\n${tail(result.output)}\n\n` +
        'If the failure is caused by the code in this repository (build error, failing test, broken config the code owns), ' +
        'fix it with minimal changes that keep the intent of recent work, and verify locally (build/tests). ' +
        'Never edit deploy scripts or infrastructure to make the step pass, never deploy, push or run the step yourself. ' +
        'If the cause is outside the code (credentials, network, signing, a service outage), change nothing. ' +
        'End with exactly one line: FIXED: <what you changed> or NOT_FIXABLE: <why>.';
      const fixText = options.fix
        ? await options.fix(fixPrompt)
        : (
            await runClaudeCliDetailed({
              prompt: fixPrompt,
              cwd,
              modelId: resolveModelId('sonnet'),
              allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'],
              maxTurns: 80,
              projectPath,
              abortSignal: options.abortSignal
            })
          ).text;
      const verdict = fixText.match(/^(FIXED|NOT_FIXABLE):\s*(.*)$/m);
      log(`==> Fix agent: ${verdict ? `${verdict[1]}: ${verdict[2]}` : 'no verdict'}`);
      if (!verdict || verdict[1] !== 'FIXED') {
        return fail(`Step "${step.name}" failed and isn't a code problem: ${verdict?.[2] ?? tail(result.output, 2)}`);
      }
      try {
        if (git(cwd, ['status', '--porcelain', '--', '.', ':(exclude).malvy'])) {
          // .malvy is git-excluded in every Malvy project, so `add -A .` never picks it up
          git(cwd, ['add', '-A', '.']);
          git(cwd, ['commit', '-m', `Fix deploy step ${step.name}: ${verdict[2].slice(0, 60)}`]);
        }
      } catch (err) {
        return fail(`Could not commit the fix: ${err instanceof Error ? err.message : String(err)}`);
      }
      update({ phase: 'running', fixed: true });
    }
  }

  // 4. Verify
  const verifyCommands = parseVerifyCommands(runbook);
  if (verifyCommands.length > 0) {
    update({ phase: 'verifying', currentStep: undefined });
    for (const command of verifyCommands) {
      log(`\n==> Verify: ${command}`);
      const result = await runVerifyCommand(command, cwd, { onOutput: (chunk) => appendFileSync(logFile, chunk) });
      if (!result.passed) return fail(`Verify failed: ${command}`);
    }
  }

  try {
    commitDeployChanges(releaseMessage());
  } catch (err) {
    log(`==> Could not commit the deploy's version changes: ${err instanceof Error ? err.message : String(err)}`);
  }
  const parsed = parseDeployLog(`${existsSync(logFile) ? readFileSync(logFile, 'utf-8') : ''}\n__MALVY_DEPLOY_EXIT=0`);
  let commit = record.commit;
  try {
    commit = git(cwd, ['rev-parse', 'HEAD']);
  } catch {
    /* keep planned commit */
  }
  log('\n==> Deploy verified');
  update({
    status: 'succeeded',
    phase: undefined,
    currentStep: undefined,
    finishedAt: new Date().toISOString(),
    commit,
    ...(parsed.version ? { version: parsed.version } : {}),
    ...(parsed.build ? { build: parsed.build } : {}),
    ...(parsed.webVersion ? { webVersion: parsed.webVersion } : {}),
    ...(parsed.summary ? { summary: parsed.summary } : {})
  });
  return record;
}
