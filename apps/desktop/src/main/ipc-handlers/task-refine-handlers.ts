/**
 * Task Refine IPC Handlers
 * =========================
 *
 * Manages the conversational "Refine" (interactive) and "Auto-refine" (autonomous)
 * AI sessions for a specific task.
 *
 * IPC channels (all defined in IPC_CHANNELS):
 *   TASK_REFINE_START    — start/reset a session for a task
 *   TASK_REFINE_SEND     — send a user message, stream the AI response
 *   TASK_REFINE_STOP     — cancel the active AI stream for a task
 *   TASK_REFINE_CHUNK    → renderer — text delta
 *   TASK_REFINE_TOOL_USE → renderer — tool use notification
 *   TASK_REFINE_COMPLETE → renderer — session turn complete (+ optional refinedDescription for auto mode)
 *   TASK_REFINE_ERROR    → renderer — error string
 */

import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';

import { IPC_CHANNELS } from '../../shared/constants';
import { safeSendToRenderer } from './utils';
import { getActiveProviderFeatureSettings } from './feature-settings-helper';
import {
  runFeatureRefine,
  type FeatureRefineMessage,
} from '../ai/runners/feature-refine';
import type { ModelShorthand } from '../ai/config/types';
import type { ThinkingLevel } from '../../shared/types/settings';
import { findTaskAndProject } from './task/shared';
import { persistRefinedDescription } from './task/plan-file-utils';
import { projectStore } from '../project-store';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Extract the <refined_description>...</refined_description> block from the AI response.
 * Returns null if not found.
 */
function extractRefinedDescription(text: string): string | null {
  const match = text.match(/<refined_description>([\s\S]*?)<\/refined_description>/);
  return match ? match[1].trim() : null;
}

// =============================================================================
// Session State
// =============================================================================

interface TaskRefineSession {
  history: FeatureRefineMessage[];
  abortController: AbortController | null;
  autoMode: boolean;
}

const sessions = new Map<string, TaskRefineSession>();

function getOrCreateSession(taskId: string): TaskRefineSession {
  let session = sessions.get(taskId);
  if (!session) {
    session = { history: [], abortController: null, autoMode: false };
    sessions.set(taskId, session);
  }
  return session;
}

// =============================================================================
// Core Send Logic
// =============================================================================

async function sendMessage(
  taskId: string,
  projectDir: string,
  message: string,
  getMainWindow: () => BrowserWindow | null,
  autoMode = false,
): Promise<void> {
  const session = getOrCreateSession(taskId);

  session.abortController?.abort();
  const abortController = new AbortController();
  session.abortController = abortController;

  const history = [...session.history];
  const { model, thinkingLevel } = getActiveProviderFeatureSettings('insights');

  try {
    await runFeatureRefine(
      {
        projectDir,
        message,
        history,
        modelShorthand: model as ModelShorthand,
        thinkingLevel: thinkingLevel as ThinkingLevel,
        abortSignal: abortController.signal,
      },
      (event) => {
        switch (event.type) {
          case 'text-delta':
            safeSendToRenderer(
              getMainWindow,
              IPC_CHANNELS.TASK_REFINE_CHUNK,
              taskId,
              event.delta,
            );
            break;

          case 'tool-use':
            safeSendToRenderer(
              getMainWindow,
              IPC_CHANNELS.TASK_REFINE_TOOL_USE,
              taskId,
              event.toolName,
            );
            break;

          case 'complete': {
            session.history.push({ role: 'user', content: message });
            session.history.push({ role: 'assistant', content: event.text });
            session.abortController = null;

            // Always try to extract the <refined_description> block — present in auto mode
            // and in interactive mode when the user triggers the "Apply" synthesis turn.
            const refinedDescription = extractRefinedDescription(event.text);

            // Persist to disk from main process so it works even if panel is closed
            if (refinedDescription) {
              const { task, project } = findTaskAndProject(taskId);
              if (task && project) {
                persistRefinedDescription(project, task, refinedDescription);
                projectStore.invalidateTasksCache(project.id);
                safeSendToRenderer(
                  getMainWindow,
                  IPC_CHANNELS.TASK_REFINE_APPLIED,
                  taskId,
                  project.id,
                );
              }
            }

            safeSendToRenderer(
              getMainWindow,
              IPC_CHANNELS.TASK_REFINE_COMPLETE,
              taskId,
              refinedDescription ?? undefined,
            );
            break;
          }

          case 'error':
            session.abortController = null;
            safeSendToRenderer(
              getMainWindow,
              IPC_CHANNELS.TASK_REFINE_ERROR,
              taskId,
              event.error,
            );
            break;
        }
      },
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return;

    session.abortController = null;
    const errorMsg = error instanceof Error ? error.message : String(error);
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.TASK_REFINE_ERROR, taskId, errorMsg);
  }
}

// =============================================================================
// Handler Registration
// =============================================================================

export function registerTaskRefineHandlers(
  getMainWindow: () => BrowserWindow | null,
): void {
  // ------------------------------------------------------------------
  // START — reset/create session and kick off initial AI greeting
  // ------------------------------------------------------------------
  ipcMain.on(
    IPC_CHANNELS.TASK_REFINE_START,
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

      // Reset session
      const existing = sessions.get(taskId);
      existing?.abortController?.abort();
      sessions.set(taskId, { history: [], abortController: null, autoMode: autoMode ?? false });

      let greeting: string;

      if (autoMode) {
        greeting = `You are refining a task specification for this codebase. You MUST work completely autonomously. NEVER ask the user any questions — not even one. If you are unsure about something, explore the codebase to find the answer yourself. If you still can't determine the answer, make the best decision based on what you've learned and document your assumption.

**Task:** ${task.title}

**Current Description:**
${task.description || '(no description provided)'}

Steps:
1. Explore relevant source files to understand the codebase context, patterns, and conventions
2. Identify all requirements, acceptance criteria, edge cases, and technical constraints
3. Make informed decisions about any ambiguities — do NOT ask the user
4. Produce a complete, refined task description

CRITICAL: You must NOT end your response with a question. You must produce the refined description below. If you encounter ambiguity, state your assumption and move on.

At the end of your response, output the final refined description inside this exact XML block (plain markdown text, no code fences):

<refined_description>
[full refined task description here — comprehensive requirements, acceptance criteria, technical details, edge cases]
</refined_description>

Proceed now. No questions. Produce the refined description.`;
      } else {
        greeting = `I need to implement a task in this codebase:

**Task:** ${task.title}

**Description:**
${task.description || '(no description provided)'}

Your job is to ask me focused questions to clarify requirements — but only for things you genuinely cannot determine by exploring the codebase yourself.

**Rules:**
- Before asking ANY question, search the codebase for the answer first (read files, grep for types/functions/patterns, explore relevant directories).
- Only ask me if the answer requires product/business judgement that no amount of code reading can resolve.
- Ask one question at a time.
- Cover: exact requirements, scope, edge cases, constraints, and how this fits with existing patterns.

Start by thoroughly exploring the relevant files, then ask only your first unanswerable question.`;
      }

      void sendMessage(taskId, project.path, greeting, getMainWindow, autoMode);
    },
  );

  // ------------------------------------------------------------------
  // SEND — append user message and stream AI response
  // ------------------------------------------------------------------
  ipcMain.on(
    IPC_CHANNELS.TASK_REFINE_SEND,
    (_, taskId: string, message: string) => {
      const { project } = findTaskAndProject(taskId);
      if (!project) {
        safeSendToRenderer(
          getMainWindow,
          IPC_CHANNELS.TASK_REFINE_ERROR,
          taskId,
          'Task or project not found',
        );
        return;
      }

      void sendMessage(taskId, project.path, message, getMainWindow);
    },
  );

  // ------------------------------------------------------------------
  // STOP — cancel the active AI stream (no-op for auto mode sessions)
  // ------------------------------------------------------------------
  ipcMain.on(IPC_CHANNELS.TASK_REFINE_STOP, (_, taskId: string) => {
    const session = sessions.get(taskId);
    if (session && !session.autoMode) {
      session.abortController?.abort();
    }
  });
}
