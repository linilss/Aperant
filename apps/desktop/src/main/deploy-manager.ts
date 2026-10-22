/**
 * Starts and tracks runbook deploys per project (one at a time), keeps the tasks'
 * deployment entries in step with the run, and works out which merged tasks are not live.
 */

import { execFileSync } from 'child_process';
import { appendFileSync, existsSync } from 'fs';
import path from 'path';
import { getToolPath } from './cli-tool-manager';
import { projectStore } from './project-store';
import { getSpecsDir } from '../shared/constants';
import { findAllSpecPaths } from './utils/spec-path-helpers';
import { appendTaskDeployment, updateTaskDeployment } from './task-deployments';
import { DEPLOY_DIR, readDeployHistory, replaceDeployRecords, runDeploy } from './deploy-runner';
import { isTaskNotLive } from '../shared/utils/task-deployments';
import { isRestartPending } from './safe-restart';
import type { DeployRunRecord, Project } from '../shared/types';

const active = new Map<string, { record: DeployRunRecord; abort: AbortController }>();

function git(cwd: string, args: string[]): string {
  return execFileSync(getToolPath('git'), args, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 }).trim();
}

/**
 * A detached worktree at the project's HEAD (`<autoBuildPath>/worktrees/deploy`), reset and
 * cleaned of untracked files, so a deploy builds exactly what is committed while someone has
 * uncommitted work in the main checkout. Ignored files (build caches) are kept.
 */
export function prepareDeployCheckout(projectPath: string, autoBuildPath: string): string {
  const head = git(projectPath, ['rev-parse', 'HEAD']);
  const checkout = path.join(projectPath, autoBuildPath, 'worktrees', 'deploy');
  let reusable = false;
  if (existsSync(checkout)) {
    try {
      reusable = git(checkout, ['rev-parse', '--is-inside-work-tree']) === 'true';
    } catch {
      reusable = false;
    }
  }
  if (reusable) {
    git(checkout, ['checkout', '--detach', '--force', head]);
    git(checkout, ['clean', '-fdq']);
  } else {
    git(projectPath, ['worktree', 'prune']);
    git(projectPath, ['worktree', 'add', '--detach', '--force', checkout, head]);
  }
  return checkout;
}


function specPathsFor(project: Project, taskId: string): string[] {
  return findAllSpecPaths(project.path, getSpecsDir(project.autoBuildPath), taskId);
}

function syncTasks(project: Project, record: DeployRunRecord): void {
  for (const taskId of record.taskIds) {
    updateTaskDeployment(specPathsFor(project, taskId), record.id, {
      status: record.status,
      ...(record.version ? { version: record.version } : {}),
      ...(record.build ? { build: record.build } : {}),
      ...(record.webVersion ? { webVersion: record.webVersion } : {}),
      ...(record.summary ? { summary: record.summary } : {}),
      ...(record.reason ? { reason: record.reason } : {}),
      ...(record.steps ? { stepsOk: record.steps.filter((s) => s.run && s.exitCode === 0).map((s) => s.name) } : {})
    });
  }
  projectStore.invalidateTasksCache(project.id);
}

export function getActiveDeploy(projectId: string): DeployRunRecord | null {
  const run = active.get(projectId);
  return run ? { ...run.record } : null;
}

/** History with runs that were running when Malvy stopped marked failed (and their tasks). */
export function getDeployHistory(project: Project): DeployRunRecord[] {
  const history = readDeployHistory(project.path);
  const running = active.get(project.id)?.record.id;
  const interrupted: DeployRunRecord[] = [];
  const result = history.map((r) => {
    if (r.status !== 'running' || r.id === running) return r;
    const failed: DeployRunRecord = { ...r, status: 'failed', reason: 'Interrupted (Malvy stopped during the deploy)', phase: undefined };
    syncTasks(project, failed);
    interrupted.push(failed);
    return failed;
  });
  // Persist it, so the run doesn't look running to anything reading the file (the restart script)
  if (interrupted.length > 0) {
    try {
      replaceDeployRecords(project.path, interrupted);
    } catch {
      // best effort: the next read marks it again
    }
  }
  return result;
}

export function cancelDeploy(projectId: string): boolean {
  const run = active.get(projectId);
  if (!run) return false;
  run.abort.abort();
  return true;
}

/**
 * Start a deploy for the project. Deploys the main branch, so every merged task that is not
 * live yet is included along with the requested ones.
 */
export function startDeploy(project: Project, requestedTaskIds: string[], onUpdate?: (r: DeployRunRecord) => void): DeployRunRecord {
  if (active.has(project.id)) throw new Error('A deploy is already running for this project');
  if (isRestartPending()) throw new Error('Malvy is restarting. Start the deploy again in a minute.');

  const tasks = projectStore.getTasks(project.id);
  const taskIds = [...new Set([...requestedTaskIds, ...tasks.filter(isTaskNotLive).map((t) => t.id)])];
  const taskTitles = taskIds.map((id) => tasks.find((t) => t.id === id)?.title ?? id);

  // Deploys ship the main branch: refuse when the checkout is on another one
  const current = git(project.path, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const mainBranch =
    project.settings?.mainBranch?.trim() ||
    ['main', 'master'].find((b) => {
      try {
        git(project.path, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`]);
        return true;
      } catch {
        return false;
      }
    }) ||
    'main';
  if (current !== mainBranch) throw new Error(`The project is on ${current}, not ${mainBranch}. Switch back before deploying.`);

  const dirty = git(project.path, ['status', '--porcelain', '--untracked-files=no', '--', '.', ':(exclude).malvy']) !== '';
  const cwd = dirty ? prepareDeployCheckout(project.path, project.autoBuildPath || '.malvy') : project.path;
  const startedAt = new Date().toISOString();
  const id = startedAt.replace(/[:.]/g, '-');
  const record: DeployRunRecord = {
    id,
    startedAt,
    status: 'running',
    phase: 'planning',
    commit: git(cwd, ['rev-parse', 'HEAD']),
    taskIds,
    log: `${DEPLOY_DIR}/${id}.log`,
    ...(dirty ? { cleanCheckout: true } : {})
  };

  for (const taskId of taskIds) {
    appendTaskDeployment(specPathsFor(project, taskId), {
      script: '.malvy/deploy.md',
      at: startedAt,
      deployId: id,
      log: record.log,
      status: 'running',
      commit: record.commit
    });
  }
  projectStore.invalidateTasksCache(project.id);

  const abort = new AbortController();
  active.set(project.id, { record, abort });
  void runDeploy({ projectPath: project.path, cwd, cleanCheckout: dirty, taskTitles, record, abortSignal: abort.signal, onUpdate })
    .catch((err) => {
      // A crash inside the run (e.g. the planning agent failing to start) must still end
      // up in the history with its reason, or it later reads as "Interrupted"
      record.status = 'failed';
      record.reason = err instanceof Error ? err.message : String(err);
      record.finishedAt = new Date().toISOString();
      record.phase = undefined;
      console.warn(`[Deploy] ${project.name} ${record.id} crashed: ${record.reason}`);
      try {
        appendFileSync(path.join(project.path, record.log), `\n==> Deploy failed: ${record.reason}\n`);
        replaceDeployRecords(project.path, [record]);
      } catch {
        // best effort
      }
      return record;
    })
    .then((final) => {
      if (dirty) {
        // Version bumps the scripts made in the clean copy go back to the project, uncommitted
        try {
          const patch = execFileSync(getToolPath('git'), ['diff', '--binary'], { cwd, encoding: 'utf-8' });
          if (patch.trim()) execFileSync(getToolPath('git'), ['apply', '--3way'], { cwd: project.path, input: patch });
        } catch {
          /* leave the changes in the clean copy */
        }
      }
      syncTasks(project, final);
      onUpdate?.({ ...final });
    })
    .finally(() => active.delete(project.id));

  return { ...record };
}
