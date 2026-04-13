/**
 * Azure DevOps PR Review handlers
 *
 * Implements AI-powered PR review using the ParallelOrchestratorReviewer engine
 * (same engine used for GitHub PRs). Context is fetched from the ADO REST API,
 * results are cached to .auto-claude/azure-devops/pr/ on disk.
 */

import { ipcMain } from 'electron';
import type { IpcMainEvent } from 'electron';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import path from 'path';
import * as crypto from 'node:crypto';
import { IPC_CHANNELS, DEFAULT_FEATURE_MODELS, DEFAULT_FEATURE_THINKING } from '../../../shared/constants';
import type { IPCResult, AppSettings } from '../../../shared/types';
import { projectStore } from '../../project-store';
import { readSettingsFile } from '../../settings-utils';
import {
  getAzureDevOpsConfig,
  adoFetch,
  detectAzureDevOpsFromRemote,
  buildBasicAuth,
} from './utils';
import {
  ParallelOrchestratorReviewer,
  type ParallelOrchestratorConfig,
} from '../../ai/runners/github/parallel-orchestrator';
import type { ModelShorthand, ThinkingLevel } from '../../ai/config/types';
import type { PRContext, ChangedFile } from '../../ai/runners/github/pr-review-engine';
import type {
  ADOAPIRepository,
  ADOAPIPullRequest,
  ADOAPIIteration,
  ADOAPIIterationChange,
  ADOAPICommit,
  AzureDevOpsPRReviewResult,
  AzureDevOpsPRReviewFinding,
  AzureDevOpsPRReviewProgress,
  AzureDevOpsPRLogs,
  AzureDevOpsPRLogsEntry,
  AzureDevOpsPRNewCommitsCheck,
  AzureDevOpsConfig,
} from './types';

const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

function debugLog(message: string, data?: unknown): void {
  if (DEBUG) {
    if (data !== undefined) {
      console.debug(`[ADO PR Review] ${message}`, data);
    } else {
      console.debug(`[ADO PR Review] ${message}`);
    }
  }
}

// ─── Disk cache helpers ─────────────────────────────────────────────────────

function getAdoCacheDir(projectPath: string): string {
  return path.join(projectPath, '.auto-claude', 'azure-devops', 'pr');
}

function getReviewPath(projectPath: string, pullRequestId: number): string {
  return path.join(getAdoCacheDir(projectPath), `review_${pullRequestId}.json`);
}

function getLogsPath(projectPath: string, pullRequestId: number): string {
  return path.join(getAdoCacheDir(projectPath), `logs_${pullRequestId}.json`);
}

function ensureCacheDir(projectPath: string): void {
  const dir = getAdoCacheDir(projectPath);
  mkdirSync(dir, { recursive: true });
}

function loadReviewFromDisk(projectPath: string, pullRequestId: number): AzureDevOpsPRReviewResult | null {
  const reviewPath = getReviewPath(projectPath, pullRequestId);
  if (!existsSync(reviewPath)) return null;
  try {
    return JSON.parse(readFileSync(reviewPath, 'utf-8')) as AzureDevOpsPRReviewResult;
  } catch {
    return null;
  }
}

function saveReviewToDisk(projectPath: string, result: AzureDevOpsPRReviewResult): void {
  ensureCacheDir(projectPath);
  writeFileSync(getReviewPath(projectPath, result.pullRequestId), JSON.stringify(result, null, 2), 'utf-8');
}

function loadLogsFromDisk(projectPath: string, pullRequestId: number): AzureDevOpsPRLogs | null {
  const logsPath = getLogsPath(projectPath, pullRequestId);
  if (!existsSync(logsPath)) return null;
  try {
    return JSON.parse(readFileSync(logsPath, 'utf-8')) as AzureDevOpsPRLogs;
  } catch {
    return null;
  }
}

function saveLogsToDisk(projectPath: string, pullRequestId: number, logs: AzureDevOpsPRLogs): void {
  ensureCacheDir(projectPath);
  writeFileSync(getLogsPath(projectPath, pullRequestId), JSON.stringify(logs, null, 2), 'utf-8');
}

function createEmptyLogs(): AzureDevOpsPRLogs {
  return {
    phases: {
      fetching: { status: 'pending', entries: [] },
      analyzing: { status: 'pending', entries: [] },
      generating: { status: 'pending', entries: [] },
    },
  };
}

// ─── ADO API helpers ─────────────────────────────────────────────────────────

async function findTargetRepo(
  config: AzureDevOpsConfig,
  projectPath: string
): Promise<ADOAPIRepository | null> {
  const reposResponse = await adoFetch(config, '/git/repositories') as { value: ADOAPIRepository[]; count: number };
  const repos = Array.isArray(reposResponse?.value) ? reposResponse.value : [];
  if (repos.length === 0) return null;

  const detected = detectAzureDevOpsFromRemote(projectPath);
  if (detected) {
    const matched = repos.find(r => r.name.toLowerCase() === detected.repo.toLowerCase());
    if (matched) return matched;
  }
  return repos[0];
}

async function getCurrentUserId(config: AzureDevOpsConfig): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(
      `${config.orgUrl}/_apis/connectiondata?api-version=6.0-preview`,
      {
        signal: controller.signal,
        headers: {
          Authorization: buildBasicAuth(config.token),
          'Content-Type': 'application/json',
        },
      }
    );
    clearTimeout(timeoutId);
    if (!response.ok) return null;
    const data = await response.json() as { authenticatedUser: { id: string } };
    return data?.authenticatedUser?.id ?? null;
  } catch {
    return null;
  }
}

// ─── Context fetching ─────────────────────────────────────────────────────────

async function fetchADOPRContext(
  config: AzureDevOpsConfig,
  projectPath: string,
  repo: ADOAPIRepository,
  pullRequestId: number
): Promise<PRContext> {
  const repoId = encodeURIComponent(repo.id);

  // 1. PR metadata
  const pr = await adoFetch(config, `/git/repositories/${repoId}/pullrequests/${pullRequestId}`) as ADOAPIPullRequest;

  // 2. Iterations — get latest
  const iterationsResp = await adoFetch(
    config,
    `/git/repositories/${repoId}/pullrequests/${pullRequestId}/iterations`
  ) as { value: ADOAPIIteration[]; count: number };
  const iterations: ADOAPIIteration[] = Array.isArray(iterationsResp?.value) ? iterationsResp.value : [];
  const latestIteration = iterations.length > 0 ? iterations[iterations.length - 1] : null;
  const iterationId = latestIteration?.id ?? 1;
  const headCommitSha = latestIteration?.sourceRefCommit?.commitId;

  // 3. Changed files
  const changesResp = await adoFetch(
    config,
    `/git/repositories/${repoId}/pullrequests/${pullRequestId}/iterations/${iterationId}/changes`
  ) as { changeEntries: ADOAPIIterationChange[]; count: number };
  const changeEntries: ADOAPIIterationChange[] = Array.isArray(changesResp?.changeEntries)
    ? changesResp.changeEntries
    : [];

  const changedFiles: ChangedFile[] = changeEntries
    .filter(c => c.item?.path && c.item.gitObjectType !== 'tree')
    .map(c => ({
      path: c.item.path.replace(/^\//, ''),
      status: mapChangeType(c.changeType),
      additions: 0,
      deletions: 0,
      patch: '',
    }));

  // 4. Try to get a diff via commits endpoint
  let diff = '';
  let diffTruncated = false;

  try {
    const baseSha = latestIteration?.targetRefCommit?.commitId;
    const headSha = headCommitSha;
    if (baseSha && headSha) {
      const diffResp = await adoFetch(
        config,
        `/git/repositories/${repoId}/diffs/commits?baseVersion=${baseSha}&baseVersionType=commit&targetVersion=${headSha}&targetVersionType=commit&$top=1000`
      ) as { changes?: Array<{ item?: { path?: string }; changeType?: string }> };

      // ADO diffs endpoint doesn't return unified diff text — build a minimal representation
      if (diffResp?.changes && Array.isArray(diffResp.changes)) {
        diff = diffResp.changes
          .filter(c => c.item?.path)
          .map(c => `diff --git a${c.item!.path} b${c.item!.path}\n--- a${c.item!.path}\n+++ b${c.item!.path}`)
          .join('\n\n');
      }
    }

    // Try to get file-level patches for up to 20 files
    const filesToPatch = changedFiles.slice(0, 20);
    const patches: string[] = [];
    const baseBranch = pr.targetRefName.replace(/^refs\/heads\//, '');
    const headBranch = pr.sourceRefName.replace(/^refs\/heads\//, '');

    for (const file of filesToPatch) {
      try {
        const [baseContent, headContent] = await Promise.all([
          fetchFileContent(config, repoId, file.path, baseBranch),
          fetchFileContent(config, repoId, file.path, headBranch),
        ]);
        if (baseContent !== null || headContent !== null) {
          const patch = buildSimplePatch(file.path, baseContent ?? '', headContent ?? '');
          patches.push(patch);
          const added = countLines(headContent ?? '') - countLines(baseContent ?? '');
          file.additions = Math.max(0, added);
          file.deletions = Math.max(0, -added);
          file.patch = patch;
        }
      } catch {
        // skip patch for this file
      }
    }
    if (patches.length > 0) {
      diff = patches.join('\n\n');
    }
    if (changedFiles.length > 20) {
      diffTruncated = true;
    }
  } catch (e) {
    debugLog('Could not fetch diff:', e instanceof Error ? e.message : e);
    diffTruncated = true;
  }

  // 5. Commits
  const commitsResp = await adoFetch(
    config,
    `/git/repositories/${repoId}/pullrequests/${pullRequestId}/commits`
  ) as { value: ADOAPICommit[]; count: number };
  const commits = (Array.isArray(commitsResp?.value) ? commitsResp.value : []).map(c => ({
    sha: c.commitId.substring(0, 7),
    message: c.comment,
    author: c.author?.name ?? 'Unknown',
    date: c.author?.date ?? '',
  }));

  // 6. Repo structure (top-level)
  let repoStructure = '';
  try {
    const itemsResp = await adoFetch(
      config,
      `/git/repositories/${repoId}/items?recursionLevel=OneLevel&versionDescriptor.version=${pr.sourceRefName.replace(/^refs\/heads\//, '')}&versionDescriptor.versionType=branch`
    ) as { value: Array<{ path: string; gitObjectType: string }> };
    if (Array.isArray(itemsResp?.value)) {
      repoStructure = itemsResp.value
        .filter(i => i.path !== '/')
        .map(i => i.path.replace(/^\//, ''))
        .slice(0, 50)
        .join('\n');
    }
  } catch {
    repoStructure = changedFiles.map(f => f.path).join('\n');
  }

  const totalAdditions = changedFiles.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = changedFiles.reduce((s, f) => s + f.deletions, 0);

  return {
    prNumber: pullRequestId,
    title: pr.title,
    description: pr.description ?? '',
    author: pr.createdBy?.displayName ?? 'Unknown',
    baseBranch: pr.targetRefName.replace(/^refs\/heads\//, ''),
    headBranch: pr.sourceRefName.replace(/^refs\/heads\//, ''),
    state: pr.status,
    changedFiles,
    diff,
    diffTruncated,
    repoStructure,
    relatedFiles: [],
    commits,
    labels: [],
    totalAdditions,
    totalDeletions,
    aiBotComments: [],
  };
}

function mapChangeType(changeType: string): string {
  if (changeType === 'add') return 'added';
  if (changeType === 'delete') return 'removed';
  if (changeType === 'rename') return 'renamed';
  return 'modified';
}

async function fetchFileContent(
  config: AzureDevOpsConfig,
  repoId: string,
  filePath: string,
  branch: string
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const url = `${config.orgUrl}/${encodeURIComponent(config.project)}/_apis/git/repositories/${repoId}/items?path=${encodeURIComponent('/' + filePath)}&versionDescriptor.version=${encodeURIComponent(branch)}&versionDescriptor.versionType=branch&api-version=7.1`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Authorization: buildBasicAuth(config.token) },
    });
    clearTimeout(timeoutId);
    if (!response.ok) return null;
    return response.text();
  } catch {
    return null;
  }
}

function buildSimplePatch(filename: string, before: string, after: string): string {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const header = `--- a/${filename}\n+++ b/${filename}`;
  const removed = beforeLines.slice(0, 50).map(l => `-${l}`).join('\n');
  const added = afterLines.slice(0, 50).map(l => `+${l}`).join('\n');
  return `${header}\n@@ -1,${Math.min(beforeLines.length, 50)} +1,${Math.min(afterLines.length, 50)} @@\n${removed}\n${added}`;
}

function countLines(content: string): number {
  return content.split('\n').length;
}

// ─── Review orchestration ────────────────────────────────────────────────────

// Track in-progress reviews for cancellation
const inProgressReviews = new Map<string, boolean>();

function getReviewKey(projectId: string, pullRequestId: number): string {
  return `${projectId}:${pullRequestId}`;
}

async function runReview(
  event: IpcMainEvent,
  projectId: string,
  pullRequestId: number,
  isFollowup = false
): Promise<void> {
  const reviewKey = getReviewKey(projectId, pullRequestId);

  const project = projectStore.getProject(projectId);
  if (!project) {
    event.sender.send(IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW_ERROR, projectId, pullRequestId, 'Project not found');
    return;
  }

  const config = await getAzureDevOpsConfig(project);
  if (!config) {
    event.sender.send(IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW_ERROR, projectId, pullRequestId, 'Azure DevOps not configured');
    return;
  }

  inProgressReviews.set(reviewKey, true);

  const sendProgress = (phase: AzureDevOpsPRReviewProgress['phase'], progress: number, message: string) => {
    event.sender.send(IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW_PROGRESS, projectId, {
      phase,
      pullRequestId,
      progress,
      message,
    } satisfies AzureDevOpsPRReviewProgress);
  };

  // Log state
  const logs = createEmptyLogs();
  let logEntryCount = 0;

  const addLogEntry = (phase: keyof typeof logs.phases, entry: Omit<AzureDevOpsPRLogsEntry, 'phase'>) => {
    logs.phases[phase].entries.push({ ...entry, phase });
    logEntryCount++;
    if (logEntryCount % 3 === 0) {
      saveLogsToDisk(project.path, pullRequestId, logs);
      event.sender.send(IPC_CHANNELS.AZURE_DEVOPS_PR_LOGS_UPDATED, projectId, pullRequestId);
    }
  };

  try {
    // Phase: fetching
    sendProgress('fetching', 10, 'Fetching PR context from Azure DevOps...');
    logs.phases.fetching.status = 'active';
    addLogEntry('fetching', { timestamp: new Date().toISOString(), type: 'text', content: `Fetching PR #${pullRequestId}` });

    const repo = await findTargetRepo(config, project.path);
    if (!repo) {
      throw new Error('No repository found in Azure DevOps project');
    }

    addLogEntry('fetching', { timestamp: new Date().toISOString(), type: 'text', content: `Found repository: ${repo.name}` });

    const prContext = await fetchADOPRContext(config, project.path, repo, pullRequestId);
    logs.phases.fetching.status = 'completed';
    addLogEntry('fetching', {
      timestamp: new Date().toISOString(),
      type: 'text',
      content: `Context ready: ${prContext.changedFiles.length} files changed`,
    });
    saveLogsToDisk(project.path, pullRequestId, logs);

    // Check cancellation
    if (!inProgressReviews.get(reviewKey)) {
      debugLog('Review cancelled:', reviewKey);
      return;
    }

    // Phase: analyzing
    sendProgress('analyzing', 30, 'Running parallel specialist analysis...');
    logs.phases.analyzing.status = 'active';
    addLogEntry('analyzing', { timestamp: new Date().toISOString(), type: 'text', content: 'Starting parallel orchestrator' });

    // Get model settings — reuse GitHub PRs model setting (no separate ADO model key yet)
    const rawSettings = readSettingsFile() as Partial<AppSettings> | undefined;
    const featureModels = rawSettings?.featureModels ?? DEFAULT_FEATURE_MODELS;
    const featureThinking = rawSettings?.featureThinking ?? DEFAULT_FEATURE_THINKING;
    const model = featureModels.githubPrs ?? DEFAULT_FEATURE_MODELS.githubPrs;
    const thinkingLevel = featureThinking.githubPrs ?? DEFAULT_FEATURE_THINKING.githubPrs;

    const orchestratorConfig: ParallelOrchestratorConfig = {
      repo: `${config.orgUrl}/${config.project}`,
      projectDir: project.path,
      model: model as ModelShorthand,
      thinkingLevel: thinkingLevel as ThinkingLevel,
    };

    let progressPercent = 30;

    const orchestrator = new ParallelOrchestratorReviewer(
      orchestratorConfig,
      (update) => {
        if (!inProgressReviews.get(reviewKey)) return;
        progressPercent = Math.min(85, 30 + update.progress * 0.55);
        sendProgress('analyzing', progressPercent, update.message);
        addLogEntry('analyzing', {
          timestamp: new Date().toISOString(),
          type: 'text',
          content: update.message,
        });
      }
    );

    const orchestratorResult = await orchestrator.review(prContext);

    logs.phases.analyzing.status = 'completed';
    addLogEntry('analyzing', {
      timestamp: new Date().toISOString(),
      type: 'text',
      content: `Analysis complete. Verdict: ${orchestratorResult.verdict}. Findings: ${orchestratorResult.findings.length}`,
    });

    // Phase: generating result
    sendProgress('generating', 90, 'Generating review result...');
    logs.phases.generating.status = 'active';

    // Map verdict to overallStatus
    const overallStatus = mapVerdictToStatus(orchestratorResult.verdict);

    // Map findings
    const findings: AzureDevOpsPRReviewFinding[] = orchestratorResult.findings.map(f => ({
      id: f.id ?? crypto.randomUUID(),
      severity: f.severity as AzureDevOpsPRReviewFinding['severity'],
      category: f.category as AzureDevOpsPRReviewFinding['category'],
      title: f.title,
      description: f.description,
      file: f.file ?? '',
      line: f.line ?? 0,
      suggestedFix: f.suggestedFix,
      fixable: f.fixable ?? false,
    }));

    // Load previous review for followup tracking
    const previousReview = isFollowup ? loadReviewFromDisk(project.path, pullRequestId) : null;

    const result: AzureDevOpsPRReviewResult = {
      pullRequestId,
      repositoryName: repo.name,
      success: true,
      findings,
      summary: orchestratorResult.summary,
      overallStatus,
      verdict: orchestratorResult.verdict,
      verdictReasoning: orchestratorResult.verdictReasoning,
      reviewedAt: new Date().toISOString(),
      reviewedCommitSha: (await getLatestCommitSha(config, repo.id, pullRequestId)) ?? undefined,
      isFollowupReview: isFollowup,
      previousReviewId: previousReview?.pullRequestId,
      resolvedFindings: isFollowup && previousReview
        ? previousReview.findings
            .filter(pf => !findings.some(f => f.title === pf.title))
            .map(f => f.id)
        : undefined,
      unresolvedFindings: isFollowup && previousReview
        ? findings
            .filter(f => previousReview.findings.some(pf => pf.title === f.title))
            .map(f => f.id)
        : undefined,
      newFindingsSinceLastReview: isFollowup && previousReview
        ? findings
            .filter(f => !previousReview.findings.some(pf => pf.title === f.title))
            .map(f => f.id)
        : undefined,
      hasPostedFindings: false,
      postedFindingIds: [],
    };

    saveReviewToDisk(project.path, result);
    logs.phases.generating.status = 'completed';
    saveLogsToDisk(project.path, pullRequestId, logs);

    sendProgress('complete', 100, 'Review complete');
    event.sender.send(IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW_COMPLETE, projectId, result);

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error during PR review';
    debugLog('PR review failed:', message);

    // Save failed result
    const failedResult: AzureDevOpsPRReviewResult = {
      pullRequestId,
      repositoryName: '',
      success: false,
      findings: [],
      summary: '',
      overallStatus: 'comment',
      verdict: 'needs_revision',
      verdictReasoning: message,
      reviewedAt: new Date().toISOString(),
    };
    try { saveReviewToDisk(project.path, failedResult); } catch { /* ignore */ }

    event.sender.send(IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW_ERROR, projectId, pullRequestId, message);
  } finally {
    inProgressReviews.delete(reviewKey);
  }
}

async function getLatestCommitSha(
  config: AzureDevOpsConfig,
  repoId: string,
  pullRequestId: number
): Promise<string | null> {
  try {
    const iterResp = await adoFetch(
      config,
      `/git/repositories/${encodeURIComponent(repoId)}/pullrequests/${pullRequestId}/iterations`
    ) as { value: ADOAPIIteration[] };
    const iters = Array.isArray(iterResp?.value) ? iterResp.value : [];
    const latest = iters[iters.length - 1];
    return latest?.sourceRefCommit?.commitId ?? null;
  } catch {
    return null;
  }
}

function mapVerdictToStatus(verdict: string): AzureDevOpsPRReviewResult['overallStatus'] {
  if (verdict === 'ready_to_merge') return 'approve';
  if (verdict === 'merge_with_changes') return 'comment';
  return 'request_changes';
}

// ─── IPC Handler Registration ────────────────────────────────────────────────

export function registerPRReviewHandlers(): void {
  debugLog('Registering Azure DevOps PR review handlers');

  // Trigger review (fire-and-forget)
  ipcMain.on(IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW, (event, projectId: string, pullRequestId: number) => {
    debugLog('reviewPR called', { projectId, pullRequestId });
    runReview(event, projectId, pullRequestId, false).catch(err => {
      debugLog('Unhandled error in runReview:', err);
    });
  });

  // Trigger follow-up review
  ipcMain.on(IPC_CHANNELS.AZURE_DEVOPS_PR_FOLLOWUP_REVIEW, (event, projectId: string, pullRequestId: number) => {
    debugLog('followupReview called', { projectId, pullRequestId });
    runReview(event, projectId, pullRequestId, true).catch(err => {
      debugLog('Unhandled error in followupReview:', err);
    });
  });

  // Cancel review
  ipcMain.on(IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW_CANCEL, (_event, projectId: string, pullRequestId: number) => {
    debugLog('cancelReview called', { projectId, pullRequestId });
    inProgressReviews.set(getReviewKey(projectId, pullRequestId), false);
  });

  // Get saved review from disk
  ipcMain.handle(IPC_CHANNELS.AZURE_DEVOPS_PR_GET_REVIEW, async (_event, projectId: string, pullRequestId: number): Promise<IPCResult<AzureDevOpsPRReviewResult | null>> => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: 'Project not found' };
    const result = loadReviewFromDisk(project.path, pullRequestId);
    return { success: true, data: result };
  });

  // Get reviews for multiple PRs
  ipcMain.handle(IPC_CHANNELS.AZURE_DEVOPS_PR_GET_REVIEWS_BATCH, async (_event, projectId: string, prIds: number[]): Promise<IPCResult<Record<number, AzureDevOpsPRReviewResult>>> => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: 'Project not found' };
    const results: Record<number, AzureDevOpsPRReviewResult> = {};
    for (const id of prIds) {
      const r = loadReviewFromDisk(project.path, id);
      if (r) results[id] = r;
    }
    return { success: true, data: results };
  });

  // Get logs from disk
  ipcMain.handle(IPC_CHANNELS.AZURE_DEVOPS_PR_GET_LOGS, async (_event, projectId: string, pullRequestId: number): Promise<IPCResult<AzureDevOpsPRLogs | null>> => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: 'Project not found' };
    const logs = loadLogsFromDisk(project.path, pullRequestId);
    return { success: true, data: logs };
  });

  // Post review to ADO as PR threads
  ipcMain.handle(IPC_CHANNELS.AZURE_DEVOPS_PR_POST_REVIEW, async (_event, projectId: string, pullRequestId: number, findingIds?: string[]): Promise<IPCResult<void>> => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: 'Project not found' };

    const config = await getAzureDevOpsConfig(project);
    if (!config) return { success: false, error: 'Azure DevOps not configured' };

    const review = loadReviewFromDisk(project.path, pullRequestId);
    if (!review) return { success: false, error: 'No review found. Run a review first.' };

    try {
      const repo = await findTargetRepo(config, project.path);
      if (!repo) return { success: false, error: 'No repository found' };

      const repoId = encodeURIComponent(repo.id);

      // Determine which findings to post
      const findingsToPost = findingIds
        ? review.findings.filter(f => findingIds.includes(f.id))
        : review.findings;

      const postedIds: string[] = [];

      // Post summary thread
      const summaryContent = buildSummaryComment(review);
      await postThread(config, repoId, pullRequestId, summaryContent);

      // Post individual finding threads (up to 20 to avoid spam)
      for (const finding of findingsToPost.slice(0, 20)) {
        const content = buildFindingComment(finding);
        await postThread(config, repoId, pullRequestId, content, finding.file, finding.line);
        postedIds.push(finding.id);
      }

      // Update review on disk
      review.hasPostedFindings = true;
      review.postedFindingIds = postedIds;
      saveReviewToDisk(project.path, review);

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to post review' };
    }
  });

  // Delete review from disk
  ipcMain.handle(IPC_CHANNELS.AZURE_DEVOPS_PR_DELETE_REVIEW, async (_event, projectId: string, pullRequestId: number): Promise<IPCResult<void>> => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: 'Project not found' };
    try {
      const reviewPath = getReviewPath(project.path, pullRequestId);
      const logsPath = getLogsPath(project.path, pullRequestId);
      if (existsSync(reviewPath)) rmSync(reviewPath);
      if (existsSync(logsPath)) rmSync(logsPath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to delete review' };
    }
  });

  // Approve/vote on PR
  ipcMain.handle(IPC_CHANNELS.AZURE_DEVOPS_PR_APPROVE, async (_event, projectId: string, pullRequestId: number, vote: number): Promise<IPCResult<void>> => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: 'Project not found' };

    const config = await getAzureDevOpsConfig(project);
    if (!config) return { success: false, error: 'Azure DevOps not configured' };

    try {
      const repo = await findTargetRepo(config, project.path);
      if (!repo) return { success: false, error: 'No repository found' };

      const userId = await getCurrentUserId(config);
      if (!userId) return { success: false, error: 'Could not determine current user ID' };

      const repoId = encodeURIComponent(repo.id);
      await adoFetch(
        config,
        `/git/repositories/${repoId}/pullrequests/${pullRequestId}/reviewers/${encodeURIComponent(userId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({ vote, isRequired: false }),
        }
      );
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to set vote' };
    }
  });

  // Merge PR
  ipcMain.handle(IPC_CHANNELS.AZURE_DEVOPS_PR_MERGE, async (_event, projectId: string, pullRequestId: number): Promise<IPCResult<void>> => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: 'Project not found' };

    const config = await getAzureDevOpsConfig(project);
    if (!config) return { success: false, error: 'Azure DevOps not configured' };

    try {
      const repo = await findTargetRepo(config, project.path);
      if (!repo) return { success: false, error: 'No repository found' };

      // Fetch PR to get lastMergeSourceCommit (required by ADO for merge)
      const pr = await adoFetch(
        config,
        `/git/repositories/${encodeURIComponent(repo.id)}/pullrequests/${pullRequestId}`
      ) as ADOAPIPullRequest & { lastMergeSourceCommit?: { commitId: string } };

      await adoFetch(
        config,
        `/git/repositories/${encodeURIComponent(repo.id)}/pullrequests/${pullRequestId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'completed',
            lastMergeSourceCommit: pr.lastMergeSourceCommit ?? undefined,
            completionOptions: {
              mergeStrategy: 'squash',
              deleteSourceBranch: false,
            },
          }),
        }
      );
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to merge PR' };
    }
  });

  // Check for new commits since last review
  ipcMain.handle(IPC_CHANNELS.AZURE_DEVOPS_PR_CHECK_NEW_COMMITS, async (_event, projectId: string, pullRequestId: number): Promise<IPCResult<AzureDevOpsPRNewCommitsCheck>> => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: 'Project not found' };

    const config = await getAzureDevOpsConfig(project);
    if (!config) return { success: false, error: 'Azure DevOps not configured' };

    try {
      const review = loadReviewFromDisk(project.path, pullRequestId);
      const repo = await findTargetRepo(config, project.path);
      if (!repo) return { success: false, error: 'No repository found' };

      const latestSha = await getLatestCommitSha(config, repo.id, pullRequestId);

      const commitsResp = await adoFetch(
        config,
        `/git/repositories/${encodeURIComponent(repo.id)}/pullrequests/${pullRequestId}/commits`
      ) as { value: ADOAPICommit[]; count: number };
      const commits = Array.isArray(commitsResp?.value) ? commitsResp.value : [];
      const latestCommit = commits[0];

      const hasNewCommits = !!(review?.reviewedCommitSha && latestSha && review.reviewedCommitSha !== latestSha);

      return {
        success: true,
        data: {
          hasNewCommits,
          commitCount: commits.length,
          latestCommitSha: latestSha ?? undefined,
          latestCommitMessage: latestCommit?.comment ?? undefined,
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to check commits' };
    }
  });

  // Check merge readiness
  ipcMain.handle(IPC_CHANNELS.AZURE_DEVOPS_PR_CHECK_MERGE_READINESS, async (_event, projectId: string, pullRequestId: number): Promise<IPCResult<{ canMerge: boolean; reason?: string }>> => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: 'Project not found' };

    const config = await getAzureDevOpsConfig(project);
    if (!config) return { success: false, error: 'Azure DevOps not configured' };

    try {
      const repo = await findTargetRepo(config, project.path);
      if (!repo) return { success: false, error: 'No repository found' };

      const pr = await adoFetch(
        config,
        `/git/repositories/${encodeURIComponent(repo.id)}/pullrequests/${pullRequestId}`
      ) as ADOAPIPullRequest & { mergeStatus?: string };

      const canMerge = pr.status === 'active' && pr.mergeStatus === 'succeeded';
      const reason = !canMerge
        ? pr.status !== 'active'
          ? `PR is ${pr.status}`
          : `Merge status: ${pr.mergeStatus ?? 'unknown'}`
        : undefined;

      return { success: true, data: { canMerge, reason } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to check merge readiness' };
    }
  });

  // Get PR diff
  ipcMain.handle(IPC_CHANNELS.AZURE_DEVOPS_PR_GET_DIFF, async (_event, projectId: string, pullRequestId: number): Promise<IPCResult<string>> => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: 'Project not found' };

    const config = await getAzureDevOpsConfig(project);
    if (!config) return { success: false, error: 'Azure DevOps not configured' };

    try {
      const repo = await findTargetRepo(config, project.path);
      if (!repo) return { success: false, error: 'No repository found' };

      const prContext = await fetchADOPRContext(config, project.path, repo, pullRequestId);
      return { success: true, data: prContext.diff };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to get diff' };
    }
  });

  debugLog('Azure DevOps PR review handlers registered');
}

// ─── Comment helpers ──────────────────────────────────────────────────────────

async function postThread(
  config: AzureDevOpsConfig,
  repoId: string,
  pullRequestId: number,
  content: string,
  filePath?: string,
  line?: number
): Promise<void> {
  const body: Record<string, unknown> = {
    comments: [{ content, commentType: 1 }],
    status: 'active',
  };
  if (filePath && line) {
    body.threadContext = {
      filePath: `/${filePath}`,
      rightFileStart: { line, offset: 1 },
      rightFileEnd: { line, offset: 1 },
    };
  }
  await adoFetch(
    config,
    `/git/repositories/${repoId}/pullrequests/${pullRequestId}/threads`,
    { method: 'POST', body: JSON.stringify(body) }
  );
}

function buildSummaryComment(review: AzureDevOpsPRReviewResult): string {
  const verdictEmoji: Record<string, string> = {
    ready_to_merge: '✅',
    merge_with_changes: '⚠️',
    needs_revision: '🔄',
    blocked: '🚫',
  };
  const emoji = verdictEmoji[review.verdict] ?? '🔍';
  const severity = ['critical', 'high', 'medium', 'low'];
  const bySeverity = severity
    .map(s => {
      const count = review.findings.filter(f => f.severity === s).length;
      return count > 0 ? `${count} ${s}` : null;
    })
    .filter(Boolean)
    .join(', ');

  return [
    `## ${emoji} AI PR Review — ${review.verdict.replace(/_/g, ' ')}`,
    '',
    review.summary,
    '',
    bySeverity ? `**Findings:** ${bySeverity}` : '**No findings.**',
    '',
    `*Reviewed at ${new Date(review.reviewedAt).toLocaleString()} by Aperant AI*`,
  ].join('\n');
}

function buildFindingComment(finding: AzureDevOpsPRReviewFinding): string {
  const severityEmoji: Record<string, string> = {
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '🔵',
  };
  const emoji = severityEmoji[finding.severity] ?? '⚪';
  const lines = [
    `### ${emoji} [${finding.severity.toUpperCase()}] ${finding.title}`,
    '',
    finding.description,
  ];
  if (finding.suggestedFix) {
    lines.push('', `**Suggested fix:** ${finding.suggestedFix}`);
  }
  return lines.join('\n');
}
