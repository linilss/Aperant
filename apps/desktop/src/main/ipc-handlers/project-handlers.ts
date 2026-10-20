import { ipcMain, shell } from 'electron';
import { existsSync } from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';
import { IPC_CHANNELS, getSpecsDir } from '../../shared/constants';
import type {
  Project,
  ProjectSettings,
  IPCResult,
  InitializationResult,
  AutoBuildVersionInfo,
  GitStatus,
  GitBranchDetail,
  DeployScript,
  DeployPreflight,
  DeployVerifyResult,
  DeployRunRecord,
  TaskDeployment
} from '../../shared/types';
import { projectStore } from '../project-store';
import { findDeployScripts } from '../deploy-scripts';
import { verifyAndFixAfterMerge } from '../deploy-verify';
import { prepareDeployCheckout, startDeploy, getActiveDeploy, getDeployHistory, cancelDeploy } from '../deploy-manager';
import { readRunbook, seedRunbook, writeRunbook } from '../deploy-runbook';
import { readFileSync as readFileSyncFs } from 'fs';
import { appendTaskDeployment, resolveTaskDeployments } from '../task-deployments';
import { findAllSpecPaths } from '../utils/spec-path-helpers';
import {
  initializeProject,
  isInitialized,
  hasLocalSource,
  checkGitStatus,
  initializeGit
} from '../project-initializer';
import { getToolPath } from '../cli-tool-manager';
import type { BrowserWindow } from 'electron';

// ============================================
// Git Helper Functions
// ============================================

/**
 * Get list of git branches for a directory (both local and remote)
 */
function getGitBranches(projectPath: string): string[] {
  try {
    // First fetch to ensure we have latest remote refs
    try {
      execFileSync(getToolPath('git'), ['fetch', '--prune'], {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000 // 10 second timeout for fetch
      });
    } catch {
      // Fetch may fail if offline or no remote, continue with local refs
    }

    // Get all branches (local + remote) using --all flag
    const result = execFileSync(getToolPath('git'), ['branch', '--all', '--format=%(refname:short)'], {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const branches = result.trim().split('\n')
      .filter(b => b.trim())
      .map(b => {
        // Remote branches come as "origin/branch-name", keep the full name
        // but remove the "origin/" prefix for display while keeping it usable
        return b.trim();
      })
      // Remove HEAD pointer entries like "origin/HEAD"
      .filter(b => !b.endsWith('/HEAD'))
      // Remove duplicates (local branch may exist alongside remote)
      .filter((branch, index, self) => {
        // If it's a remote branch (origin/x) and local version exists, keep local
        if (branch.startsWith('origin/')) {
          const localName = branch.replace('origin/', '');
          return !self.includes(localName);
        }
        return self.indexOf(branch) === index;
      });

    // Sort: local branches first, then remote branches
    return branches.sort((a, b) => {
      const aIsRemote = a.startsWith('origin/');
      const bIsRemote = b.startsWith('origin/');
      if (aIsRemote && !bIsRemote) return 1;
      if (!aIsRemote && bIsRemote) return -1;
      return a.localeCompare(b);
    });
  } catch {
    return [];
  }
}

/**
 * Get structured branch information for a directory (both local and remote)
 * Returns GitBranchDetail[] with type indicators, keeping both local and remote versions
 * when a branch exists in both places (no deduplication)
 */
function getGitBranchesWithInfo(projectPath: string): GitBranchDetail[] {
  try {
    // First fetch to ensure we have latest remote refs
    try {
      execFileSync(getToolPath('git'), ['fetch', '--prune'], {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000 // 10 second timeout for fetch
      });
    } catch {
      // Fetch may fail if offline or no remote, continue with local refs
    }

    // Get current branch for isCurrent indicator
    let currentBranch: string | null = null;
    try {
      const currentResult = execFileSync(getToolPath('git'), ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      currentBranch = currentResult.trim() || null;
    } catch {
      // Ignore - current branch detection may fail in some edge cases
    }

    // Get local branches
    const localResult = execFileSync(getToolPath('git'), ['branch', '--format=%(refname:short)'], {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const localBranches: GitBranchDetail[] = localResult.trim().split('\n')
      .filter(b => b.trim())
      .map(b => {
        const name = b.trim();
        return {
          name,
          type: 'local' as const,
          displayName: name,
          isCurrent: name === currentBranch
        };
      });

    // Get remote branches
    let remoteBranches: GitBranchDetail[] = [];
    try {
      const remoteResult = execFileSync(getToolPath('git'), ['branch', '-r', '--format=%(refname:short)'], {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });

      remoteBranches = remoteResult.trim().split('\n')
        .filter(b => b.trim())
        .map(b => b.trim())
        // Remove HEAD pointer entries like "origin/HEAD"
        .filter(b => !b.endsWith('/HEAD'))
        .map(fullName => {
          // Strip "origin/" prefix so branch names are clean for PR targets etc.
          const name = fullName.replace(/^origin\//, '');
          return {
            name,
            type: 'remote' as const,
            displayName: name,
            isCurrent: false
          };
        });
    } catch {
      // Remote branches may not exist, continue with local only
    }

    // Deduplicate: if a branch exists locally and remotely, keep only the local entry
    const localNames = new Set(localBranches.map(b => b.name));
    remoteBranches = remoteBranches.filter(b => !localNames.has(b.name));

    // Combine and sort: local branches first, then remote branches, alphabetically within each group
    const allBranches = [...localBranches, ...remoteBranches];

    return allBranches.sort((a, b) => {
      // Local branches come first
      if (a.type === 'local' && b.type === 'remote') return -1;
      if (a.type === 'remote' && b.type === 'local') return 1;
      // Within same type, sort alphabetically
      return a.name.localeCompare(b.name);
    });
  } catch {
    return [];
  }
}

/**
 * Get the current git branch for a directory
 */
function getCurrentGitBranch(projectPath: string): string | null {
  try {
    const result = execFileSync(getToolPath('git'), ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return result.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Cheap pre-deploy check of the project's working tree (no fetch): current branch,
 * main branch (configured, else local main/master) and whether there are uncommitted changes.
 */
function getDeployPreflight(projectPath: string, configuredMainBranch?: string): DeployPreflight {
  const git = (args: string[]): string | null => {
    try {
      return execFileSync(getToolPath('git'), args, {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000
      }).trim();
    } catch {
      return null;
    }
  };

  let mainBranch = configuredMainBranch?.trim() || null;
  if (!mainBranch) {
    mainBranch = ['main', 'master'].find((b) => git(['rev-parse', '--verify', '--quiet', `refs/heads/${b}`]) !== null) ?? null;
  }
  const status = git(['status', '--porcelain', '--untracked-files=no']);

  return {
    currentBranch: getCurrentGitBranch(projectPath),
    mainBranch,
    hasUncommittedChanges: !!status
  };
}

/**
 * Detect the main branch for a git repository
 * Checks for common main branch names in order of preference
 */
function detectMainBranch(projectPath: string): string | null {
  const branches = getGitBranches(projectPath);
  if (branches.length === 0) return null;

  // Check for common main branch names in order of preference
  const mainBranchCandidates = ['main', 'master', 'develop', 'dev', 'trunk'];
  for (const candidate of mainBranchCandidates) {
    if (branches.includes(candidate)) {
      return candidate;
    }
  }

  // If none of the common names found, check for origin/HEAD reference
  try {
    const result = execFileSync(getToolPath('git'), ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const ref = result.trim();
    // Extract branch name from refs/remotes/origin/main
    const match = ref.match(/refs\/remotes\/origin\/(.+)/);
    if (match && branches.includes(match[1])) {
      return match[1];
    }
  } catch {
    // origin/HEAD not set, continue with fallback
  }

  // Fallback: return the first branch (usually the current one)
  return branches[0] || null;
}

/**
 * Register all project-related IPC handlers
 */
export function registerProjectHandlers(
  getMainWindow: () => BrowserWindow | null
): void {
  // ============================================
  // Project Operations
  // ============================================

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_ADD,
    async (_, projectPath: string): Promise<IPCResult<Project>> => {
      try {
        // Validate path exists
        if (!existsSync(projectPath)) {
          return { success: false, error: 'Directory does not exist' };
        }

        const project = projectStore.addProject(projectPath);
        return { success: true, data: project };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_REMOVE,
    async (_, projectId: string): Promise<IPCResult> => {
      const success = projectStore.removeProject(projectId);
      return { success };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_LIST,
    async (): Promise<IPCResult<Project[]>> => {
      // Validate that .malvy folders still exist for all projects
      // If a folder was deleted, reset autoBuildPath so UI prompts for reinitialization
      const resetIds = projectStore.validateProjects();
      if (resetIds.length > 0) {
        console.warn('[IPC] PROJECT_LIST: Detected missing .malvy folders for', resetIds.length, 'project(s)');
      }

      const projects = projectStore.getProjects();
      console.warn('[IPC] PROJECT_LIST returning', projects.length, 'projects');
      return { success: true, data: projects };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_UPDATE_SETTINGS,
    async (
      _,
      projectId: string,
      settings: Partial<ProjectSettings>
    ): Promise<IPCResult> => {
      const project = projectStore.updateProjectSettings(projectId, settings);
      if (project) {
        return { success: true };
      }
      return { success: false, error: 'Project not found' };
    }
  );

  // ============================================
  // Tab State Operations (persisted in main process)
  // ============================================

  ipcMain.handle(
    IPC_CHANNELS.TAB_STATE_GET,
    async (): Promise<IPCResult<{ openProjectIds: string[]; activeProjectId: string | null; tabOrder: string[] }>> => {
      const tabState = projectStore.getTabState();
      console.log('[IPC] TAB_STATE_GET returning:', tabState);
      return { success: true, data: tabState };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.TAB_STATE_SAVE,
    async (
      _,
      tabState: { openProjectIds: string[]; activeProjectId: string | null; tabOrder: string[] }
    ): Promise<IPCResult> => {
      console.log('[IPC] TAB_STATE_SAVE called with:', tabState);
      projectStore.saveTabState(tabState);
      return { success: true };
    }
  );

  // ============================================
  // Kanban Preferences Operations (persisted in main process)
  // ============================================

  ipcMain.handle(
    IPC_CHANNELS.KANBAN_PREFS_GET,
    async (_, projectId: string): Promise<IPCResult<Record<string, { width: number; isCollapsed: boolean; isLocked: boolean }> | null>> => {
      try {
        const preferences = projectStore.getKanbanPreferences(projectId);
        return { success: true, data: preferences };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.KANBAN_PREFS_SAVE,
    async (
      _,
      projectId: string,
      preferences: Record<string, { width: number; isCollapsed: boolean; isLocked: boolean }>
    ): Promise<IPCResult> => {
      try {
        projectStore.saveKanbanPreferences(projectId, preferences);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  );

  // ============================================
  // Project Initialization Operations
  // ============================================

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_INITIALIZE,
    async (_, projectId: string): Promise<IPCResult<InitializationResult>> => {
      try {
        const project = projectStore.getProject(projectId);
        if (!project) {
          return { success: false, error: 'Project not found' };
        }

        const result = initializeProject(project.path);

        if (result.success) {
          // Update project's autoBuildPath
          projectStore.updateAutoBuildPath(projectId, '.malvy');
        }

        return { success: result.success, data: result, error: result.error };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_LIST_DEPLOY_SCRIPTS,
    async (_, projectId: string): Promise<IPCResult<DeployScript[]>> => {
      try {
        const project = projectStore.getProject(projectId);
        if (!project) {
          return { success: false, error: 'Project not found' };
        }
        return { success: true, data: await findDeployScripts(project.path) };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_DEPLOY_RUNBOOK_GET,
    async (_, projectId: string): Promise<IPCResult<{ content: string; exists: boolean }>> => {
      const project = projectStore.getProject(projectId);
      if (!project) return { success: false, error: 'Project not found' };
      const existing = readRunbook(project.path);
      if (existing !== null) return { success: true, data: { content: existing, exists: true } };
      const scripts = (await findDeployScripts(project.path)).map((s) => s.relativePath);
      const smoke = ['scripts/smoke-prod.sh', 'scripts/smoke.sh', 'smoke.sh'].filter((f) => existsSync(path.join(project.path, f)));
      let claudeMd = '';
      try {
        claudeMd = readFileSyncFs(path.join(project.path, 'CLAUDE.md'), 'utf-8');
      } catch {
        claudeMd = '';
      }
      return { success: true, data: { content: seedRunbook(project.name, scripts, smoke, claudeMd), exists: false } };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_DEPLOY_RUNBOOK_SAVE,
    async (_, projectId: string, content: string): Promise<IPCResult> => {
      const project = projectStore.getProject(projectId);
      if (!project) return { success: false, error: 'Project not found' };
      writeRunbook(project.path, content);
      return { success: true };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_DEPLOY_START,
    async (_, projectId: string, taskIds: string[]): Promise<IPCResult<DeployRunRecord>> => {
      const project = projectStore.getProject(projectId);
      if (!project) return { success: false, error: 'Project not found' };
      if (project.settings?.overviewOnly) return { success: false, error: "This is an overview project: deploy from the app's own project." };
      if (readRunbook(project.path) === null) {
        return { success: false, error: 'No deploy runbook yet. Open Ship → Deploy, check the generated runbook and save it.' };
      }
      try {
        return { success: true, data: startDeploy(project, taskIds ?? []) };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Could not start the deploy' };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_DEPLOY_STATUS,
    async (_, projectId: string): Promise<IPCResult<{ active: DeployRunRecord | null; history: DeployRunRecord[] }>> => {
      const project = projectStore.getProject(projectId);
      if (!project) return { success: false, error: 'Project not found' };
      return { success: true, data: { active: getActiveDeploy(projectId), history: getDeployHistory(project).slice(0, 10) } };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_DEPLOY_LOG,
    async (_, projectId: string, deployId: string): Promise<IPCResult<string>> => {
      const project = projectStore.getProject(projectId);
      if (!project) return { success: false, error: 'Project not found' };
      if (!/^[\w-]+$/.test(deployId)) return { success: false, error: 'Bad deploy id' };
      try {
        const text = readFileSyncFs(path.join(project.path, '.malvy', 'deploys', `${deployId}.log`), 'utf-8');
        return { success: true, data: text.split('\n').slice(-600).join('\n') };
      } catch {
        return { success: true, data: '' };
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.PROJECT_DEPLOY_CANCEL, async (_, projectId: string): Promise<IPCResult<boolean>> => ({
    success: true,
    data: cancelDeploy(projectId)
  }));

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_DEPLOY_VERIFY,
    async (_, projectId: string, mergedTitles: string[]): Promise<IPCResult<DeployVerifyResult>> => {
      const project = projectStore.getProject(projectId);
      if (!project) return { success: false, error: 'Project not found' };
      try {
        return {
          success: true,
          data: await verifyAndFixAfterMerge(project.path, project.settings?.verifyCommand, mergedTitles ?? [])
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Verify failed' };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_DEPLOY_CLEAN_CHECKOUT,
    async (_, projectId: string): Promise<IPCResult<string>> => {
      const project = projectStore.getProject(projectId);
      if (!project) return { success: false, error: 'Project not found' };
      try {
        return { success: true, data: prepareDeployCheckout(project.path, project.autoBuildPath || '.malvy') };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Could not prepare a clean checkout' };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_DEPLOY_PREFLIGHT,
    async (_, projectId: string): Promise<IPCResult<DeployPreflight>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }
      return { success: true, data: getDeployPreflight(project.path, project.settings?.mainBranch) };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_RESOLVE_TASK_DEPLOYMENTS,
    async (_, projectId: string, taskIds: string[]): Promise<IPCResult<Record<string, TaskDeployment[]>>> => {
      const project = projectStore.getProject(projectId);
      if (!project) return { success: false, error: 'Project not found' };
      const data: Record<string, TaskDeployment[]> = {};
      for (const taskId of taskIds) {
        const specPaths = findAllSpecPaths(project.path, getSpecsDir(project.autoBuildPath), taskId);
        data[taskId] = resolveTaskDeployments(project.path, specPaths);
      }
      projectStore.invalidateTasksCache(projectId);
      return { success: true, data };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_RECORD_TASK_DEPLOYMENT,
    async (
      _,
      projectId: string,
      taskId: string,
      deployment: { script: string; args?: string; log?: string; commit?: string; steps?: string[] }
    ): Promise<IPCResult<TaskDeployment[]>> => {
      try {
        const project = projectStore.getProject(projectId);
        if (!project) {
          return { success: false, error: 'Project not found' };
        }
        const specPaths = findAllSpecPaths(project.path, getSpecsDir(project.autoBuildPath), taskId);
        const entry: TaskDeployment = {
          script: deployment.script,
          ...(deployment.args?.trim() ? { args: deployment.args.trim() } : {}),
          at: new Date().toISOString(),
          ...(deployment.log ? { log: deployment.log, status: 'running' as const } : {}),
          ...(deployment.commit ? { commit: deployment.commit } : {}),
          ...(deployment.steps?.length ? { steps: deployment.steps } : {})
        };
        const deployments = appendTaskDeployment(specPaths, entry);
        if (!deployments) {
          return { success: false, error: 'Task not found' };
        }
        projectStore.invalidateTasksCache(projectId);
        return { success: true, data: deployments };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  );

  // PROJECT_CHECK_VERSION now just checks if project is initialized
  // Version tracking for .malvy is removed since it only contains data
  ipcMain.handle(
    IPC_CHANNELS.PROJECT_CHECK_VERSION,
    async (_, projectId: string): Promise<IPCResult<AutoBuildVersionInfo>> => {
      try {
        const project = projectStore.getProject(projectId);
        if (!project) {
          return { success: false, error: 'Project not found' };
        }

        return {
          success: true,
          data: {
            isInitialized: isInitialized(project.path),
            updateAvailable: false // No updates for .malvy - it's just data
          }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  );

  // Clear all project data (specs, tasks, github cache) from the .malvy directory.
  // The .malvy directory itself and .env config are preserved.
  ipcMain.handle(
    IPC_CHANNELS.PROJECT_CLEAR_DATA,
    async (_, projectId: string): Promise<IPCResult<void>> => {
      try {
        const project = projectStore.getProject(projectId);
        if (!project) {
          return { success: false, error: 'Project not found' };
        }
        if (!project.autoBuildPath) {
          return { success: false, error: 'Project is not initialized' };
        }

        const autoBuildDir = path.join(project.path, project.autoBuildPath);

        // Sub-directories that hold task/integration data — delete and recreate empty
        const dataDirs = ['specs', 'github', 'gitlab', 'azure-devops', 'roadmap', 'ideation'];
        for (const dir of dataDirs) {
          const dirPath = path.join(autoBuildDir, dir);
          if (existsSync(dirPath)) {
            await shell.trashItem(dirPath);
          }
        }

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  );

  // Check if project has local malvy source (is dev project)
  ipcMain.handle(
    'project:has-local-source',
    async (_, projectId: string): Promise<IPCResult<boolean>> => {
      try {
        const project = projectStore.getProject(projectId);
        if (!project) {
          return { success: false, error: 'Project not found' };
        }
        return { success: true, data: hasLocalSource(project.path) };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  );

  // ============================================
  // Git Operations
  // ============================================

  // Get all branches for a project (legacy - returns string[])
  ipcMain.handle(
    IPC_CHANNELS.GIT_GET_BRANCHES,
    async (_, projectPath: string): Promise<IPCResult<string[]>> => {
      try {
        if (!existsSync(projectPath)) {
          return { success: false, error: 'Directory does not exist' };
        }
        const branches = getGitBranches(projectPath);
        return { success: true, data: branches };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  );

  // Get all branches with structured type information (local vs remote)
  ipcMain.handle(
    IPC_CHANNELS.GIT_GET_BRANCHES_WITH_INFO,
    async (_, projectPath: string): Promise<IPCResult<GitBranchDetail[]>> => {
      try {
        if (!existsSync(projectPath)) {
          return { success: false, error: 'Directory does not exist' };
        }
        const branches = getGitBranchesWithInfo(projectPath);
        return { success: true, data: branches };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  );

  // Get current branch for a project
  ipcMain.handle(
    IPC_CHANNELS.GIT_GET_CURRENT_BRANCH,
    async (_, projectPath: string): Promise<IPCResult<string | null>> => {
      try {
        if (!existsSync(projectPath)) {
          return { success: false, error: 'Directory does not exist' };
        }
        const branch = getCurrentGitBranch(projectPath);
        return { success: true, data: branch };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  );

  // Auto-detect main branch for a project
  ipcMain.handle(
    IPC_CHANNELS.GIT_DETECT_MAIN_BRANCH,
    async (_, projectPath: string): Promise<IPCResult<string | null>> => {
      try {
        if (!existsSync(projectPath)) {
          return { success: false, error: 'Directory does not exist' };
        }
        const mainBranch = detectMainBranch(projectPath);
        return { success: true, data: mainBranch };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  );

  // Check git status for a project (is it a repo? has commits?)
  ipcMain.handle(
    IPC_CHANNELS.GIT_CHECK_STATUS,
    async (_, projectPath: string): Promise<IPCResult<GitStatus>> => {
      try {
        if (!existsSync(projectPath)) {
          return { success: false, error: 'Directory does not exist' };
        }
        const gitStatus = checkGitStatus(projectPath);
        return { success: true, data: gitStatus };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  );

  // Initialize git in a project (run git init and create initial commit)
  ipcMain.handle(
    IPC_CHANNELS.GIT_INITIALIZE,
    async (_, projectPath: string): Promise<IPCResult<InitializationResult>> => {
      try {
        if (!existsSync(projectPath)) {
          return { success: false, error: 'Directory does not exist' };
        }
        const result = initializeGit(projectPath);
        return { success: result.success, data: result, error: result.error };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  );
}
