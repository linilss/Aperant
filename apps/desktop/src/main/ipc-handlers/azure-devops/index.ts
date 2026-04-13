/**
 * Azure DevOps IPC handlers entry point
 * Registers all Azure DevOps-related IPC handlers
 */

import { registerRepositoryHandlers } from './repository-handlers';
import { registerWorkItemHandlers } from './work-item-handlers';
import { registerPullRequestHandlers } from './pull-request-handlers';
import { registerImportHandlers } from './import-handlers';
import { registerInvestigationHandlers } from './investigation-handlers';
import { registerPRReviewHandlers } from './pr-review-handlers';
import type { AgentManager } from '../../agent';
import type { BrowserWindow } from 'electron';

export function registerAzureDevOpsHandlers(
  agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null
): void {
  registerRepositoryHandlers();
  registerWorkItemHandlers();
  registerPullRequestHandlers();
  registerImportHandlers();
  registerInvestigationHandlers(agentManager, getMainWindow);
  registerPRReviewHandlers();
}
