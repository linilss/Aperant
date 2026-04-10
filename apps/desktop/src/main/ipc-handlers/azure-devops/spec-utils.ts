/**
 * Azure DevOps spec utilities
 * Handles creating task specs from Azure DevOps work items
 */

import { mkdir, writeFile, readFile, stat } from 'fs/promises';
import path from 'path';
import type { Project } from '../../../shared/types';
import type { ADOAPIWorkItem, ADOAPIWorkItemComment, AzureDevOpsConfig } from './types';
import { sanitizeText, sanitizeStringArray } from '../shared/sanitize';
import { labelMatchesWholeWord } from '../shared/label-utils';

/**
 * Simplified task info returned when creating a spec from an Azure DevOps work item.
 */
export interface ADOTaskInfo {
  id: string;
  specId: string;
  title: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

// Debug logging helper
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

function debugLog(message: string, data?: unknown): void {
  if (DEBUG) {
    if (data !== undefined) {
      console.debug(`[ADO Spec] ${message}`, data);
    } else {
      console.debug(`[ADO Spec] ${message}`);
    }
  }
}

/**
 * Determine task category based on Azure DevOps work item type and tags
 */
function determineCategoryFromWorkItem(
  workItemType: string,
  tags: string[]
): 'feature' | 'bug_fix' | 'refactoring' | 'documentation' | 'security' | 'performance' | 'ui_ux' | 'infrastructure' | 'testing' {
  const lowerType = workItemType.toLowerCase();
  const lowerTags = tags.map(t => t.toLowerCase());

  // Work item type takes precedence
  if (lowerType === 'bug') return 'bug_fix';
  if (lowerType === 'test case' || lowerType === 'test plan' || lowerType === 'test suite') return 'testing';

  // Then check tags
  if (lowerTags.some(t => t.includes('bug') || t.includes('defect') || t.includes('fix'))) {
    return 'bug_fix';
  }
  if (lowerTags.some(t => t.includes('security') || t.includes('vulnerability') || t.includes('cve'))) {
    return 'security';
  }
  if (lowerTags.some(t => t.includes('performance') || t.includes('optimization') || t.includes('speed'))) {
    return 'performance';
  }
  if (lowerTags.some(t => t.includes('ui') || t.includes('ux') || t.includes('design') || t.includes('styling'))) {
    return 'ui_ux';
  }
  if (lowerTags.some(t =>
    t.includes('infrastructure') ||
    t.includes('devops') ||
    t.includes('deployment') ||
    labelMatchesWholeWord(t, 'ci') ||
    labelMatchesWholeWord(t, 'cd')
  )) {
    return 'infrastructure';
  }
  if (lowerTags.some(t => t.includes('test') || t.includes('testing') || t.includes('qa'))) {
    return 'testing';
  }
  if (lowerTags.some(t =>
    t.includes('refactor') ||
    t.includes('cleanup') ||
    t.includes('maintenance') ||
    t.includes('chore') ||
    t.includes('tech-debt') ||
    t.includes('technical debt')
  )) {
    return 'refactoring';
  }
  if (lowerTags.some(t => t.includes('documentation') || t.includes('docs'))) {
    return 'documentation';
  }

  return 'feature';
}

function sanitizeIsoDate(value: unknown): string {
  if (typeof value !== 'string') return new Date().toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function sanitizeWorkItemId(value: unknown): number {
  const id = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(id) || id <= 0) return 0;
  return id;
}

function sanitizeWorkItemUrl(rawUrl: unknown, orgUrl: string): string {
  if (typeof rawUrl !== 'string') return '';
  try {
    const parsedUrl = new URL(rawUrl);
    const expectedHost = new URL(orgUrl).host;
    if (parsedUrl.host !== expectedHost) return '';
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') return '';
    if (parsedUrl.username || parsedUrl.password) return '';
    return parsedUrl.toString();
  } catch {
    return '';
  }
}

/**
 * Generate a spec directory name from work item ID and title
 */
function generateSpecDirName(workItemId: number, title: string): string {
  const cleanTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 50);

  const paddedId = String(workItemId).padStart(3, '0');
  return `${paddedId}-${cleanTitle}`;
}

/**
 * Check if a path exists (async)
 */
async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build work item context string for TASK.md
 */
export function buildWorkItemContext(
  workItem: ADOAPIWorkItem,
  config: AzureDevOpsConfig,
  comments?: ADOAPIWorkItemComment[]
): string {
  const fields = workItem.fields;
  const safeTitle = sanitizeText(fields['System.Title'], 200) || `Work Item ${workItem.id}`;
  const safeDescription = sanitizeText(fields['System.Description'] ?? '', 20000, true);
  const safeState = sanitizeText(fields['System.State'], 100);
  const safeType = sanitizeText(fields['System.WorkItemType'], 100);
  const safeAreaPath = sanitizeText(fields['System.AreaPath'], 200);
  const safeIterationPath = sanitizeText(fields['System.IterationPath'], 200);
  const safeCreatedDate = sanitizeIsoDate(fields['System.CreatedDate']);

  // Assigned to can be object or string
  const assignedToRaw = fields['System.AssignedTo'];
  let safeAssignedTo = '';
  if (typeof assignedToRaw === 'string') {
    safeAssignedTo = sanitizeText(assignedToRaw, 200);
  } else if (assignedToRaw && typeof assignedToRaw === 'object') {
    safeAssignedTo = sanitizeText(
      (assignedToRaw as { displayName?: string }).displayName ?? '',
      200
    );
  }

  const rawTags = fields['System.Tags'];
  const tags = typeof rawTags === 'string'
    ? sanitizeStringArray(rawTags.split(';'), 50, 100)
    : [];

  const webUrl = `${config.orgUrl}/${encodeURIComponent(config.project)}/_workitems/edit/${workItem.id}`;

  const lines: string[] = [];
  lines.push(`# Azure DevOps Work Item #${workItem.id}: ${safeTitle}`);
  lines.push('');
  lines.push(`**Project:** ${sanitizeText(config.project, 200)}`);
  lines.push(`**Type:** ${safeType}`);
  lines.push(`**State:** ${safeState}`);
  lines.push(`**Area Path:** ${safeAreaPath}`);
  lines.push(`**Iteration Path:** ${safeIterationPath}`);
  lines.push(`**Created:** ${new Date(safeCreatedDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}`);

  if (safeAssignedTo) {
    lines.push(`**Assigned To:** ${safeAssignedTo}`);
  }

  if (tags.length > 0) {
    lines.push(`**Tags:** ${tags.join(', ')}`);
  }

  lines.push('');
  lines.push('## Description');
  lines.push('');
  lines.push(safeDescription || '_No description provided_');
  lines.push('');
  lines.push(`**Web URL:** ${webUrl}`);

  if (comments && comments.length > 0) {
    lines.push('');
    lines.push(`## Comments (${comments.length})`);
    lines.push('');
    for (const comment of comments) {
      const safeAuthor = sanitizeText(comment.createdBy?.displayName ?? 'Unknown', 100);
      const safeText = sanitizeText(comment.text, 20000, true);
      lines.push(`**${safeAuthor}:** ${safeText}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Create a task spec from an Azure DevOps work item
 */
export async function createSpecForWorkItem(
  project: Project,
  workItem: ADOAPIWorkItem,
  config: AzureDevOpsConfig,
  baseBranch?: string,
  comments?: ADOAPIWorkItemComment[]
): Promise<ADOTaskInfo | null> {
  try {
    const workItemId = sanitizeWorkItemId(workItem.id);
    if (!workItemId) {
      debugLog('Skipping work item with invalid ID', { id: workItem.id });
      return null;
    }

    const fields = workItem.fields;
    const safeTitle = sanitizeText(fields['System.Title'], 200) || `Work Item ${workItemId}`;
    const safeDescription = sanitizeText(fields['System.Description'] ?? '', 20000, true);
    const safeState = sanitizeText(fields['System.State'], 100);
    const safeType = sanitizeText(fields['System.WorkItemType'], 100);
    const safeCreatedDate = sanitizeIsoDate(fields['System.CreatedDate']);

    const rawTags = fields['System.Tags'];
    const tags = typeof rawTags === 'string'
      ? sanitizeStringArray(rawTags.split(';'), 50, 100)
      : [];

    const webUrl = sanitizeWorkItemUrl(
      workItem._links?.html?.href ?? `${config.orgUrl}/${encodeURIComponent(config.project)}/_workitems/edit/${workItemId}`,
      config.orgUrl
    ) || `${config.orgUrl}/${encodeURIComponent(config.project)}/_workitems/edit/${workItemId}`;

    const specsDir = path.join(project.path, project.autoBuildPath, 'specs');
    await mkdir(specsDir, { recursive: true });

    const specDirName = generateSpecDirName(workItemId, safeTitle);
    const specDir = path.join(specsDir, specDirName);
    const metadataPath = path.join(specDir, 'metadata.json');

    // Check if spec already exists
    if (await pathExists(specDir)) {
      debugLog('Spec already exists for work item:', { id: workItemId, specDir });

      let createdAt = new Date(safeCreatedDate);
      let updatedAt = createdAt;

      if (await pathExists(metadataPath)) {
        try {
          const metadataContent = await readFile(metadataPath, 'utf-8');
          const metadata = JSON.parse(metadataContent);
          if (metadata.createdAt) {
            createdAt = new Date(metadata.createdAt);
          }
          const stats = await stat(metadataPath);
          updatedAt = new Date(stats.mtimeMs);
        } catch {
          // Fallback to work item dates
        }
      }

      return {
        id: specDirName,
        specId: specDirName,
        title: safeTitle,
        description: safeDescription,
        createdAt,
        updatedAt
      };
    }

    // Create spec directory
    await mkdir(specDir, { recursive: true });

    // Write TASK.md
    const taskContent = buildWorkItemContext(workItem, config, comments);
    await writeFile(path.join(specDir, 'TASK.md'), taskContent, 'utf-8');

    // Write metadata.json
    const metadata = {
      source: 'azure-devops',
      azureDevOps: {
        workItemId,
        orgUrl: config.orgUrl,
        project: config.project,
        webUrl,
        state: safeState,
        workItemType: safeType,
        tags,
        createdAt: safeCreatedDate
      },
      createdAt: new Date().toISOString(),
      status: 'pending'
    };
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');

    // Write task_metadata.json (consistent with GitHub/GitLab format)
    const taskMetadata = {
      sourceType: 'azure-devops' as const,
      azureDevOpsWorkItemId: workItemId,
      azureDevOpsUrl: webUrl,
      category: determineCategoryFromWorkItem(safeType, tags),
      ...(baseBranch && { baseBranch })
    };
    await writeFile(
      path.join(specDir, 'task_metadata.json'),
      JSON.stringify(taskMetadata, null, 2),
      'utf-8'
    );

    debugLog('Created spec for work item:', { id: workItemId, specDir });

    return {
      id: specDirName,
      specId: specDirName,
      title: safeTitle,
      description: safeDescription,
      createdAt: new Date(safeCreatedDate),
      updatedAt: new Date()
    };
  } catch (error) {
    debugLog('Failed to create spec for work item:', { id: workItem.id, error });
    return null;
  }
}
