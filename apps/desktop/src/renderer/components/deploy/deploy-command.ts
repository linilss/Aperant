import { escapeShellPath } from '../../../shared/utils/shell-escape';
import type { DeployScript } from '../../../shared/types';

/** Shell command that runs a deploy script from the project root. */
export function buildDeployCommand(script: DeployScript, args: string): string {
  const trimmed = args.trim();
  return `bash ${escapeShellPath(`./${script.relativePath}`)}${trimmed ? ` ${trimmed}` : ''}`;
}

/**
 * Runs the deploy script in a clean checkout (see prepareDeployCheckout), then copies any
 * tracked files the script changed there (e.g. a version bump) back into the project, where
 * a normal deploy would have left them, and returns to the project root.
 */
export function buildCleanCheckoutDeployCommand(
  script: DeployScript,
  args: string,
  checkoutPath: string,
  projectPath: string
): string {
  const checkout = escapeShellPath(checkoutPath);
  const project = escapeShellPath(projectPath);
  const copyBack = `git diff --quiet || { git diff --binary | git -C ${project} apply --3way && echo "==> Copied the script's file changes back to the project" || echo "==> The script changed files in the clean checkout; copy them back by hand"; }`;
  return `cd ${checkout} && { ${buildDeployCommand(script, args)}; ${copyBack}; }; cd ${project}`;
}

/**
 * Wraps a deploy command so its output is also written to `<project>/<logRel>`, ending
 * with an exit-code marker Malvy reads back (see main/deploy-log.ts). Runs in bash with
 * pipefail so the marker carries the script's own exit code, whatever the user's shell.
 */
export function withDeployLog(command: string, projectPath: string, logRel: string): string {
  const log = `${projectPath.replace(/\/$/, '')}/${logRel}`;
  const dir = log.slice(0, log.lastIndexOf('/'));
  const inner =
    `mkdir -p ${escapeShellPath(dir)}; set -o pipefail; { ${command}; } 2>&1 | tee ${escapeShellPath(log)}; ` +
    `echo "__MALVY_DEPLOY_EXIT=$?" >> ${escapeShellPath(log)}`;
  return `bash -c ${escapeShellPath(inner)}`;
}

/** New log path for a deploy run, relative to the project root */
export function newDeployLogPath(now = new Date()): string {
  return `.malvy/deploys/${now.toISOString().replace(/[:.]/g, '-')}.log`;
}
