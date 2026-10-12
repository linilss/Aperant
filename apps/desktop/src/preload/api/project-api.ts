import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type {
  Project,
  ProjectSettings,
  IPCResult,
  InitializationResult,
  AutoBuildVersionInfo,
  ProjectEnvConfig,
  GitStatus,
  KanbanPreferences,
  GitBranchDetail,
  InfrastructureStatus,
  MemoryValidationResult,
  DeployScript,
  DeployPreflight,
  TaskDeployment,
  ClaudeDocsListing,
  DocPointer,
  CreatePointerInput,
  DocProposal,
  ApplyDocProposalsResult,
  CodeBranch,
  ProjectSummary,
  PendingDocsState,
  DocsOptimizeOptions,
  DocsOptimizerResult,
  BranchProgressEvent,
  CoreValues,
  SaveCoreValuesResult,
  DesignSystemState,
  DesignPublishPlan,
  DesignSystemRunResult,
  FunnelProgress
} from '../../shared/types';

// Tab state interface (persisted in main process)
export interface TabState {
  openProjectIds: string[];
  activeProjectId: string | null;
  tabOrder: string[];
}

export interface ProjectAPI {
  // Project Management
  addProject: (projectPath: string) => Promise<IPCResult<Project>>;
  removeProject: (projectId: string) => Promise<IPCResult>;
  getProjects: () => Promise<IPCResult<Project[]>>;
  updateProjectSettings: (
    projectId: string,
    settings: Partial<ProjectSettings>
  ) => Promise<IPCResult>;
  initializeProject: (projectId: string) => Promise<IPCResult<InitializationResult>>;
  checkProjectVersion: (projectId: string) => Promise<IPCResult<AutoBuildVersionInfo>>;
  clearProjectData: (projectId: string) => Promise<IPCResult<void>>;
  listDeployScripts: (projectId: string) => Promise<IPCResult<DeployScript[]>>;
  getDeployPreflight: (projectId: string) => Promise<IPCResult<DeployPreflight>>;
  /** Path of a clean, detached checkout of the project's HEAD to deploy from */
  prepareDeployCheckout: (projectId: string) => Promise<IPCResult<string>>;
  recordTaskDeployment: (
    projectId: string,
    taskId: string,
    deployment: { script: string; args?: string }
  ) => Promise<IPCResult<TaskDeployment[]>>;

  // Plan funnel (project tab progress, sidebar checks)
  getFunnelProgress: (projectIds: string[]) => Promise<IPCResult<Record<string, FunnelProgress>>>;
  onFunnelChanged: (cb: (projectId: string) => void) => () => void;

  // Tab State (persisted in main process for reliability)
  getTabState: () => Promise<IPCResult<TabState>>;
  saveTabState: (tabState: TabState) => Promise<IPCResult>;

  // Kanban Preferences (persisted in main process per project)
  getKanbanPreferences: (projectId: string) => Promise<IPCResult<KanbanPreferences | null>>;
  saveKanbanPreferences: (projectId: string, preferences: KanbanPreferences) => Promise<IPCResult>;

  // Context Operations
  getProjectContext: (projectId: string) => Promise<IPCResult<unknown>>;
  refreshProjectIndex: (projectId: string) => Promise<IPCResult<unknown>>;
  getMemoryStatus: (projectId: string) => Promise<IPCResult<unknown>>;
  searchMemories: (projectId: string, query: string) => Promise<IPCResult<unknown>>;
  getRecentMemories: (projectId: string, limit?: number) => Promise<IPCResult<unknown>>;

  // CLAUDE.md docs tree + optimizer
  listClaudeDocs: (projectId: string) => Promise<IPCResult<ClaudeDocsListing>>;
  readClaudeDoc: (projectId: string, relativePath: string) => Promise<IPCResult<string>>;
  listCodeBranches: (projectId: string) => Promise<IPCResult<CodeBranch[]>>;
  getProjectSummary: (projectId: string) => Promise<IPCResult<ProjectSummary | null>>;
  getCoreValues: (projectId: string) => Promise<IPCResult<CoreValues>>;
  saveCoreValues: (projectId: string, text: string) => Promise<IPCResult<SaveCoreValuesResult>>;
  /** AI first draft from the project summary + root docs (not saved) */
  draftCoreValues: (projectId: string) => Promise<IPCResult<string>>;
  getPendingDocsRun: (projectId: string) => Promise<IPCResult<PendingDocsState>>;
  discardPendingDocsRun: (projectId: string) => Promise<IPCResult>;
  optimizeClaudeDocs: (projectId: string, options?: DocsOptimizeOptions) => void;
  stopClaudeDocsOptimizer: (projectId: string) => void;
  applyDocProposals: (projectId: string, proposals: DocProposal[]) => Promise<IPCResult<ApplyDocProposalsResult>>;
  onDocsOptimizerChunk: (cb: (projectId: string, chunk: string) => void) => () => void;
  onDocsOptimizerBranchProgress: (cb: (projectId: string, progress: BranchProgressEvent) => void) => () => void;
  onDocsOptimizerComplete: (cb: (projectId: string, result: DocsOptimizerResult) => void) => () => void;
  onDocsOptimizerError: (cb: (projectId: string, error: string) => void) => () => void;

  // Design system (Design view)
  getDesignSystem: (projectId: string) => Promise<IPCResult<DesignSystemState>>;
  /** Empty strings clear an override */
  saveDesignSystemOverrides: (
    projectId: string,
    input: { artifactUrl?: string; sourceDir?: string }
  ) => Promise<IPCResult<DesignSystemState>>;
  readDesignSystemFile: (projectId: string, relativePath: string) => Promise<IPCResult<string>>;
  getDesignPublishPlan: (projectId: string) => Promise<IPCResult<DesignPublishPlan | null>>;
  /** Read-only: snapshot the artifact into .malvy/design-system/ */
  syncDesignSystem: (projectId: string) => Promise<IPCResult<DesignSystemRunResult>>;
  /** User-confirmed publish of these artifact paths */
  publishDesignSystem: (projectId: string, paths: string[]) => Promise<IPCResult<DesignSystemRunResult>>;
  onDesignSystemProgress: (cb: (projectId: string, text: string) => void) => () => void;

  // Memory Infrastructure operations (built-in memory, libSQL)
  getMemoryInfrastructureStatus: (dbPath?: string) => Promise<IPCResult<InfrastructureStatus>>;
  listMemoryDatabases: (dbPath?: string) => Promise<IPCResult<string[]>>;
  testMemoryConnection: (dbPath?: string, database?: string) => Promise<IPCResult<MemoryValidationResult>>;

  // Memory Management
  verifyMemory: (memoryId: string) => Promise<IPCResult<void>>;
  pinMemory: (memoryId: string, pinned: boolean) => Promise<IPCResult<void>>;
  deprecateMemory: (memoryId: string) => Promise<IPCResult<void>>;
  deleteMemory: (memoryId: string) => Promise<IPCResult<void>>;

  // Developer pointers (user_taught memories)
  listPointers: (projectId: string) => Promise<IPCResult<DocPointer[]>>;
  createPointer: (projectId: string, input: CreatePointerInput) => Promise<IPCResult<DocPointer>>;
  updatePointer: (projectId: string, memoryId: string, content: string) => Promise<IPCResult<void>>;
  deletePointer: (projectId: string, memoryId: string) => Promise<IPCResult<void>>;

  // Environment Configuration
  getProjectEnv: (projectId: string) => Promise<IPCResult<ProjectEnvConfig>>;
  updateProjectEnv: (projectId: string, config: Partial<ProjectEnvConfig>) => Promise<IPCResult>;

  // Dialog Operations
  selectDirectory: () => Promise<string | null>;
  createProjectFolder: (
    location: string,
    name: string,
    initGit: boolean
  ) => Promise<IPCResult<import('../../shared/types').CreateProjectFolderResult>>;
  getDefaultProjectLocation: () => Promise<string | null>;

   // Ollama model download progress
   onDownloadProgress: (callback: (data: {
     modelName: string;
     status: string;
     completed: number;
     total: number;
     percentage: number;
   }) => void) => () => void;

   // Git Operations
  /** @deprecated Use getGitBranchesWithInfo for structured branch data with type indicators */
  getGitBranches: (projectPath: string) => Promise<IPCResult<string[]>>;
  /** Get branches with structured type information (local vs remote) */
  getGitBranchesWithInfo: (projectPath: string) => Promise<IPCResult<GitBranchDetail[]>>;
  getCurrentGitBranch: (projectPath: string) => Promise<IPCResult<string | null>>;
  detectMainBranch: (projectPath: string) => Promise<IPCResult<string | null>>;
  checkGitStatus: (projectPath: string) => Promise<IPCResult<GitStatus>>;
  initializeGit: (projectPath: string) => Promise<IPCResult<InitializationResult>>;

  // Ollama Model Detection
  checkOllamaStatus: (baseUrl?: string) => Promise<IPCResult<{
    running: boolean;
    url: string;
    version?: string;
    message?: string;
  }>>;
  checkOllamaInstalled: () => Promise<IPCResult<{
    installed: boolean;
    path?: string;
    version?: string;
  }>>;
  installOllama: () => Promise<IPCResult<{ command: string }>>;
  listOllamaModels: (baseUrl?: string) => Promise<IPCResult<{
    models: Array<{
      name: string;
      size_bytes: number;
      size_gb: number;
      modified_at: string;
      is_embedding: boolean;
      embedding_dim?: number | null;
      description?: string;
    }>;
    count: number;
  }>>;
  listOllamaEmbeddingModels: (baseUrl?: string) => Promise<IPCResult<{
    embedding_models: Array<{
      name: string;
      embedding_dim: number | null;
      description: string;
      size_bytes: number;
      size_gb: number;
    }>;
    count: number;
  }>>;
  pullOllamaModel: (modelName: string, baseUrl?: string) => Promise<IPCResult<{
    model: string;
    status: 'completed' | 'failed';
    output: string[];
  }>>;
}

export const createProjectAPI = (): ProjectAPI => ({
  // Project Management
  addProject: (projectPath: string): Promise<IPCResult<Project>> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_ADD, projectPath),

  removeProject: (projectId: string): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_REMOVE, projectId),

  getProjects: (): Promise<IPCResult<Project[]>> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_LIST),

  updateProjectSettings: (
    projectId: string,
    settings: Partial<ProjectSettings>
  ): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_UPDATE_SETTINGS, projectId, settings),

  initializeProject: (projectId: string): Promise<IPCResult<InitializationResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_INITIALIZE, projectId),

  checkProjectVersion: (projectId: string): Promise<IPCResult<AutoBuildVersionInfo>> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_CHECK_VERSION, projectId),

  clearProjectData: (projectId: string): Promise<IPCResult<void>> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_CLEAR_DATA, projectId),

  listDeployScripts: (projectId: string): Promise<IPCResult<DeployScript[]>> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_LIST_DEPLOY_SCRIPTS, projectId),

  getDeployPreflight: (projectId: string): Promise<IPCResult<DeployPreflight>> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_DEPLOY_PREFLIGHT, projectId),
  prepareDeployCheckout: (projectId: string): Promise<IPCResult<string>> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_DEPLOY_CLEAN_CHECKOUT, projectId),

  recordTaskDeployment: (
    projectId: string,
    taskId: string,
    deployment: { script: string; args?: string }
  ): Promise<IPCResult<TaskDeployment[]>> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_RECORD_TASK_DEPLOYMENT, projectId, taskId, deployment),

  getFunnelProgress: (projectIds: string[]): Promise<IPCResult<Record<string, FunnelProgress>>> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_FUNNEL_PROGRESS, projectIds),

  onFunnelChanged: (cb: (projectId: string) => void) => {
    const listener = (_: Electron.IpcRendererEvent, projectId: string) => cb(projectId);
    ipcRenderer.on(IPC_CHANNELS.PROJECT_FUNNEL_CHANGED, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.PROJECT_FUNNEL_CHANGED, listener);
  },

  // Tab State (persisted in main process for reliability)
  getTabState: (): Promise<IPCResult<TabState>> =>
    ipcRenderer.invoke(IPC_CHANNELS.TAB_STATE_GET),

  saveTabState: (tabState: TabState): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.TAB_STATE_SAVE, tabState),

  // Kanban Preferences (persisted in main process per project)
  getKanbanPreferences: (projectId: string): Promise<IPCResult<KanbanPreferences | null>> =>
    ipcRenderer.invoke(IPC_CHANNELS.KANBAN_PREFS_GET, projectId),

  saveKanbanPreferences: (projectId: string, preferences: KanbanPreferences): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.KANBAN_PREFS_SAVE, projectId, preferences),

  // Context Operations
  getProjectContext: (projectId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_GET, projectId),

  refreshProjectIndex: (projectId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_REFRESH_INDEX, projectId),

  getMemoryStatus: (projectId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_MEMORY_STATUS, projectId),

  searchMemories: (projectId: string, query: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_SEARCH_MEMORIES, projectId, query),

  getRecentMemories: (projectId: string, limit?: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_GET_MEMORIES, projectId, limit),

  // CLAUDE.md docs tree + optimizer
  listClaudeDocs: (projectId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_DOCS_LIST, projectId),

  readClaudeDoc: (projectId: string, relativePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_DOCS_READ, projectId, relativePath),

  listCodeBranches: (projectId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_DOCS_BRANCHES, projectId),

  getProjectSummary: (projectId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_DOCS_SUMMARY, projectId),

  getCoreValues: (projectId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_CORE_VALUES_GET, projectId),

  saveCoreValues: (projectId: string, text: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_CORE_VALUES_SAVE, projectId, text),

  draftCoreValues: (projectId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_CORE_VALUES_DRAFT, projectId),

  getDesignSystem: (projectId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_DESIGN_GET, projectId),

  saveDesignSystemOverrides: (projectId: string, input: { artifactUrl?: string; sourceDir?: string }) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_DESIGN_SAVE_OVERRIDES, projectId, input),

  readDesignSystemFile: (projectId: string, relativePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_DESIGN_READ_FILE, projectId, relativePath),

  getDesignPublishPlan: (projectId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_DESIGN_PUBLISH_PLAN, projectId),

  syncDesignSystem: (projectId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_DESIGN_SYNC, projectId),

  publishDesignSystem: (projectId: string, paths: string[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_DESIGN_PUBLISH, projectId, paths),

  onDesignSystemProgress: (cb: (projectId: string, text: string) => void) => {
    const listener = (_: Electron.IpcRendererEvent, projectId: string, text: string) => cb(projectId, text);
    ipcRenderer.on(IPC_CHANNELS.CONTEXT_DESIGN_PROGRESS, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.CONTEXT_DESIGN_PROGRESS, listener);
  },

  getPendingDocsRun: (projectId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_DOCS_PENDING, projectId),

  discardPendingDocsRun: (projectId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_DOCS_DISCARD, projectId),

  optimizeClaudeDocs: (projectId: string, options?: DocsOptimizeOptions) =>
    ipcRenderer.send(IPC_CHANNELS.CONTEXT_DOCS_OPTIMIZE, projectId, options),

  stopClaudeDocsOptimizer: (projectId: string) =>
    ipcRenderer.send(IPC_CHANNELS.CONTEXT_DOCS_STOP, projectId),

  applyDocProposals: (projectId: string, proposals: DocProposal[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_DOCS_APPLY, projectId, proposals),

  onDocsOptimizerChunk: (cb: (projectId: string, chunk: string) => void) => {
    const listener = (_: Electron.IpcRendererEvent, projectId: string, chunk: string) =>
      cb(projectId, chunk);
    ipcRenderer.on(IPC_CHANNELS.CONTEXT_DOCS_CHUNK, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.CONTEXT_DOCS_CHUNK, listener);
  },

  onDocsOptimizerBranchProgress: (cb: (projectId: string, progress: BranchProgressEvent) => void) => {
    const listener = (_: Electron.IpcRendererEvent, projectId: string, progress: BranchProgressEvent) =>
      cb(projectId, progress);
    ipcRenderer.on(IPC_CHANNELS.CONTEXT_DOCS_BRANCH_PROGRESS, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.CONTEXT_DOCS_BRANCH_PROGRESS, listener);
  },

  onDocsOptimizerComplete: (cb: (projectId: string, result: DocsOptimizerResult) => void) => {
    const listener = (_: Electron.IpcRendererEvent, projectId: string, result: DocsOptimizerResult) =>
      cb(projectId, result);
    ipcRenderer.on(IPC_CHANNELS.CONTEXT_DOCS_COMPLETE, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.CONTEXT_DOCS_COMPLETE, listener);
  },

  onDocsOptimizerError: (cb: (projectId: string, error: string) => void) => {
    const listener = (_: Electron.IpcRendererEvent, projectId: string, error: string) =>
      cb(projectId, error);
    ipcRenderer.on(IPC_CHANNELS.CONTEXT_DOCS_ERROR, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.CONTEXT_DOCS_ERROR, listener);
  },

  // Memory Management
  verifyMemory: (memoryId: string): Promise<IPCResult<void>> =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_MEMORY_VERIFY, memoryId),

  pinMemory: (memoryId: string, pinned: boolean): Promise<IPCResult<void>> =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_MEMORY_PIN, memoryId, pinned),

  deprecateMemory: (memoryId: string): Promise<IPCResult<void>> =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_MEMORY_DEPRECATE, memoryId),

  deleteMemory: (memoryId: string): Promise<IPCResult<void>> =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_MEMORY_DELETE, memoryId),

  // Developer pointers (user_taught memories)
  listPointers: (projectId: string): Promise<IPCResult<DocPointer[]>> =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_POINTERS_LIST, projectId),

  createPointer: (projectId: string, input: CreatePointerInput): Promise<IPCResult<DocPointer>> =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_MEMORY_CREATE, projectId, input),

  updatePointer: (projectId: string, memoryId: string, content: string): Promise<IPCResult<void>> =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_MEMORY_UPDATE, projectId, memoryId, content),

  deletePointer: (projectId: string, memoryId: string): Promise<IPCResult<void>> =>
    ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_POINTERS_DELETE, projectId, memoryId),

  // Environment Configuration
  getProjectEnv: (projectId: string): Promise<IPCResult<ProjectEnvConfig>> =>
    ipcRenderer.invoke(IPC_CHANNELS.ENV_GET, projectId),

  updateProjectEnv: (projectId: string, config: Partial<ProjectEnvConfig>): Promise<IPCResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.ENV_UPDATE, projectId, config),

  // Dialog Operations
  selectDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SELECT_DIRECTORY),

  createProjectFolder: (
    location: string,
    name: string,
    initGit: boolean
  ): Promise<IPCResult<import('../../shared/types').CreateProjectFolderResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.DIALOG_CREATE_PROJECT_FOLDER, location, name, initGit),

  getDefaultProjectLocation: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.DIALOG_GET_DEFAULT_PROJECT_LOCATION),

  // Ollama model download progress
  onDownloadProgress: (callback: (data: {
    modelName: string;
    status: string;
    completed: number;
    total: number;
    percentage: number;
  }) => void) => {
    const listener = (_: any, data: any) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.OLLAMA_PULL_PROGRESS, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.OLLAMA_PULL_PROGRESS, listener);
  },

  // Git Operations
  getGitBranches: (projectPath: string): Promise<IPCResult<string[]>> =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_GET_BRANCHES, projectPath),

  getGitBranchesWithInfo: (projectPath: string): Promise<IPCResult<GitBranchDetail[]>> =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_GET_BRANCHES_WITH_INFO, projectPath),

  getCurrentGitBranch: (projectPath: string): Promise<IPCResult<string | null>> =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_GET_CURRENT_BRANCH, projectPath),

  detectMainBranch: (projectPath: string): Promise<IPCResult<string | null>> =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_DETECT_MAIN_BRANCH, projectPath),

  checkGitStatus: (projectPath: string): Promise<IPCResult<GitStatus>> =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_CHECK_STATUS, projectPath),

  initializeGit: (projectPath: string): Promise<IPCResult<InitializationResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.GIT_INITIALIZE, projectPath),

  // Ollama Model Detection
  checkOllamaStatus: (baseUrl?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.OLLAMA_CHECK_STATUS, baseUrl),

  checkOllamaInstalled: () =>
    ipcRenderer.invoke(IPC_CHANNELS.OLLAMA_CHECK_INSTALLED),

  installOllama: () =>
    ipcRenderer.invoke(IPC_CHANNELS.OLLAMA_INSTALL),

  listOllamaModels: (baseUrl?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.OLLAMA_LIST_MODELS, baseUrl),

  listOllamaEmbeddingModels: (baseUrl?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.OLLAMA_LIST_EMBEDDING_MODELS, baseUrl),

  pullOllamaModel: (modelName: string, baseUrl?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.OLLAMA_PULL_MODEL, modelName, baseUrl),

  // Memory Infrastructure operations (built-in memory, libSQL)
  getMemoryInfrastructureStatus: (dbPath?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.INFRASTRUCTURE_GET_STATUS, dbPath),

  listMemoryDatabases: (dbPath?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.INFRASTRUCTURE_LIST_DATABASES, dbPath),

  testMemoryConnection: (dbPath?: string, database?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.INFRASTRUCTURE_TEST_CONNECTION, dbPath, database)
});
