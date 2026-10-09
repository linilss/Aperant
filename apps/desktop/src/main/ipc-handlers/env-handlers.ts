import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { IPC_CHANNELS, DEFAULT_APP_SETTINGS } from '../../shared/constants';
import type { IPCResult, ProjectEnvConfig, AppSettings } from '../../shared/types';
import path from 'path';
import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { projectStore } from '../project-store';
import { parseEnvFile } from './utils';
import { readSettingsFile } from '../settings-utils';
import { PROJECT_MEMORY_ENV_KEY, resolveMemoryEnabled } from '../ai/memory/memory-enabled';

// GitLab environment variable keys
const GITLAB_ENV_KEYS = {
  ENABLED: 'GITLAB_ENABLED',
  TOKEN: 'GITLAB_TOKEN',
  INSTANCE_URL: 'GITLAB_INSTANCE_URL',
  PROJECT: 'GITLAB_PROJECT'
} as const;

// Azure DevOps environment variable keys
const AZURE_DEVOPS_ENV_KEYS = {
  ENABLED: 'AZURE_DEVOPS_ENABLED',
  TOKEN: 'AZURE_DEVOPS_TOKEN',
  ORG_URL: 'AZURE_DEVOPS_ORG_URL',
  PROJECT: 'AZURE_DEVOPS_PROJECT'
} as const;

/**
 * Helper to generate .env line (DRY)
 */
function envLine(vars: Record<string, string>, key: string, defaultVal: string = ''): string {
  return vars[key] ? `${key}=${vars[key]}` : `# ${key}=${defaultVal}`;
}

/**
 * Register all env-related IPC handlers
 */
export function registerEnvHandlers(
  _getMainWindow: () => BrowserWindow | null
): void {
  // ============================================
  // Environment Configuration Operations
  // ============================================

  // Get settings file path
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');

  /**
   * Generate .env file content from config
   */
  const generateEnvContent = (
    config: Partial<ProjectEnvConfig>,
    existingContent?: string
  ): string => {
    // Parse existing content to preserve comments and structure
    const existingVars = existingContent ? parseEnvFile(existingContent) : {};

    // Update with new values
    if (config.autoBuildModel !== undefined) {
      existingVars['AUTO_BUILD_MODEL'] = config.autoBuildModel;
    }
    if (config.linearApiKey !== undefined) {
      existingVars['LINEAR_API_KEY'] = config.linearApiKey;
    }
    if (config.linearTeamId !== undefined) {
      existingVars['LINEAR_TEAM_ID'] = config.linearTeamId;
    }
    if (config.linearProjectId !== undefined) {
      existingVars['LINEAR_PROJECT_ID'] = config.linearProjectId;
    }
    // GitHub Integration
    if (config.githubToken !== undefined) {
      existingVars['GITHUB_TOKEN'] = config.githubToken;
    }
    if (config.githubRepo !== undefined) {
      existingVars['GITHUB_REPO'] = config.githubRepo;
    }
    // GitLab Integration
    if (config.gitlabEnabled !== undefined) {
      existingVars[GITLAB_ENV_KEYS.ENABLED] = config.gitlabEnabled ? 'true' : 'false';
    }
    if (config.gitlabToken !== undefined) {
      existingVars[GITLAB_ENV_KEYS.TOKEN] = config.gitlabToken;
    }
    if (config.gitlabInstanceUrl !== undefined) {
      existingVars[GITLAB_ENV_KEYS.INSTANCE_URL] = config.gitlabInstanceUrl;
    }
    if (config.gitlabProject !== undefined) {
      existingVars[GITLAB_ENV_KEYS.PROJECT] = config.gitlabProject;
    }
    // Azure DevOps Integration
    if (config.azureDevOpsEnabled !== undefined) {
      existingVars[AZURE_DEVOPS_ENV_KEYS.ENABLED] = config.azureDevOpsEnabled ? 'true' : 'false';
    }
    if (config.azureDevOpsToken !== undefined) {
      existingVars[AZURE_DEVOPS_ENV_KEYS.TOKEN] = config.azureDevOpsToken;
    }
    if (config.azureDevOpsOrgUrl !== undefined) {
      existingVars[AZURE_DEVOPS_ENV_KEYS.ORG_URL] = config.azureDevOpsOrgUrl;
    }
    if (config.azureDevOpsProject !== undefined) {
      existingVars[AZURE_DEVOPS_ENV_KEYS.PROJECT] = config.azureDevOpsProject;
    }
    // Git/Worktree Settings
    if (config.defaultBranch !== undefined) {
      existingVars['DEFAULT_BRANCH'] = config.defaultBranch;
    }
    // Built-in memory: only store a project override once it differs from the app-wide
    // setting (or one already exists), so untouched projects keep following the app setting.
    if (config.memoryEnabled !== undefined) {
      const inherited = readSettingsFile()?.memoryEnabled === true;
      if (existingVars[PROJECT_MEMORY_ENV_KEY] !== undefined || config.memoryEnabled !== inherited) {
        existingVars[PROJECT_MEMORY_ENV_KEY] = config.memoryEnabled ? 'true' : 'false';
      }
    }
    // MCP Server Configuration
    if (config.mcpServers) {
      if (config.mcpServers.context7Enabled !== undefined) {
        existingVars['CONTEXT7_ENABLED'] = config.mcpServers.context7Enabled ? 'true' : 'false';
      }
      if (config.mcpServers.linearMcpEnabled !== undefined) {
        existingVars['LINEAR_MCP_ENABLED'] = config.mcpServers.linearMcpEnabled ? 'true' : 'false';
      }
      if (config.mcpServers.electronEnabled !== undefined) {
        existingVars['ELECTRON_MCP_ENABLED'] = config.mcpServers.electronEnabled ? 'true' : 'false';
      }
      if (config.mcpServers.puppeteerEnabled !== undefined) {
        existingVars['PUPPETEER_MCP_ENABLED'] = config.mcpServers.puppeteerEnabled ? 'true' : 'false';
      }
      // Note: memoryEnabled is handled via the project memory key above
    }

    // Per-agent MCP overrides (add/remove MCPs from specific agents)
    if (config.agentMcpOverrides) {
      // First, clear any existing AGENT_MCP_* entries
      Object.keys(existingVars).forEach(key => {
        if (key.startsWith('AGENT_MCP_')) {
          delete existingVars[key];
        }
      });

      // Add new overrides
      Object.entries(config.agentMcpOverrides).forEach(([agentId, override]) => {
        if (override.add && override.add.length > 0) {
          existingVars[`AGENT_MCP_${agentId}_ADD`] = override.add.join(',');
        }
        if (override.remove && override.remove.length > 0) {
          existingVars[`AGENT_MCP_${agentId}_REMOVE`] = override.remove.join(',');
        }
      });
    }

    // Custom MCP servers (user-defined)
    if (config.customMcpServers !== undefined) {
      if (config.customMcpServers.length > 0) {
        existingVars['CUSTOM_MCP_SERVERS'] = JSON.stringify(config.customMcpServers);
      } else {
        delete existingVars['CUSTOM_MCP_SERVERS'];
      }
    }

    // Generate content with sections
    const content = `# Malvy Environment Variables
# Managed by the Malvy app

# Model override (OPTIONAL)
${existingVars['AUTO_BUILD_MODEL'] ? `AUTO_BUILD_MODEL=${existingVars['AUTO_BUILD_MODEL']}` : '# AUTO_BUILD_MODEL=claude-opus-5-5'}

# =============================================================================
# LINEAR INTEGRATION (OPTIONAL)
# =============================================================================
${existingVars['LINEAR_API_KEY'] ? `LINEAR_API_KEY=${existingVars['LINEAR_API_KEY']}` : '# LINEAR_API_KEY='}
${existingVars['LINEAR_TEAM_ID'] ? `LINEAR_TEAM_ID=${existingVars['LINEAR_TEAM_ID']}` : '# LINEAR_TEAM_ID='}
${existingVars['LINEAR_PROJECT_ID'] ? `LINEAR_PROJECT_ID=${existingVars['LINEAR_PROJECT_ID']}` : '# LINEAR_PROJECT_ID='}

# =============================================================================
# GITHUB INTEGRATION (OPTIONAL)
# =============================================================================
${existingVars['GITHUB_TOKEN'] ? `GITHUB_TOKEN=${existingVars['GITHUB_TOKEN']}` : '# GITHUB_TOKEN='}
${existingVars['GITHUB_REPO'] ? `GITHUB_REPO=${existingVars['GITHUB_REPO']}` : '# GITHUB_REPO=owner/repo'}

# =============================================================================
# GITLAB INTEGRATION (OPTIONAL)
# =============================================================================
${existingVars[GITLAB_ENV_KEYS.ENABLED] !== undefined ? `${GITLAB_ENV_KEYS.ENABLED}=${existingVars[GITLAB_ENV_KEYS.ENABLED]}` : `# ${GITLAB_ENV_KEYS.ENABLED}=true`}
${envLine(existingVars, GITLAB_ENV_KEYS.INSTANCE_URL, 'https://gitlab.com')}
${envLine(existingVars, GITLAB_ENV_KEYS.TOKEN)}
${envLine(existingVars, GITLAB_ENV_KEYS.PROJECT, 'group/project')}

# =============================================================================
# AZURE DEVOPS INTEGRATION (OPTIONAL)
# =============================================================================
${existingVars[AZURE_DEVOPS_ENV_KEYS.ENABLED] !== undefined ? `${AZURE_DEVOPS_ENV_KEYS.ENABLED}=${existingVars[AZURE_DEVOPS_ENV_KEYS.ENABLED]}` : `# ${AZURE_DEVOPS_ENV_KEYS.ENABLED}=true`}
${envLine(existingVars, AZURE_DEVOPS_ENV_KEYS.TOKEN)}
${envLine(existingVars, AZURE_DEVOPS_ENV_KEYS.ORG_URL, 'https://dev.azure.com/myorg')}
${envLine(existingVars, AZURE_DEVOPS_ENV_KEYS.PROJECT, 'MyProject')}

# =============================================================================
# GIT/WORKTREE SETTINGS (OPTIONAL)
# =============================================================================
# Default base branch for worktree creation
# If not set, Malvy will auto-detect main/master, or fall back to current branch
${existingVars['DEFAULT_BRANCH'] ? `DEFAULT_BRANCH=${existingVars['DEFAULT_BRANCH']}` : '# DEFAULT_BRANCH=main'}

# =============================================================================
# MCP SERVER CONFIGURATION (per-project overrides)
# =============================================================================
# Context7 documentation lookup (default: enabled)
${existingVars['CONTEXT7_ENABLED'] !== undefined ? `CONTEXT7_ENABLED=${existingVars['CONTEXT7_ENABLED']}` : '# CONTEXT7_ENABLED=true'}
# Linear MCP integration (default: follows LINEAR_API_KEY)
${existingVars['LINEAR_MCP_ENABLED'] !== undefined ? `LINEAR_MCP_ENABLED=${existingVars['LINEAR_MCP_ENABLED']}` : '# LINEAR_MCP_ENABLED=true'}
# Electron desktop automation - QA agents only (default: disabled)
${existingVars['ELECTRON_MCP_ENABLED'] !== undefined ? `ELECTRON_MCP_ENABLED=${existingVars['ELECTRON_MCP_ENABLED']}` : '# ELECTRON_MCP_ENABLED=false'}
# Puppeteer browser automation - QA agents only (default: disabled)
${existingVars['PUPPETEER_MCP_ENABLED'] !== undefined ? `PUPPETEER_MCP_ENABLED=${existingVars['PUPPETEER_MCP_ENABLED']}` : '# PUPPETEER_MCP_ENABLED=false'}

# =============================================================================
# PER-AGENT MCP OVERRIDES
# Add or remove MCP servers for specific agents
# Format: AGENT_MCP_<agent_type>_ADD=server1,server2
# Format: AGENT_MCP_<agent_type>_REMOVE=server1,server2
# =============================================================================
${Object.entries(existingVars)
  .filter(([key]) => key.startsWith('AGENT_MCP_'))
  .map(([key, value]) => `${key}=${value}`)
  .join('\n') || '# No per-agent overrides configured'}

# =============================================================================
# CUSTOM MCP SERVERS
# User-defined MCP servers (command-based or HTTP-based)
# JSON format: [{"id":"...","name":"...","type":"command|http",...}]
# =============================================================================
${existingVars['CUSTOM_MCP_SERVERS'] ? `CUSTOM_MCP_SERVERS=${existingVars['CUSTOM_MCP_SERVERS']}` : '# CUSTOM_MCP_SERVERS=[]'}

# =============================================================================
# MEMORY (built-in agent memory)
# GRAPHITI_ENABLED (legacy key name): true/false overrides the app setting; unset = follow it
# The embedding keys below are kept as-is but no longer read: the memory service
# uses the app-wide embedding settings
# =============================================================================
${existingVars['GRAPHITI_ENABLED'] ? `GRAPHITI_ENABLED=${existingVars['GRAPHITI_ENABLED']}` : '# GRAPHITI_ENABLED=true'}

# Embedding Provider (for semantic search - optional, keyword search works without)
${existingVars['GRAPHITI_EMBEDDER_PROVIDER'] ? `GRAPHITI_EMBEDDER_PROVIDER=${existingVars['GRAPHITI_EMBEDDER_PROVIDER']}` : '# GRAPHITI_EMBEDDER_PROVIDER=ollama'}

# OpenAI Embeddings
${existingVars['OPENAI_API_KEY'] ? `OPENAI_API_KEY=${existingVars['OPENAI_API_KEY']}` : '# OPENAI_API_KEY='}
${existingVars['OPENAI_EMBEDDING_MODEL'] ? `OPENAI_EMBEDDING_MODEL=${existingVars['OPENAI_EMBEDDING_MODEL']}` : '# OPENAI_EMBEDDING_MODEL=text-embedding-3-small'}

# Azure OpenAI Embeddings
${existingVars['AZURE_OPENAI_API_KEY'] ? `AZURE_OPENAI_API_KEY=${existingVars['AZURE_OPENAI_API_KEY']}` : '# AZURE_OPENAI_API_KEY='}
${existingVars['AZURE_OPENAI_BASE_URL'] ? `AZURE_OPENAI_BASE_URL=${existingVars['AZURE_OPENAI_BASE_URL']}` : '# AZURE_OPENAI_BASE_URL='}
${existingVars['AZURE_OPENAI_EMBEDDING_DEPLOYMENT'] ? `AZURE_OPENAI_EMBEDDING_DEPLOYMENT=${existingVars['AZURE_OPENAI_EMBEDDING_DEPLOYMENT']}` : '# AZURE_OPENAI_EMBEDDING_DEPLOYMENT='}

# Voyage AI Embeddings
${existingVars['VOYAGE_API_KEY'] ? `VOYAGE_API_KEY=${existingVars['VOYAGE_API_KEY']}` : '# VOYAGE_API_KEY='}
${existingVars['VOYAGE_EMBEDDING_MODEL'] ? `VOYAGE_EMBEDDING_MODEL=${existingVars['VOYAGE_EMBEDDING_MODEL']}` : '# VOYAGE_EMBEDDING_MODEL=voyage-3'}

# Google AI Embeddings
${existingVars['GOOGLE_API_KEY'] ? `GOOGLE_API_KEY=${existingVars['GOOGLE_API_KEY']}` : '# GOOGLE_API_KEY='}
${existingVars['GOOGLE_EMBEDDING_MODEL'] ? `GOOGLE_EMBEDDING_MODEL=${existingVars['GOOGLE_EMBEDDING_MODEL']}` : '# GOOGLE_EMBEDDING_MODEL=text-embedding-004'}

# Ollama Embeddings (Local - free)
${existingVars['OLLAMA_BASE_URL'] ? `OLLAMA_BASE_URL=${existingVars['OLLAMA_BASE_URL']}` : '# OLLAMA_BASE_URL=http://localhost:11434'}
${existingVars['OLLAMA_EMBEDDING_MODEL'] ? `OLLAMA_EMBEDDING_MODEL=${existingVars['OLLAMA_EMBEDDING_MODEL']}` : '# OLLAMA_EMBEDDING_MODEL=embeddinggemma'}
${existingVars['OLLAMA_EMBEDDING_DIM'] ? `OLLAMA_EMBEDDING_DIM=${existingVars['OLLAMA_EMBEDDING_DIM']}` : '# OLLAMA_EMBEDDING_DIM=768'}

`;

    return content;
  };

  ipcMain.handle(
    IPC_CHANNELS.ENV_GET,
    async (_, projectId: string): Promise<IPCResult<ProjectEnvConfig>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      if (!project.autoBuildPath) {
        return { success: false, error: 'Project not initialized' };
      }

      const envPath = path.join(project.path, project.autoBuildPath, '.env');

      // Load global settings for fallbacks
      let globalSettings: AppSettings = { ...DEFAULT_APP_SETTINGS };
      if (existsSync(settingsPath)) {
        try {
          const content = readFileSync(settingsPath, 'utf-8');
          globalSettings = { ...globalSettings, ...JSON.parse(content) };
        } catch {
          // Use defaults
        }
      }

      // Default config
      const config: ProjectEnvConfig = {
        linearEnabled: false,
        githubEnabled: false,
        gitlabEnabled: false,
        azureDevOpsEnabled: false,
        memoryEnabled: false
      };

      // Parse project-specific .env if it exists
      let vars: Record<string, string> = {};
      if (existsSync(envPath)) {
        try {
          const content = readFileSync(envPath, 'utf-8');
          vars = parseEnvFile(content);
        } catch {
          // Continue with empty vars
        }
      }

      if (vars['AUTO_BUILD_MODEL']) {
        config.autoBuildModel = vars['AUTO_BUILD_MODEL'];
      }

      if (vars['LINEAR_API_KEY']) {
        config.linearEnabled = true;
        config.linearApiKey = vars['LINEAR_API_KEY'];
      }
      if (vars['LINEAR_TEAM_ID']) {
        config.linearTeamId = vars['LINEAR_TEAM_ID'];
      }
      if (vars['LINEAR_PROJECT_ID']) {
        config.linearProjectId = vars['LINEAR_PROJECT_ID'];
      }

      // GitHub config
      if (vars['GITHUB_TOKEN']) {
        config.githubEnabled = true;
        config.githubToken = vars['GITHUB_TOKEN'];
      }
      if (vars['GITHUB_REPO']) {
        config.githubRepo = vars['GITHUB_REPO'];
      }

      // GitLab config
      if (vars[GITLAB_ENV_KEYS.TOKEN]) {
        config.gitlabToken = vars[GITLAB_ENV_KEYS.TOKEN];
        // Enable by default if token exists and GITLAB_ENABLED is not explicitly false
        config.gitlabEnabled = vars[GITLAB_ENV_KEYS.ENABLED]?.toLowerCase() !== 'false';
      }
      if (vars[GITLAB_ENV_KEYS.INSTANCE_URL]) {
        config.gitlabInstanceUrl = vars[GITLAB_ENV_KEYS.INSTANCE_URL];
      }
      if (vars[GITLAB_ENV_KEYS.PROJECT]) {
        config.gitlabProject = vars[GITLAB_ENV_KEYS.PROJECT];
      }

      // Azure DevOps config
      if (vars[AZURE_DEVOPS_ENV_KEYS.TOKEN]) {
        config.azureDevOpsToken = vars[AZURE_DEVOPS_ENV_KEYS.TOKEN];
        // Enable by default if token exists and AZURE_DEVOPS_ENABLED is not explicitly false
        config.azureDevOpsEnabled = vars[AZURE_DEVOPS_ENV_KEYS.ENABLED]?.toLowerCase() !== 'false';
      }
      if (vars[AZURE_DEVOPS_ENV_KEYS.ORG_URL]) {
        config.azureDevOpsOrgUrl = vars[AZURE_DEVOPS_ENV_KEYS.ORG_URL];
      }
      if (vars[AZURE_DEVOPS_ENV_KEYS.PROJECT]) {
        config.azureDevOpsProject = vars[AZURE_DEVOPS_ENV_KEYS.PROJECT];
      }

      // Git/Worktree config
      if (vars['DEFAULT_BRANCH']) {
        config.defaultBranch = vars['DEFAULT_BRANCH'];
      }

      // Built-in memory: project setting wins, else the app-wide (onboarding) setting
      config.memoryEnabled = resolveMemoryEnabled(globalSettings.memoryEnabled, vars[PROJECT_MEMORY_ENV_KEY]);

      // MCP Server Configuration (per-project overrides)
      // Default: context7=true, linear=true (if API key set), electron/puppeteer=false
      config.mcpServers = {
        context7Enabled: vars['CONTEXT7_ENABLED']?.toLowerCase() !== 'false', // default true
        linearMcpEnabled: vars['LINEAR_MCP_ENABLED']?.toLowerCase() !== 'false', // default true
        electronEnabled: vars['ELECTRON_MCP_ENABLED']?.toLowerCase() === 'true', // default false
        puppeteerEnabled: vars['PUPPETEER_MCP_ENABLED']?.toLowerCase() === 'true', // default false
      };

      // Parse per-agent MCP overrides (AGENT_MCP_<agent>_ADD/REMOVE)
      const agentMcpOverrides: Record<string, { add?: string[]; remove?: string[] }> = {};
      Object.entries(vars).forEach(([key, value]) => {
        if (key.startsWith('AGENT_MCP_') && key.endsWith('_ADD')) {
          const agentId = key.replace('AGENT_MCP_', '').replace('_ADD', '');
          if (!agentMcpOverrides[agentId]) agentMcpOverrides[agentId] = {};
          agentMcpOverrides[agentId].add = value.split(',').map(s => s.trim()).filter(Boolean);
        } else if (key.startsWith('AGENT_MCP_') && key.endsWith('_REMOVE')) {
          const agentId = key.replace('AGENT_MCP_', '').replace('_REMOVE', '');
          if (!agentMcpOverrides[agentId]) agentMcpOverrides[agentId] = {};
          agentMcpOverrides[agentId].remove = value.split(',').map(s => s.trim()).filter(Boolean);
        }
      });

      if (Object.keys(agentMcpOverrides).length > 0) {
        config.agentMcpOverrides = agentMcpOverrides;
      }

      // Parse custom MCP servers (user-defined)
      if (vars['CUSTOM_MCP_SERVERS']) {
        try {
          config.customMcpServers = JSON.parse(vars['CUSTOM_MCP_SERVERS']);
        } catch {
          // Invalid JSON, ignore
          config.customMcpServers = [];
        }
      }

      return { success: true, data: config };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.ENV_UPDATE,
    async (_, projectId: string, config: Partial<ProjectEnvConfig>): Promise<IPCResult> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      if (!project.autoBuildPath) {
        return { success: false, error: 'Project not initialized' };
      }

      const envPath = path.join(project.path, project.autoBuildPath, '.env');

      try {
        // Read existing content if file exists (atomic read, no TOCTOU)
        let existingContent: string | undefined;
        try {
          existingContent = readFileSync(envPath, 'utf-8');
        } catch (readErr: unknown) {
          if ((readErr as NodeJS.ErrnoException).code !== 'ENOENT') throw readErr;
          // File doesn't exist yet - existingContent stays undefined
        }

        // Generate new content
        const newContent = generateEnvContent(config, existingContent);

        // Write to file
        writeFileSync(envPath, newContent, 'utf-8');

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update .env file'
        };
      }
    }
  );

}
