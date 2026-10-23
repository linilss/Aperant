import type { InsightsChatStatus, InsightsStreamChunk, InsightsStreamStatus } from '../../shared/types';

interface TrackedStream {
  /** Identifies the reply so a replaced one cannot clear its successor */
  token: object;
  status: InsightsStreamStatus;
}

/**
 * In-progress insights replies, per project.
 *
 * The renderer only shows one project's chat, so main keeps the reply that is
 * still streaming (text so far, tools, status) and the renderer restores it via
 * insights:getStreamStatus when the user comes back.
 */
export class InsightsStreamTracker {
  private streams = new Map<string, TrackedStream>();

  start(projectId: string, sessionId: string, token: object, now: Date = new Date()): void {
    this.streams.set(projectId, {
      token,
      status: {
        projectId,
        sessionId,
        startedAt: now.toISOString(),
        status: { phase: 'thinking', message: '' },
        content: '',
        currentTool: null,
        toolsUsed: [],
        suggestedTasks: [],
      },
    });
  }

  /** Session of the project's in-progress reply */
  getSessionId(projectId: string): string | undefined {
    return this.streams.get(projectId)?.status.sessionId;
  }

  setStatus(projectId: string, status: InsightsChatStatus): void {
    const tracked = this.streams.get(projectId);
    if (tracked) tracked.status.status = { ...status };
  }

  applyChunk(projectId: string, chunk: InsightsStreamChunk, now: Date = new Date()): void {
    const tracked = this.streams.get(projectId);
    if (!tracked) return;
    const s = tracked.status;
    switch (chunk.type) {
      case 'text':
        if (chunk.content) {
          s.content += chunk.content;
          s.currentTool = null;
          s.status = { phase: 'streaming', message: '' };
        }
        break;
      case 'tool_start':
        if (chunk.tool) {
          s.currentTool = { name: chunk.tool.name, input: chunk.tool.input };
          s.toolsUsed.push({ name: chunk.tool.name, input: chunk.tool.input, timestamp: now });
          s.status = { phase: 'streaming', message: '' };
        }
        break;
      case 'tool_end':
        s.currentTool = null;
        break;
      case 'task_suggestion':
        s.currentTool = null;
        if (chunk.suggestedTasks) s.suggestedTasks.push(...chunk.suggestedTasks);
        break;
      case 'done':
        s.currentTool = null;
        s.status = { phase: 'complete', message: '' };
        break;
      case 'error':
        s.currentTool = null;
        s.status = { phase: 'error', error: chunk.error };
        break;
    }
  }

  /** Reply ended (saved, failed or cancelled). Ignored when a newer reply replaced it. */
  finish(projectId: string, token: object): void {
    if (this.streams.get(projectId)?.token === token) this.streams.delete(projectId);
  }

  get(projectId: string): InsightsStreamStatus | null {
    const tracked = this.streams.get(projectId);
    if (!tracked) return null;
    const s = tracked.status;
    return {
      ...s,
      status: { ...s.status },
      currentTool: s.currentTool ? { ...s.currentTool } : null,
      toolsUsed: [...s.toolsUsed],
      suggestedTasks: [...s.suggestedTasks],
    };
  }
}
