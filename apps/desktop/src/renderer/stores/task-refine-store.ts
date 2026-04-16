import { create } from 'zustand';

export interface TaskRefineMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface TaskRefineState {
  isOpen: boolean;
  taskId: string | null;
  taskTitle: string | null;
  messages: TaskRefineMessage[];
  streamingContent: string;
  currentTool: string | null;
  status: 'idle' | 'thinking' | 'streaming' | 'complete' | 'error';
  error: string | null;
  refinedDescription: string | null;

  // Actions
  open: (taskId: string, taskTitle: string) => void;
  close: () => void;
  addUserMessage: (content: string) => void;
  appendChunk: (chunk: string) => void;
  finalizeAssistantMessage: (refinedDescription?: string) => void;
  setCurrentTool: (tool: string | null) => void;
  setError: (error: string) => void;
  reset: () => void;
}

const initialState = {
  isOpen: false,
  taskId: null,
  taskTitle: null,
  messages: [],
  streamingContent: '',
  currentTool: null,
  status: 'idle' as const,
  error: null,
  refinedDescription: null,
};

export const useTaskRefineStore = create<TaskRefineState>((set) => ({
  ...initialState,

  open: (taskId, taskTitle) => {
    set({ ...initialState, isOpen: true, taskId, taskTitle });
  },

  close: () => {
    set({ isOpen: false });
  },

  addUserMessage: (content) => {
    const message: TaskRefineMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    };
    set((state) => ({
      messages: [...state.messages, message],
      status: 'thinking',
    }));
  },

  appendChunk: (chunk) => {
    set((state) => ({
      streamingContent: state.streamingContent + chunk,
      status: 'streaming',
      currentTool: null,
    }));
  },

  finalizeAssistantMessage: (refinedDescription?: string) => {
    set((state) => {
      const { streamingContent } = state;
      const newStatus = refinedDescription ? 'complete' as const : 'idle' as const;

      if (!streamingContent) return { streamingContent: '', status: newStatus, refinedDescription: refinedDescription ?? null };

      const message: TaskRefineMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: streamingContent,
        timestamp: new Date().toISOString(),
      };

      return {
        messages: [...state.messages, message],
        streamingContent: '',
        status: newStatus,
        refinedDescription: refinedDescription ?? null,
      };
    });
  },

  setCurrentTool: (tool) => {
    set((state) => ({ currentTool: tool, status: tool ? 'thinking' as const : state.status }));
  },

  setError: (error) => {
    set((state) => {
      const updates: Partial<TaskRefineState> = {
        status: 'error',
        error,
        currentTool: null,
        streamingContent: '',
      };

      if (state.streamingContent) {
        const message: TaskRefineMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: state.streamingContent,
          timestamp: new Date().toISOString(),
        };
        updates.messages = [...state.messages, message];
      }

      return updates;
    });
  },

  reset: () => {
    set(initialState);
  },
}));
