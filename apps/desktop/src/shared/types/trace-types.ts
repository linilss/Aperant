export interface TraceTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  thinkingTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

export interface TraceEntry {
  stepNumber: number;
  toolName: string;
  argsSummary: string;
  durationMs: number;
  usage: TraceTokenUsage;
  timestamp: number;
}

export interface AgentTrace {
  taskId: string;
  entries: TraceEntry[];
  cumulativeUsage: TraceTokenUsage;
}
