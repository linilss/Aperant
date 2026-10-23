/**
 * Feature Refine IPC Handlers
 * ============================
 *
 * Manages the conversational "Refine Feature" AI session. Keeps per-project
 * session state (history + abort controller) in memory and streams AI responses
 * back to the renderer via fire-and-forget IPC channels.
 *
 * IPC channels (all defined in IPC_CHANNELS):
 *   ROADMAP_REFINE_START    — start/reset a session and send an initial greeting
 *   ROADMAP_REFINE_SEND     — send a user message, stream the AI response
 *   ROADMAP_REFINE_STOP     — cancel the active AI stream for a project
 *   ROADMAP_REFINE_CHUNK    → renderer — text delta
 *   ROADMAP_REFINE_TOOL_USE → renderer — tool use notification
 *   ROADMAP_REFINE_COMPLETE → renderer — session complete with optional featureData
 *   ROADMAP_REFINE_ERROR    → renderer — error string
 */

import { saveTranscript } from '../refine-transcript';
import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';

import { IPC_CHANNELS } from '../../shared/constants';
import { projectStore } from '../project-store';
import { safeSendToRenderer } from './utils';
import { getActiveProviderFeatureSettings } from './feature-settings-helper';
import {
  runFeatureRefine,
  type FeatureRefineMessage,
  type FeatureRefineResult,
} from '../ai/runners/feature-refine';
import type { ModelShorthand } from '../ai/config/types';
import type { ThinkingLevel } from '../../shared/types/settings';
import type { RoadmapFeature } from '../../shared/types';

// =============================================================================
// Session State
// =============================================================================

interface RefineSession {
  history: FeatureRefineMessage[];
  abortController: AbortController | null;
  /** Existing feature being refined: its conversation is saved per feature */
  feature?: { id: string; title: string };
}

const sessions = new Map<string, RefineSession>();

function getOrCreateSession(projectId: string): RefineSession {
  let session = sessions.get(projectId);
  if (!session) {
    session = { history: [], abortController: null };
    sessions.set(projectId, session);
  }
  return session;
}

// =============================================================================
// Core Send Logic
// =============================================================================

/**
 * Send a user message to the AI and stream the response back to the renderer.
 * Appends to the session history on success.
 */
async function sendMessage(
  projectId: string,
  projectDir: string,
  message: string,
  getMainWindow: () => BrowserWindow | null,
): Promise<void> {
  const session = getOrCreateSession(projectId);

  // Abort any in-flight request for this project
  session.abortController?.abort();
  const abortController = new AbortController();
  session.abortController = abortController;

  // Snapshot history before the call (assistant reply will be appended on complete)
  const history = [...session.history];

  // Resolve model settings (reuse insights settings)
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
              IPC_CHANNELS.ROADMAP_REFINE_CHUNK,
              projectId,
              event.delta,
            );
            break;

          case 'tool-use':
            safeSendToRenderer(
              getMainWindow,
              IPC_CHANNELS.ROADMAP_REFINE_TOOL_USE,
              projectId,
              event.toolName,
            );
            break;

          case 'complete': {
            // Persist both the user turn and the assistant reply
            session.history.push({ role: 'user', content: message });
            session.history.push({ role: 'assistant', content: event.text });
            session.abortController = null;
            if (session.feature) {
              try {
                saveTranscript(projectDir, session.feature.id, session.feature.title, session.history);
              } catch {
                /* the refined fields are what matter; the transcript is a bonus */
              }
            }

            safeSendToRenderer(
              getMainWindow,
              IPC_CHANNELS.ROADMAP_REFINE_COMPLETE,
              projectId,
              event.featureData as FeatureRefineResult | null,
            );
            break;
          }

          case 'error':
            session.abortController = null;
            safeSendToRenderer(
              getMainWindow,
              IPC_CHANNELS.ROADMAP_REFINE_ERROR,
              projectId,
              event.error,
            );
            break;
        }
      },
    );
  } catch (error) {
    // AbortError is not an unexpected error — swallow it silently
    if (error instanceof Error && error.name === 'AbortError') return;

    session.abortController = null;
    const errorMsg = error instanceof Error ? error.message : String(error);
    safeSendToRenderer(
      getMainWindow,
      IPC_CHANNELS.ROADMAP_REFINE_ERROR,
      projectId,
      errorMsg,
    );
  }
}

// =============================================================================
// Handler Registration
// =============================================================================

/**
 * Register all feature-refine IPC handlers.
 *
 * @param getMainWindow - Returns the main BrowserWindow (or null if destroyed)
 */
export function registerFeatureRefineHandlers(
  getMainWindow: () => BrowserWindow | null,
): void {
  // ------------------------------------------------------------------
  // START — reset/create session and send initial greeting
  // ------------------------------------------------------------------
  ipcMain.on(
    IPC_CHANNELS.ROADMAP_REFINE_START,
    (_, projectId: string, initialDescription?: string, featureContext?: RoadmapFeature) => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        safeSendToRenderer(
          getMainWindow,
          IPC_CHANNELS.ROADMAP_REFINE_ERROR,
          projectId,
          'Project not found',
        );
        return;
      }

      // Reset session
      const existing = sessions.get(projectId);
      existing?.abortController?.abort();
      sessions.set(projectId, {
        history: [],
        abortController: null,
        ...(featureContext ? { feature: { id: featureContext.id, title: featureContext.title } } : {}),
      });

      // Build the initial message — richer context when refining an existing feature
      let greeting: string;
      if (featureContext) {
        const criteria = featureContext.acceptanceCriteria.length > 0
          ? `\nCurrent acceptance criteria:\n${featureContext.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}`
          : '';
        const stories = featureContext.userStories.length > 0
          ? `\nUser stories:\n${featureContext.userStories.map((s) => `- "${s}"`).join('\n')}`
          : '';
        greeting = `I want to refine an existing roadmap feature called "${featureContext.title}".

Current description: ${featureContext.description}

Rationale: ${featureContext.rationale}${criteria}${stories}

Please help me improve this feature. Ask me one focused question at a time to uncover gaps, clarify intent, and sharpen the requirements. After gathering enough information, produce an updated PRD and implementation plan.`;
      } else if (initialDescription) {
        greeting = `I'd like to refine a new feature for this project. ${initialDescription}`;
      } else {
        greeting = "I'd like to refine a new feature for this project.";
      }

      void sendMessage(projectId, project.path, greeting, getMainWindow);
    },
  );

  // ------------------------------------------------------------------
  // SEND — append user message and stream AI response
  // ------------------------------------------------------------------
  ipcMain.on(
    IPC_CHANNELS.ROADMAP_REFINE_SEND,
    (_, projectId: string, message: string) => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        safeSendToRenderer(
          getMainWindow,
          IPC_CHANNELS.ROADMAP_REFINE_ERROR,
          projectId,
          'Project not found',
        );
        return;
      }

      void sendMessage(projectId, project.path, message, getMainWindow);
    },
  );

  // ------------------------------------------------------------------
  // STOP — cancel the active AI stream
  // ------------------------------------------------------------------
  ipcMain.on(IPC_CHANNELS.ROADMAP_REFINE_STOP, (_, projectId: string) => {
    const session = sessions.get(projectId);
    session?.abortController?.abort();
  });
}
