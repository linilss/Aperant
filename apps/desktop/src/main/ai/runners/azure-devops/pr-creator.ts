/**
 * Azure DevOps PR Creator
 * =======================
 *
 * Creates Azure DevOps Pull Requests via the REST API.
 * Uses the PAT token from the project's .malvy/.env file.
 *
 * Steps:
 * 1. Push the worktree branch to origin via git
 * 2. Resolve the repo ID from the Azure DevOps API
 * 3. Create the PR via POST /git/repositories/{repoId}/pullrequests
 * 4. Return the PR URL
 */

import { execFileSync } from 'node:child_process';
import type { Project } from '../../../../shared/types';
import { getAzureDevOpsConfig, buildBasicAuth } from '../../../ipc-handlers/azure-devops/utils';

// Re-export result type shape matching GitHub PR creator for handler compatibility
export interface AzurePRResult {
  success: boolean;
  prUrl?: string;
  alreadyExists?: boolean;
  error?: string;
}

const ADO_API_VERSION = '7.1';
const ADO_TIMEOUT_MS = 30_000;

async function adoPost(
  orgUrl: string,
  project: string,
  endpoint: string,
  token: string,
  body: unknown,
): Promise<unknown> {
  const url = `${orgUrl}/${encodeURIComponent(project)}/_apis${endpoint}?api-version=${ADO_API_VERSION}`;
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), ADO_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: buildBasicAuth(token),
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Azure DevOps API ${res.status}: ${text}`);
    }
    return JSON.parse(text) as unknown;
  } finally {
    clearTimeout(tid);
  }
}

async function adoGet(
  orgUrl: string,
  project: string,
  endpoint: string,
  token: string,
): Promise<unknown> {
  const url = `${orgUrl}/${encodeURIComponent(project)}/_apis${endpoint}?api-version=${ADO_API_VERSION}`;
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), ADO_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Authorization: buildBasicAuth(token) },
    });
    if (!res.ok) throw new Error(`Azure DevOps API ${res.status}: ${await res.text()}`);
    return res.json() as unknown;
  } finally {
    clearTimeout(tid);
  }
}

function pushBranch(worktreePath: string, gitPath: string, branchName: string, specId: string): string | undefined {
  try {
    // Auto-commit any work the agent left unstaged (e.g. if the coder exited before git commit)
    const statusOutput = execFileSync(gitPath, ['status', '--porcelain'], {
      cwd: worktreePath,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();
    if (statusOutput) {
      execFileSync(gitPath, ['add', '.'], {
        cwd: worktreePath,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      execFileSync(gitPath, ['commit', '-m', 'Save uncommitted work'], {
        cwd: worktreePath,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    }

    execFileSync(gitPath, ['push', '--set-upstream', 'origin', branchName], {
      cwd: worktreePath,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return undefined;
  } catch (err) {
    const spawnErr = err as { stderr?: string };
    const stderr = String(spawnErr.stderr ?? err);
    const isUpToDate = stderr.includes('Everything up-to-date') || stderr.includes('up to date');
    return isUpToDate ? undefined : stderr;
  }
}

export async function createAzureDevOpsPR(opts: {
  project: Project;
  worktreePath: string;
  branchName: string;
  baseBranch: string;
  title: string;
  description?: string;
  draft?: boolean;
  gitPath: string;
  adoInfo: { orgUrl: string; project: string; repo: string };
}): Promise<AzurePRResult> {
  const { project, worktreePath, branchName, baseBranch, title, description, draft, gitPath, adoInfo } = opts;

  // Get PAT from project env
  const config = await getAzureDevOpsConfig(project);
  if (!config) {
    return { success: false, error: 'Azure DevOps is not configured for this project. Add AZURE_DEVOPS_TOKEN, AZURE_DEVOPS_ORG_URL, and AZURE_DEVOPS_PROJECT to .malvy/.env' };
  }

  // Push branch (auto-commits any uncommitted work first)
  const pushError = pushBranch(worktreePath, gitPath, branchName, branchName);
  if (pushError) {
    return { success: false, error: `Failed to push branch: ${pushError}` };
  }

  const sourceRef = `refs/heads/${branchName}`;
  const targetRef = `refs/heads/${baseBranch.startsWith('origin/') ? baseBranch.slice(7) : baseBranch}`;

  // Resolve repo ID
  let repoId: string;
  try {
    const repos = await adoGet(config.orgUrl, adoInfo.project, '/git/repositories', config.token) as { value?: Array<{ id: string; name: string }> };
    const repo = repos.value?.find((r) => r.name.toLowerCase() === adoInfo.repo.toLowerCase());
    if (!repo) {
      return { success: false, error: `Repository "${adoInfo.repo}" not found in Azure DevOps project "${adoInfo.project}"` };
    }
    repoId = repo.id;
  } catch (err) {
    return { success: false, error: `Failed to resolve repo: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Create PR
  try {
    const pr = await adoPost(
      config.orgUrl,
      adoInfo.project,
      `/git/repositories/${repoId}/pullrequests`,
      config.token,
      {
        title,
        description: description ?? '',
        sourceRefName: sourceRef,
        targetRefName: targetRef,
        isDraft: draft ?? false,
      },
    ) as { pullRequestId?: number; url?: string };

    const prId = pr.pullRequestId;
    const prUrl = prId
      ? `${config.orgUrl}/${encodeURIComponent(adoInfo.project)}/_git/${encodeURIComponent(adoInfo.repo)}/pullrequest/${prId}`
      : undefined;

    return { success: true, prUrl, alreadyExists: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // ADO returns 409 when PR already exists
    if (msg.includes('409') || msg.toLowerCase().includes('already exists') || msg.toLowerCase().includes('active pull request')) {
      return { success: true, prUrl: undefined, alreadyExists: true };
    }
    return { success: false, error: msg };
  }
}
