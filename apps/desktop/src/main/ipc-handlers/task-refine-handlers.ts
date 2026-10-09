/**
 * Task Refine IPC Handlers
 * =========================
 *
 * Drives the mega-groom refine pipeline (RefineOrchestrator) that runs in an
 * embedded terminal for a specific task.
 *
 * IPC channels (all defined in IPC_CHANNELS):
 *   TASK_REFINE_TERMINAL_START — start the pipeline for a task
 *   TASK_REFINE_SKIP_PHASE     — skip the current phase
 *   TASK_REFINE_GET_SESSION    — read the persisted refine session
 *   TASK_REFINE_RESET_SESSION  — delete the session and start fresh
 *   TASK_REFINE_ERROR          → renderer — error string
 */

import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { join } from 'node:path';

import { IPC_CHANNELS } from '../../shared/constants';
import { safeSendToRenderer } from './utils';
import { findTaskAndProject } from './task/shared';
import { RefineOrchestrator } from '../ai/orchestration/refine-orchestrator';

// =============================================================================
// Handler Registration
// =============================================================================

const orchestrators = new Map<string, RefineOrchestrator>();

export function registerTaskRefineHandlers(
  getMainWindow: () => BrowserWindow | null,
): void {
  // ------------------------------------------------------------------
  // TERMINAL START — start mega-groom pipeline via RefineOrchestrator
  // ------------------------------------------------------------------
  ipcMain.on(
    IPC_CHANNELS.TASK_REFINE_TERMINAL_START,
    (_, taskId: string, autoMode?: boolean) => {
      const { task, project } = findTaskAndProject(taskId);
      if (!task || !project) {
        safeSendToRenderer(
          getMainWindow,
          IPC_CHANNELS.TASK_REFINE_ERROR,
          taskId,
          'Task or project not found',
        );
        return;
      }

      // Stop any existing orchestrator for this task
      const existing = orchestrators.get(taskId);
      existing?.stop();

      const terminalId = `refine-${taskId}`;
      const specDir = join(project.path, '.malvy', 'specs', task.specId || taskId);

      const orchestrator = new RefineOrchestrator({
        taskId,
        taskTitle: task.title,
        taskDescription: task.description || '',
        projectDir: project.path,
        specDir,
        terminalId,
        autoMode: autoMode ?? false,
        getMainWindow,
      });

      orchestrators.set(taskId, orchestrator);
      void orchestrator.start();
    },
  );

  // ------------------------------------------------------------------
  // SKIP PHASE — skip the current refine phase
  // ------------------------------------------------------------------
  ipcMain.on(
    IPC_CHANNELS.TASK_REFINE_SKIP_PHASE,
    (_, taskId: string) => {
      const orchestrator = orchestrators.get(taskId);
      if (orchestrator) {
        void orchestrator.skipPhase();
      }
    },
  );

  // ------------------------------------------------------------------
  // GET SESSION — return persisted refine session for a task
  // ------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.TASK_REFINE_GET_SESSION,
    (_, taskId: string) => {
      const { task, project } = findTaskAndProject(taskId);
      if (!task || !project) {
        return { success: true, data: null };
      }
      const specDir = join(project.path, '.malvy', 'specs', task.specId || taskId);
      const session = RefineOrchestrator.loadSessionStatic(specDir);
      return { success: true, data: session ? { session } : null };
    },
  );

  // ------------------------------------------------------------------
  // RESET SESSION — delete refine session and start fresh
  // ------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.TASK_REFINE_RESET_SESSION,
    (_, taskId: string) => {
      const existing = orchestrators.get(taskId);
      existing?.stop();
      orchestrators.delete(taskId);

      const { task, project } = findTaskAndProject(taskId);
      if (task && project) {
        const specDir = join(project.path, '.malvy', 'specs', task.specId || taskId);
        RefineOrchestrator.deleteSession(specDir);
      }
      return { success: true };
    },
  );
}
