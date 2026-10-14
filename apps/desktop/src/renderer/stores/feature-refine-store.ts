import { create } from 'zustand';
import type { RoadmapFeature } from '../../shared/types';

export interface FeatureRefineMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface FeatureRefineResult {
  title: string;
  description: string;
  prd: string;
  plan: string;
  acceptanceCriteria: string[];
  userStories: string[];
}

interface FeatureRefineState {
  isOpen: boolean;
  projectId: string | null;
  /** Existing feature being refined (null when creating a new feature) */
  featureContext: RoadmapFeature | null;
  messages: FeatureRefineMessage[];
  streamingContent: string;
  currentTool: string | null;
  status: 'idle' | 'thinking' | 'streaming' | 'complete' | 'error';
  error: string | null;
  result: FeatureRefineResult | null;

  // Actions
  open: (projectId: string, initialDescription?: string, featureContext?: RoadmapFeature) => void;
  close: () => void;
  addUserMessage: (content: string) => void;
  appendChunk: (chunk: string) => void;
  finalizeAssistantMessage: () => void;
  setCurrentTool: (tool: string | null) => void;
  setComplete: (result: FeatureRefineResult | null) => void;
  setError: (error: string) => void;
  reset: () => void;
}

const initialState = {
  isOpen: false,
  projectId: null,
  featureContext: null,
  messages: [],
  streamingContent: '',
  currentTool: null,
  status: 'idle' as const,
  error: null,
  result: null,
};

export const useFeatureRefineStore = create<FeatureRefineState>((set, get) => ({
  ...initialState,

  open: (projectId, initialDescription, featureContext) => {
    set({
      ...initialState,
      isOpen: true,
      projectId,
      featureContext: featureContext ?? null,
    });

    if (initialDescription) {
      get().addUserMessage(initialDescription);
    }
  },

  close: () => {
    set({ isOpen: false });
  },

  addUserMessage: (content) => {
    const message: FeatureRefineMessage = {
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

  finalizeAssistantMessage: () => {
    set((state) => {
      const { streamingContent } = state;
      if (!streamingContent) return { streamingContent: '' };

      const message: FeatureRefineMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: streamingContent,
        timestamp: new Date().toISOString(),
      };

      return {
        messages: [...state.messages, message],
        streamingContent: '',
      };
    });
  },

  setCurrentTool: (tool) => {
    set({ currentTool: tool });
  },

  setComplete: (result) => {
    set((state) => {
      // Finalize any remaining streaming content. Main sends this after every turn:
      // only a turn that carries the refined feature data ends the session; otherwise
      // the agent asked a question and waits for an answer.
      const updates: Partial<FeatureRefineState> = {
        status: result ? 'complete' : 'idle',
        result,
        currentTool: null,
        streamingContent: '',
      };

      if (state.streamingContent) {
        const message: FeatureRefineMessage = {
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

  setError: (error) => {
    set((state) => {
      const updates: Partial<FeatureRefineState> = {
        status: 'error',
        error,
        currentTool: null,
        streamingContent: '',
      };

      if (state.streamingContent) {
        const message: FeatureRefineMessage = {
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
