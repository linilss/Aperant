/**
 * What the Kanban Deploy button runs for a project: its deploy chain, in order.
 *
 * The chain is ProjectSettings.deployChain, else every deploy*.sh found (root first, so a
 * backend deploys before the apps that call it) when each folder has just one — with
 * several in one folder (deploy.sh + deploy-ios.sh + deploy-android.sh) which to run is
 * the user's call, so it falls back to the chosen deployScript, else nothing (ask). A deploy script in a subfolder
 * (e.g. apple/deploy-ios.sh) only runs when files in that folder changed since its last
 * successful run — no new TestFlight build for a web-only change. Other steps (root
 * deploys, smoke tests) always run.
 */

import { execFileSync } from 'child_process';
import path from 'path';
import { getToolPath } from './cli-tool-manager';
import type { DeployPlan, DeployPlanStep, TaskDeployment } from '../shared/types';

export function deployChainFor(
  configured: string[] | undefined,
  discovered: string[],
  deployScript?: string
): string[] {
  const chain = (configured ?? []).map((s) => s.trim()).filter(Boolean);
  if (chain.length > 0) return chain;
  const folders = discovered.map((s) => path.posix.dirname(s));
  if (new Set(folders).size === folders.length) return discovered;
  return deployScript && discovered.includes(deployScript) ? [deployScript] : [];
}

/** Folder a step watches for changes, or null when the step always runs */
export function watchedFolder(script: string): string | null {
  const dir = path.posix.dirname(script);
  return dir !== '.' && /^deploy/i.test(path.posix.basename(script)) ? dir : null;
}

/** Commit each step last ran successfully at (newest deploy wins) */
export function lastSuccessfulCommits(deployments: TaskDeployment[]): Map<string, string> {
  const result = new Map<string, { at: string; commit: string }>();
  for (const d of deployments) {
    if (!d.commit || !d.stepsOk) continue;
    for (const step of d.stepsOk) {
      const prev = result.get(step);
      if (!prev || prev.at < d.at) result.set(step, { at: d.at, commit: d.commit });
    }
  }
  return new Map([...result].map(([step, v]) => [step, v.commit]));
}

export function planDeploySteps(
  chain: string[],
  lastOk: Map<string, string>,
  changedSince: (commit: string, folder: string) => boolean | null
): DeployPlanStep[] {
  return chain.map((script) => {
    const folder = watchedFolder(script);
    if (!folder) return { script, run: true, reason: 'always' };
    const last = lastOk.get(script);
    if (!last) return { script, folder, run: true, reason: 'first' };
    const changed = changedSince(last, folder);
    if (changed === null) return { script, folder, run: true, reason: 'changed' };
    return { script, folder, run: changed, reason: changed ? 'changed' : 'unchanged' };
  });
}

export function buildDeployPlan(
  projectPath: string,
  configured: string[] | undefined,
  discovered: string[],
  deployments: TaskDeployment[],
  deployScript?: string
): DeployPlan {
  const git = (args: string[]) =>
    execFileSync(getToolPath('git'), args, { cwd: projectPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  let commit = '';
  try {
    commit = git(['rev-parse', 'HEAD']);
  } catch {
    commit = '';
  }
  const steps = planDeploySteps(deployChainFor(configured, discovered, deployScript), lastSuccessfulCommits(deployments), (from, folder) => {
    try {
      return git(['diff', '--name-only', `${from}..HEAD`, '--', folder]) !== '';
    } catch {
      return null;
    }
  });
  return { steps, commit };
}
