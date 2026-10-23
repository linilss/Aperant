/**
 * Verify-and-fix step before a batch deploy: after several tasks are merged into the
 * main checkout, run the project's verify command; if it fails because the merged
 * changes collide, let an agent fix it (bounded attempts) and commit the fix.
 * Never runs over uncommitted work in the checkout — that work is the user's.
 */

import { execFileSync } from 'child_process';
import { getToolPath } from './cli-tool-manager';
import { runVerifyCommand, type VerifyCommandResult } from './ai/orchestration/verify-command';
import { runClaudeCliDetailed } from './ai/cli/claude-cli';
import { resolveModelId } from './ai/config/phase-config';
import type { DeployVerifyResult } from '../shared/types';

export const DEPLOY_FIX_ATTEMPTS = 2;

type Verify = (command: string, cwd: string) => Promise<VerifyCommandResult>;
type Fix = (prompt: string, projectPath: string) => Promise<void>;

function git(projectPath: string, args: string[]): string {
  return execFileSync(getToolPath('git'), args, { cwd: projectPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function hasUncommittedChanges(projectPath: string): boolean {
  return git(projectPath, ['status', '--porcelain', '--untracked-files=no', '--', '.', ':(exclude).malvy']).trim() !== '';
}

export function buildFixPrompt(command: string, output: string, mergedTitles: string[]): string {
  return (
    'Several task branches were just merged into this checkout, one after another:\n' +
    `${mergedTitles.map((t) => `- ${t}`).join('\n')}\n\n` +
    `The project verify command now fails:\n\n$ ${command}\n${output}\n\n` +
    'Find the cause — usually the merged changes colliding (renamed or moved symbols, duplicate ' +
    'registrations, mismatched signatures, conflicting migrations) — and fix it with minimal ' +
    'changes that keep the intent of every merged task. Run the verify command yourself until it passes. ' +
    'Do not commit, push, deploy or change git configuration.'
  );
}

async function defaultFix(prompt: string, projectPath: string): Promise<void> {
  await runClaudeCliDetailed({
    prompt,
    cwd: projectPath,
    modelId: resolveModelId('sonnet'),
    allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'],
    maxTurns: 80,
    projectPath,
  });
}

/**
 * Verify the main checkout; on failure try to fix and commit. With no verify command
 * configured this is a no-op success (`skipped`).
 */
export async function verifyAndFixAfterMerge(
  projectPath: string,
  command: string | undefined,
  mergedTitles: string[],
  deps: { verify?: Verify; fix?: Fix; onProgress?: (message: string) => void } = {}
): Promise<DeployVerifyResult> {
  const cmd = command?.trim();
  if (!cmd) return { ok: true, skipped: true };
  const verify = deps.verify ?? ((c: string, cwd: string) => runVerifyCommand(c, cwd));
  const fix = deps.fix ?? defaultFix;

  deps.onProgress?.('Running the verify command');
  let result = await verify(cmd, projectPath);
  if (result.passed) return { ok: true };

  if (hasUncommittedChanges(projectPath)) {
    return { ok: false, output: result.output, reason: 'uncommitted' };
  }

  for (let attempt = 1; attempt <= DEPLOY_FIX_ATTEMPTS; attempt++) {
    deps.onProgress?.(`Fixing the build (attempt ${attempt} of ${DEPLOY_FIX_ATTEMPTS})`);
    await fix(buildFixPrompt(cmd, result.output, mergedTitles), projectPath);
    result = await verify(cmd, projectPath);
    if (result.passed) {
      if (hasUncommittedChanges(projectPath) || git(projectPath, ['status', '--porcelain']).trim()) {
        git(projectPath, ['add', '-A', '--', '.', ':(exclude).malvy']);
        git(projectPath, ['commit', '-m', `Fix build after merging ${mergedTitles.length} task${mergedTitles.length === 1 ? '' : 's'}`]);
      }
      return { ok: true, fixed: true };
    }
  }
  return { ok: false, output: result.output, reason: 'still-failing' };
}
