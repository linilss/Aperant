import { create } from 'zustand';
import type {
  InsightsSession,
  InsightsSessionSummary,
  InsightsChatMessage,
  InsightsChatStatus,
  InsightsStreamChunk,
  InsightsToolUsage,
  InsightsModelConfig,
  TaskMetadata,
  Task,
  ImageAttachment
} from '../../shared/types';

interface ToolUsage {
  name: string;
  input?: string;
}

interface InsightsState {
  // Data
  /** Project whose chat is shown; events for other projects are ignored */
  projectId: string | null;
  session: InsightsSession | null;
  /** Id of a session created here before main created the real one (first message) */
  placeholderSessionId: string | null;
  /** Another session of the shown project whose reply is still streaming */
  busySessionId: string | null;
  sessions: InsightsSessionSummary[]; // List of all sessions
  status: InsightsChatStatus;
  pendingMessage: string;
  streamingContent: string; // Accumulates streaming response
  streamingTasks: NonNullable<InsightsChatMessage['suggestedTasks']>; // Accumulates task suggestions during streaming
  currentTool: ToolUsage | null; // Currently executing tool
  toolsUsed: InsightsToolUsage[]; // Tools used during current response
  isLoadingSessions: boolean;
  showArchived: boolean; // Whether to include archived sessions in listings
  pendingImages: ImageAttachment[]; // Images pending attachment to next message

  // Actions
  setSession: (session: InsightsSession | null) => void;
  setSessions: (sessions: InsightsSessionSummary[]) => void;
  setStatus: (status: InsightsChatStatus) => void;
  setPendingMessage: (message: string) => void;
  addMessage: (message: InsightsChatMessage) => void;
  updateLastAssistantMessage: (content: string) => void;
  appendStreamingContent: (content: string) => void;
  clearStreamingContent: () => void;
  setCurrentTool: (tool: ToolUsage | null) => void;
  addToolUsage: (tool: ToolUsage) => void;
  clearToolsUsed: () => void;
  addStreamingTasks: (tasks: NonNullable<InsightsChatMessage['suggestedTasks']>) => void;
  finalizeStreamingMessage: () => void;
  clearSession: () => void;
  setLoadingSessions: (loading: boolean) => void;
  setShowArchived: (showArchived: boolean) => void;
  setPendingImages: (images: ImageAttachment[]) => void;
}

const initialStatus: InsightsChatStatus = {
  phase: 'idle',
  message: ''
};

export const useInsightsStore = create<InsightsState>((set, _get) => ({
  // Initial state
  projectId: null,
  session: null,
  placeholderSessionId: null,
  busySessionId: null,
  sessions: [],
  status: initialStatus,
  pendingMessage: '',
  streamingContent: '',
  streamingTasks: [],
  currentTool: null,
  toolsUsed: [],
  isLoadingSessions: false,
  showArchived: false,
  pendingImages: [],

  // Actions
  setSession: (session) => set({ session }),

  setSessions: (sessions) => set({ sessions }),

  setStatus: (status) => set({ status }),

  setLoadingSessions: (loading) => set({ isLoadingSessions: loading }),

  setShowArchived: (showArchived) => set({ showArchived }),

  setPendingMessage: (message) => set({ pendingMessage: message }),

  addMessage: (message) =>
    set((state) => {
      if (!state.session) {
        // Create new session if none exists (main creates the real one and sends it back)
        const id = `session-${Date.now()}`;
        return {
          placeholderSessionId: id,
          session: {
            id,
            projectId: state.projectId ?? '',
            messages: [message],
            createdAt: new Date(),
            updatedAt: new Date()
          }
        };
      }

      return {
        session: {
          ...state.session,
          messages: [...state.session.messages, message],
          updatedAt: new Date()
        }
      };
    }),

  updateLastAssistantMessage: (content) =>
    set((state) => {
      if (!state.session || state.session.messages.length === 0) return state;

      const messages = [...state.session.messages];
      const lastIndex = messages.length - 1;
      const lastMessage = messages[lastIndex];

      if (lastMessage.role === 'assistant') {
        messages[lastIndex] = { ...lastMessage, content };
      }

      return {
        session: {
          ...state.session,
          messages,
          updatedAt: new Date()
        }
      };
    }),

  appendStreamingContent: (content) =>
    set((state) => ({
      streamingContent: state.streamingContent + content
    })),

  clearStreamingContent: () => set({ streamingContent: '', streamingTasks: [] }),

  setCurrentTool: (tool) => set({ currentTool: tool }),

  addToolUsage: (tool) =>
    set((state) => ({
      toolsUsed: [
        ...state.toolsUsed,
        {
          name: tool.name,
          input: tool.input,
          timestamp: new Date()
        }
      ]
    })),

  clearToolsUsed: () => set({ toolsUsed: [] }),

  addStreamingTasks: (tasks) =>
    set((state) => ({
      streamingTasks: [...state.streamingTasks, ...tasks]
    })),

  finalizeStreamingMessage: () =>
    set((state) => {
      const content = state.streamingContent;
      const toolsUsed = state.toolsUsed.length > 0 ? [...state.toolsUsed] : undefined;
      const suggestedTasks = state.streamingTasks.length > 0 ? [...state.streamingTasks] : undefined;

      if (!content && !suggestedTasks && !toolsUsed) {
        return { streamingContent: '', streamingTasks: [], toolsUsed: [] };
      }

      const newMessage: InsightsChatMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content,
        timestamp: new Date(),
        suggestedTasks,
        toolsUsed
      };

      if (!state.session) {
        const id = `session-${Date.now()}`;
        return {
          streamingContent: '',
          streamingTasks: [],
          toolsUsed: [],
          placeholderSessionId: id,
          session: {
            id,
            projectId: state.projectId ?? '',
            messages: [newMessage],
            createdAt: new Date(),
            updatedAt: new Date()
          }
        };
      }

      return {
        streamingContent: '',
        streamingTasks: [],
        toolsUsed: [],
        session: {
          ...state.session,
          messages: [...state.session.messages, newMessage],
          updatedAt: new Date()
        }
      };
    }),

  clearSession: () =>
    set({
      session: null,
      placeholderSessionId: null,
      busySessionId: null,
      status: initialStatus,
      pendingMessage: '',
      streamingContent: '',
      streamingTasks: [],
      currentTool: null,
      toolsUsed: [],
      pendingImages: []
    }),

  setPendingImages: (images) => set({ pendingImages: images })
}));

// Helper functions

/** Clear the in-progress reply shown in the chat (switching project or session) */
function resetStreamingView(): void {
  useInsightsStore.setState({
    status: initialStatus,
    streamingContent: '',
    streamingTasks: [],
    currentTool: null,
    toolsUsed: [],
    busySessionId: null
  });
}

/** Whether an event for this project/session belongs to the chat that is shown */
function isForShownChat(state: InsightsState, projectId: string, sessionId?: string): boolean {
  if (projectId !== state.projectId) return false;
  if (!sessionId) return true;
  const current = state.session?.id;
  return current === sessionId || (current !== undefined && current === state.placeholderSessionId);
}

/**
 * Restore a reply that is still streaming in main (the user left the project or
 * session while it was being generated), so it shows again and keeps streaming.
 */
export async function restoreInsightsStream(projectId: string): Promise<void> {
  let result: Awaited<ReturnType<typeof window.electronAPI.getInsightsStreamStatus>> | undefined;
  try {
    result = await window.electronAPI.getInsightsStreamStatus?.(projectId);
  } catch {
    return;
  }
  const state = useInsightsStore.getState();
  if (state.projectId !== projectId) return; // switched away meanwhile
  const stream = result?.success ? result.data : null;
  if (!stream) {
    if (state.busySessionId) useInsightsStore.setState({ busySessionId: null });
    return;
  }
  if (stream.sessionId !== state.session?.id) {
    // The reply belongs to another session of this project: keep its text out of this chat
    const finished = stream.status.phase === 'complete' || stream.status.phase === 'error';
    useInsightsStore.setState({ busySessionId: finished ? null : stream.sessionId });
    return;
  }
  // Snapshot covers every chunk sent before it; later chunks append to it
  useInsightsStore.setState({
    status: stream.status,
    streamingContent: stream.content,
    streamingTasks: [...stream.suggestedTasks],
    currentTool: stream.currentTool,
    toolsUsed: stream.toolsUsed.map((t) => ({ ...t, timestamp: new Date(t.timestamp) })),
    busySessionId: null
  });
}

export async function loadInsightsSessions(projectId: string, includeArchived?: boolean): Promise<void> {
  const store = useInsightsStore.getState();
  store.setLoadingSessions(true);

  // Use explicit parameter if provided, otherwise read from store
  const archived = includeArchived ?? store.showArchived;

  try {
    const result = await window.electronAPI.listInsightsSessions(projectId, archived);
    if (result.success && result.data) {
      store.setSessions(result.data);
    } else {
      store.setSessions([]);
    }
  } finally {
    store.setLoadingSessions(false);
  }
}

export async function loadInsightsSession(projectId: string, includeArchived?: boolean): Promise<void> {
  if (useInsightsStore.getState().projectId !== projectId) {
    // Another project: nothing of the previous project's chat may stay on screen
    useInsightsStore.setState({ projectId, session: null, placeholderSessionId: null, pendingMessage: '' });
    resetStreamingView();
  }
  const result = await window.electronAPI.getInsightsSession(projectId);
  if (useInsightsStore.getState().projectId !== projectId) return; // switched away meanwhile
  if (result.success && result.data) {
    useInsightsStore.getState().setSession(result.data);
  } else {
    useInsightsStore.getState().setSession(null);
  }
  useInsightsStore.setState({ placeholderSessionId: null });
  await restoreInsightsStream(projectId);
  // Also load the sessions list
  await loadInsightsSessions(projectId, includeArchived);
}

export function sendMessage(projectId: string, message: string, modelConfig?: InsightsModelConfig, images?: ImageAttachment[]): void {
  const store = useInsightsStore.getState();
  const session = store.session;

  // Add user message to session (strip data to keep memory usage low)
  const displayImages = images?.map(img => ({
    ...img,
    data: undefined // Strip base64 data, keep thumbnails for display
  }));
  const userMessage: InsightsChatMessage = {
    id: `msg-${Date.now()}`,
    role: 'user',
    content: message,
    timestamp: new Date(),
    ...(displayImages && displayImages.length > 0 ? { images: displayImages } : {})
  };
  store.addMessage(userMessage);

  // Clear pending and set status
  store.setPendingMessage('');
  store.setPendingImages([]);
  store.clearStreamingContent();
  store.clearToolsUsed(); // Clear tools from previous response
  store.setStatus({
    phase: 'thinking',
    message: 'Processing your message...'
  });

  // Use provided modelConfig, or fall back to session's config
  const configToUse = modelConfig || session?.modelConfig;

  // Send to main process
  window.electronAPI.sendInsightsMessage(projectId, message, configToUse, images);
}

export async function clearSession(projectId: string, includeArchived?: boolean): Promise<void> {
  const result = await window.electronAPI.clearInsightsSession(projectId);
  if (result.success) {
    useInsightsStore.getState().clearSession();
    // Reload sessions list and current session
    await loadInsightsSession(projectId, includeArchived);
  }
}

export async function newSession(projectId: string): Promise<void> {
  const result = await window.electronAPI.newInsightsSession(projectId);
  if (result.success && result.data) {
    useInsightsStore.getState().setSession(result.data);
    useInsightsStore.setState({ placeholderSessionId: null });
    resetStreamingView();
    await restoreInsightsStream(projectId);
    // Reload sessions list
    await loadInsightsSessions(projectId);
  }
}

export async function switchSession(projectId: string, sessionId: string): Promise<void> {
  const result = await window.electronAPI.switchInsightsSession(projectId, sessionId);
  if (result.success && result.data) {
    useInsightsStore.getState().setSession(result.data);
    useInsightsStore.setState({ placeholderSessionId: null });
    // Reset streaming state when switching sessions, then show this session's reply if it is still streaming
    resetStreamingView();
    await restoreInsightsStream(projectId);
  }
}

export async function deleteSession(projectId: string, sessionId: string, includeArchived?: boolean): Promise<boolean> {
  const result = await window.electronAPI.deleteInsightsSession(projectId, sessionId);
  if (result.success) {
    // Reload sessions list and current session
    await loadInsightsSession(projectId, includeArchived);
    return true;
  }
  return false;
}

export async function renameSession(projectId: string, sessionId: string, newTitle: string): Promise<boolean> {
  const result = await window.electronAPI.renameInsightsSession(projectId, sessionId, newTitle);
  if (result.success) {
    // Reload sessions list to reflect the change
    await loadInsightsSessions(projectId);
    return true;
  }
  return false;
}

export async function deleteSessions(projectId: string, sessionIds: string[]): Promise<{ success: boolean; failedIds?: string[] }> {
  const result = await window.electronAPI.deleteInsightsSessions(projectId, sessionIds);
  if (result.success) {
    return { success: true, failedIds: result.data?.failedIds };
  }
  return { success: false, failedIds: result.data?.failedIds };
}

export async function archiveSession(projectId: string, sessionId: string): Promise<boolean> {
  const result = await window.electronAPI.archiveInsightsSession(projectId, sessionId);
  return result.success;
}

export async function archiveSessions(projectId: string, sessionIds: string[]): Promise<{ success: boolean; failedIds?: string[] }> {
  const result = await window.electronAPI.archiveInsightsSessions(projectId, sessionIds);
  if (result.success) {
    return { success: true, failedIds: result.data?.failedIds };
  }
  return { success: false, failedIds: result.data?.failedIds };
}

export async function unarchiveSession(projectId: string, sessionId: string): Promise<boolean> {
  const result = await window.electronAPI.unarchiveInsightsSession(projectId, sessionId);
  return result.success;
}

export async function updateModelConfig(projectId: string, sessionId: string, modelConfig: InsightsModelConfig): Promise<boolean> {
  const result = await window.electronAPI.updateInsightsModelConfig(projectId, sessionId, modelConfig);
  if (result.success) {
    // Update local session state
    const store = useInsightsStore.getState();
    if (store.session?.id === sessionId) {
      store.setSession({
        ...store.session,
        modelConfig,
        updatedAt: new Date()
      });
    }
    // Reload sessions list to reflect the change
    await loadInsightsSessions(projectId);
    return true;
  }
  return false;
}

export async function createTaskFromSuggestion(
  projectId: string,
  title: string,
  description: string,
  metadata?: TaskMetadata
): Promise<Task | null> {
  const result = await window.electronAPI.createTaskFromInsights(
    projectId,
    title,
    description,
    metadata
  );

  if (result.success && result.data) {
    return result.data;
  }
  return null;
}

/** A reply of another session in the shown project is streaming (or just ended) */
function trackBusySession(projectId: string, sessionId: string | undefined, ended: boolean): void {
  const state = useInsightsStore.getState();
  if (!sessionId || projectId !== state.projectId) return;
  if (ended) {
    if (state.busySessionId === sessionId) useInsightsStore.setState({ busySessionId: null });
  } else if (state.busySessionId !== sessionId) {
    useInsightsStore.setState({ busySessionId: sessionId });
  }
}

// IPC listener setup - call this once when the app initializes
export function setupInsightsListeners(): () => void {
  const store = useInsightsStore.getState;

  // Listen for streaming chunks
  const unsubStreamChunk = window.electronAPI.onInsightsStreamChunk(
    (projectId, chunk: InsightsStreamChunk, sessionId?: string) => {
      if (!isForShownChat(store(), projectId, sessionId)) {
        trackBusySession(projectId, sessionId, chunk.type === 'done' || chunk.type === 'error');
        return;
      }
      switch (chunk.type) {
        case 'text':
          if (chunk.content) {
            store().appendStreamingContent(chunk.content);
            store().setCurrentTool(null); // Clear tool when receiving text
            store().setStatus({
              phase: 'streaming',
              message: 'Receiving response...'
            });
          }
          break;
        case 'tool_start':
          if (chunk.tool) {
            store().setCurrentTool({
              name: chunk.tool.name,
              input: chunk.tool.input
            });
            // Record this tool usage for history
            store().addToolUsage({
              name: chunk.tool.name,
              input: chunk.tool.input
            });
            store().setStatus({
              phase: 'streaming',
              message: `Using ${chunk.tool.name}...`
            });
          }
          break;
        case 'tool_end':
          store().setCurrentTool(null);
          break;
        case 'task_suggestion':
          // Accumulate task suggestions — they'll be included when 'done' finalizes the message
          store().setCurrentTool(null);
          if (chunk.suggestedTasks) {
            store().addStreamingTasks(chunk.suggestedTasks);
          }
          break;
        case 'done':
          // Finalize any remaining content
          store().setCurrentTool(null);
          store().finalizeStreamingMessage();
          store().setStatus({
            phase: 'complete',
            message: ''
          });
          break;
        case 'error':
          store().setCurrentTool(null);
          store().setStatus({
            phase: 'error',
            error: chunk.error
          });
          break;
      }
    }
  );

  // Listen for status updates
  const unsubStatus = window.electronAPI.onInsightsStatus((projectId, status, sessionId) => {
    if (!isForShownChat(store(), projectId, sessionId)) {
      trackBusySession(projectId, sessionId, status.phase === 'complete' || status.phase === 'error');
      return;
    }
    store().setStatus(status);
  });

  // Listen for errors
  const unsubError = window.electronAPI.onInsightsError((projectId, error, sessionId) => {
    if (!isForShownChat(store(), projectId, sessionId)) {
      trackBusySession(projectId, sessionId, true);
      return;
    }
    store().setStatus({
      phase: 'error',
      error
    });
  });

  // Listen for session updates (e.g., after assistant message saved with auto-generated title)
  const unsubSessionUpdated = window.electronAPI.onInsightsSessionUpdated(
    (projectId, session: InsightsSession) => {
      // Main already saved it; another project's chat is not on screen
      if (projectId !== store().projectId) return;
      // Update current session if it matches (or replace the one created here for the first message)
      const state = store();
      const currentId = state.session?.id;
      if (currentId === session.id || (currentId !== undefined && currentId === state.placeholderSessionId)) {
        store().setSession(session);
        useInsightsStore.setState({ placeholderSessionId: null });
      }
      if (state.busySessionId === session.id) useInsightsStore.setState({ busySessionId: null });
      // Also refresh sessions list for sidebar
      loadInsightsSessions(projectId).catch(() => {
        // The list refreshes again on the next load
      });
    }
  );

  // Return cleanup function
  return () => {
    unsubStreamChunk();
    unsubStatus();
    unsubError();
    unsubSessionUpdated();
  };
}
