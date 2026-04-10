/**
 * Azure DevOps utility functions
 */

import { readFile, access } from 'fs/promises';
import { execFileSync } from 'child_process';
import path from 'path';
import type { Project } from '../../../shared/types';
import { parseEnvFile } from '../utils';
import type { AzureDevOpsConfig } from './types';
import { getIsolatedGitEnv } from '../../utils/git-isolation';

/**
 * Custom error class for Azure DevOps API errors with structured status code
 */
export class AzureDevOpsAPIError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'AzureDevOpsAPIError';
    this.statusCode = statusCode;
  }
}

/**
 * Strip control characters and validate token string
 */
function sanitizeToken(value: string | undefined): string | null {
  if (!value) return null;
  let sanitized = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      continue;
    }
    sanitized += value[i];
  }
  const trimmed = sanitized.trim();
  if (!trimmed) return null;
  return trimmed.length > 512 ? trimmed.substring(0, 512) : trimmed;
}

/**
 * Validate and normalize the Azure DevOps org URL.
 * Must be an https URL. Trailing slash is stripped.
 */
function sanitizeOrgUrl(value: string | undefined): string | null {
  if (!value) return null;
  const candidate = value.trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    if (parsed.username || parsed.password) {
      return null;
    }
    if (!parsed.hostname) {
      return null;
    }
    // Return origin (scheme + host + port) — strips trailing slash and path
    // Preserve path for cases like https://dev.azure.com/org
    const normalized = candidate.replace(/\/+$/, '');
    return normalized;
  } catch {
    return null;
  }
}

/**
 * Sanitize a project name: strip control characters, enforce max length
 */
function sanitizeProjectName(value: string | undefined): string | null {
  if (!value) return null;
  let sanitized = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      continue;
    }
    sanitized += value[i];
  }
  const trimmed = sanitized.trim();
  if (!trimmed) return null;
  if (trimmed.length > 256) return null;
  return trimmed;
}

// Azure DevOps environment variable keys (must match env-handlers.ts)
const ADO_ENV_KEYS = {
  ENABLED: 'AZURE_DEVOPS_ENABLED',
  TOKEN: 'AZURE_DEVOPS_TOKEN',
  ORG_URL: 'AZURE_DEVOPS_ORG_URL',
  PROJECT: 'AZURE_DEVOPS_PROJECT'
} as const;

/**
 * Check if a file exists (async)
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get Azure DevOps configuration from project environment file.
 * Returns null if Azure DevOps is explicitly disabled or config is incomplete.
 */
export async function getAzureDevOpsConfig(project: Project): Promise<AzureDevOpsConfig | null> {
  if (!project.autoBuildPath) return null;
  const envPath = path.join(project.path, project.autoBuildPath, '.env');
  if (!(await fileExists(envPath))) return null;

  try {
    const content = await readFile(envPath, 'utf-8');
    const vars = parseEnvFile(content);

    // Check if Azure DevOps is explicitly disabled
    if (vars[ADO_ENV_KEYS.ENABLED]?.toLowerCase() === 'false') {
      return null;
    }

    const token = sanitizeToken(vars[ADO_ENV_KEYS.TOKEN]);
    const orgUrl = sanitizeOrgUrl(vars[ADO_ENV_KEYS.ORG_URL]);
    const projectName = sanitizeProjectName(vars[ADO_ENV_KEYS.PROJECT]);

    if (!token || !orgUrl || !projectName) return null;
    return { token, orgUrl, project: projectName };
  } catch {
    return null;
  }
}

/**
 * Build the Basic auth header value for Azure DevOps PAT authentication.
 * Azure DevOps PAT auth uses Basic with empty username: ":<token>" base64-encoded.
 */
export function buildBasicAuth(token: string): string {
  return 'Basic ' + Buffer.from(':' + token).toString('base64');
}

// Default timeout for Azure DevOps API requests (30 seconds)
const ADO_API_TIMEOUT_MS = 30000;

/**
 * Build the full API URL for a project-scoped Azure DevOps endpoint.
 * URL format: {orgUrl}/{project}/_apis{endpoint}?api-version=7.1
 * Appends api-version=7.1 if not already present.
 */
function buildAdoUrl(config: AzureDevOpsConfig, endpoint: string): string {
  const encodedProject = encodeURIComponent(config.project);
  const base = `${config.orgUrl}/${encodedProject}/_apis${endpoint}`;
  if (base.includes('api-version')) {
    return base;
  }
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}api-version=7.1`;
}

/**
 * Build the full API URL for an org-level Azure DevOps endpoint (no project prefix).
 * URL format: {orgUrl}/_apis{endpoint}?api-version=7.1
 */
function buildAdoOrgUrl(config: AzureDevOpsConfig, endpoint: string): string {
  const base = `${config.orgUrl}/_apis${endpoint}`;
  if (base.includes('api-version')) {
    return base;
  }
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}api-version=7.1`;
}

/**
 * Make a request to the Azure DevOps API with timeout and Basic auth.
 * endpoint is relative, e.g. '/wit/workitems'
 */
export async function adoFetch(
  config: AzureDevOpsConfig,
  endpoint: string,
  options: RequestInit = {}
): Promise<unknown> {
  const url = buildAdoUrl(config, endpoint);
  const safeToken = sanitizeToken(config.token);
  if (!safeToken) {
    throw new Error('Invalid Azure DevOps token');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ADO_API_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
        Authorization: buildBasicAuth(safeToken)
      }
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new AzureDevOpsAPIError(
        `Azure DevOps API error: ${response.status} ${response.statusText} - ${errorBody}`,
        response.status
      );
    }

    return response.json();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AzureDevOpsAPIError(
        `Azure DevOps API timeout after ${ADO_API_TIMEOUT_MS / 1000}s: ${url}`,
        0
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Make a request to an org-level Azure DevOps API endpoint (no project segment in URL).
 * Use this for endpoints like /_apis/projects/{project} where the project is part of
 * the path, not a prefix before /_apis.
 */
export async function adoOrgFetch(
  config: AzureDevOpsConfig,
  endpoint: string,
  options: RequestInit = {}
): Promise<unknown> {
  const url = buildAdoOrgUrl(config, endpoint);
  const safeToken = sanitizeToken(config.token);
  if (!safeToken) {
    throw new Error('Invalid Azure DevOps token');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ADO_API_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
        Authorization: buildBasicAuth(safeToken)
      }
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new AzureDevOpsAPIError(
        `Azure DevOps API error: ${response.status} ${response.statusText} - ${errorBody}`,
        response.status
      );
    }

    return response.json();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AzureDevOpsAPIError(
        `Azure DevOps API timeout after ${ADO_API_TIMEOUT_MS / 1000}s: ${url}`,
        0
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Make a request to the Azure DevOps API and return both data and total count.
 * The total count is read from the response body's .count field (ADO convention).
 */
export async function adoFetchWithCount(
  config: AzureDevOpsConfig,
  endpoint: string,
  options: RequestInit = {}
): Promise<{ data: unknown; totalCount: number }> {
  const url = buildAdoUrl(config, endpoint);
  const safeToken = sanitizeToken(config.token);
  if (!safeToken) {
    throw new Error('Invalid Azure DevOps token');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ADO_API_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
        Authorization: buildBasicAuth(safeToken)
      }
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new AzureDevOpsAPIError(
        `Azure DevOps API error: ${response.status} ${response.statusText} - ${errorBody}`,
        response.status
      );
    }

    const data = await response.json() as Record<string, unknown>;

    // Azure DevOps returns count in the response body for collection endpoints
    let totalCount = 0;
    if (typeof data === 'object' && data !== null) {
      if (typeof data.count === 'number') {
        totalCount = data.count;
      } else if (Array.isArray(data.value)) {
        totalCount = data.value.length;
      }
    }

    return { data, totalCount };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AzureDevOpsAPIError(
        `Azure DevOps API timeout after ${ADO_API_TIMEOUT_MS / 1000}s: ${url}`,
        0
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Detect Azure DevOps org/project/repo from git remote URL.
 *
 * Handles these URL formats:
 * - https://dev.azure.com/{org}/{project}/_git/{repo}
 * - https://{org}@dev.azure.com/{org}/{project}/_git/{repo}
 * - git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
 * - ssh://git@ssh.dev.azure.com:22/{org}/{project}/{repo}
 *
 * Returns { orgUrl: 'https://dev.azure.com/{org}', project, repo } or null.
 */
export function detectAzureDevOpsFromRemote(
  projectPath: string
): { orgUrl: string; project: string; repo: string } | null {
  try {
    const remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: 'pipe',
      env: getIsolatedGitEnv()
    }).trim();

    if (!remoteUrl) return null;

    // HTTPS format: https://dev.azure.com/{org}/{project}/_git/{repo}
    // Also handles: https://{org}@dev.azure.com/{org}/{project}/_git/{repo}
    const httpsMatch = remoteUrl.match(
      /^https?:\/\/(?:[^@]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+?)(?:\.git)?$/
    );
    if (httpsMatch) {
      const org = httpsMatch[1];
      const project = decodeURIComponent(httpsMatch[2]);
      const repo = decodeURIComponent(httpsMatch[3]);
      return {
        orgUrl: `https://dev.azure.com/${org}`,
        project,
        repo
      };
    }

    // SSH format: git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
    const sshMatch = remoteUrl.match(
      /^git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/
    );
    if (sshMatch) {
      const org = sshMatch[1];
      const project = decodeURIComponent(sshMatch[2]);
      const repo = decodeURIComponent(sshMatch[3]);
      return {
        orgUrl: `https://dev.azure.com/${org}`,
        project,
        repo
      };
    }

    // SSH with full URL: ssh://git@ssh.dev.azure.com:22/{org}/{project}/{repo}
    const sshFullMatch = remoteUrl.match(
      /^ssh:\/\/git@ssh\.dev\.azure\.com(?::\d+)?\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/
    );
    if (sshFullMatch) {
      const org = sshFullMatch[1];
      const project = decodeURIComponent(sshFullMatch[2]);
      const repo = decodeURIComponent(sshFullMatch[3]);
      return {
        orgUrl: `https://dev.azure.com/${org}`,
        project,
        repo
      };
    }

    return null;
  } catch {
    return null;
  }
}
