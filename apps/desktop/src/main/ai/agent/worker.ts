/**
 * Worker Thread Entry Point
 * =========================
 *
 * Runs in an isolated worker_thread. Receives configuration via `workerData`,
 * executes `runAgentSession()`, and posts structured messages back to the
 * main thread via `parentPort.postMessage()`.
 *
 * Path handling:
 * - Dev: Loaded directly by electron-vite from source
 * - Production: Bundled into app resources (app.isPackaged)
 */

import { parentPort, workerData } from 'worker_threads';
import { readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { spawn } from 'node:child_process';

import { findExecutable } from '../../platform';

import { runAgentSession } from '../session/runner';
import { runContinuableSession } from '../session/continuation';
import { createProvider } from '../providers/factory';
import type { SupportedProvider } from '../providers/types';
import { getModelContextWindow } from '../../../shared/constants/models';
import { refreshOAuthTokenReactive } from '../auth/resolver';
import { buildToolRegistry } from '../tools/build-registry';
import type { ToolRegistry } from '../tools/registry';
import { SubagentExecutorImpl } from '../orchestration/subagent-executor';
import type { ToolContext } from '../tools/types';
import type { SecurityProfile } from '../security/bash-validator';
import type {
  WorkerConfig,
  WorkerMessage,
  MainToWorkerMessage,
  SerializableSessionConfig,
  WorkerTaskEventMessage,
} from './types';
import type { Tool as AITool } from 'ai';
import type { SessionConfig, StreamEvent, SessionResult } from '../session/types';
import { BuildOrchestrator } from '../orchestration/build-orchestrator';
import { QALoop } from '../orchestration/qa-loop';
import { buildLensSection, readTaskDiff, runReviewLenses } from '../orchestration/qa-lenses';
import { gitCheckpoint, gitResetHard, isTaskWorktree } from '../orchestration/qa-git';
import { runClaudeCliDetailed } from '../cli/claude-cli';
import { SpecOrchestrator } from '../orchestration/spec-orchestrator';
import type { SpecPhase } from '../orchestration/spec-orchestrator';
import type { AgentType } from '../config/agent-configs';
import type { Phase } from '../config/types';
import type { ExecutionPhase } from '../../../shared/constants/phase-protocol';
import { getFastMode, getPhaseThinking } from '../config/phase-config';
import { TaskLogWriter } from '../logging/task-log-writer';
import { loadProjectInstructions, injectContext } from '../prompts/prompt-loader';
import { createMcpClientsForAgent, mergeMcpTools, closeAllMcpClients } from '../mcp/client';
import type { McpClientResult } from '../mcp/types';
import { runProjectIndexer } from '../project/project-indexer';
import { summarizeProjectIndex } from '../project/project-index-summary';
import { taskAgentCliToolArgs } from '../security/release-guard';

// =============================================================================
// Validation
// =============================================================================

if (!parentPort) {
  throw new Error('worker.ts must be run inside a worker_thread');
}

const config = workerData as WorkerConfig;
if (!config?.taskId || !config?.session) {
  throw new Error('worker.ts requires valid WorkerConfig via workerData');
}

// =============================================================================
// Task Log Writer
// =============================================================================

// Single writer instance for this worker's spec, shared across all sessions
// so that planning/coding/QA phases accumulate into one task_logs.json file.
const logWriter = config.session.specDir
  ? new TaskLogWriter(config.session.specDir, basename(config.session.specDir))
  : null;

// =============================================================================
// Messaging Helpers
// =============================================================================

function postMessage(message: WorkerMessage): void {
  parentPort!.postMessage(message);
}

function postLog(data: string): void {
  postMessage({ type: 'log', taskId: config.taskId, data, projectId: config.projectId });
}

function postError(data: string): void {
  postMessage({ type: 'error', taskId: config.taskId, data, projectId: config.projectId });
}

function postTaskEvent(eventType: string, extra?: Record<string, unknown>): void {
  parentPort?.postMessage({
    type: 'task-event',
    taskId: config.taskId,
    projectId: config.projectId,
    data: {
      type: eventType,
      taskId: config.taskId,
      specId: config.session.specDir ? basename(config.session.specDir) : config.taskId,
      projectId: config.projectId ?? '',
      timestamp: new Date().toISOString(),
      eventId: `${config.taskId}-${eventType}-${Date.now()}`,
      sequence: Date.now(),
      ...extra,
    },
  } satisfies WorkerTaskEventMessage);
}

// =============================================================================
// Abort Handling
// =============================================================================

const abortController = new AbortController();

parentPort.on('message', (msg: MainToWorkerMessage) => {
  if (msg.type === 'abort') {
    abortController.abort();
  }
});

// =============================================================================
// Shared Helpers
// =============================================================================

/**
 * Reconstruct the SecurityProfile from the serialized form in session config.
 * SecurityProfile uses Set objects that can't cross worker boundaries.
 */
function buildSecurityProfile(session: SerializableSessionConfig): SecurityProfile {
  const serialized = session.toolContext.securityProfile;
  return {
    baseCommands: new Set(serialized?.baseCommands ?? []),
    stackCommands: new Set(serialized?.stackCommands ?? []),
    scriptCommands: new Set(serialized?.scriptCommands ?? []),
    customCommands: new Set(serialized?.customCommands ?? []),
    customScripts: { shellScripts: serialized?.customScripts?.shellScripts ?? [] },
    getAllAllowedCommands() {
      return new Set([
        ...this.baseCommands,
        ...this.stackCommands,
        ...this.scriptCommands,
        ...this.customCommands,
      ]);
    },
  };
}

/**
 * Build a ToolContext for the given session config.
 */
function buildToolContext(session: SerializableSessionConfig, securityProfile: SecurityProfile): ToolContext {
  return {
    cwd: session.toolContext.cwd,
    projectDir: session.toolContext.projectDir,
    specDir: session.toolContext.specDir,
    securityProfile,
    abortSignal: abortController.signal,
  };
}


/**
 * Load a prompt file from the prompts directory.
 * The prompts dir is expected relative to the worker file's location.
 * In dev and production, the worker sits in the main/ output folder.
 */
function loadPrompt(promptName: string): string | null {
  // Try to find the prompts directory relative to common locations
  const candidateBases: string[] = [
    // Standard: apps/desktop/prompts/ relative to project root
    // The worker runs in the Electron main process — __dirname is in out/main/
    // We need to traverse up to find apps/desktop/prompts/
    join(__dirname, '..', '..', 'prompts'),
    join(__dirname, '..', '..', '..', 'apps', 'desktop', 'prompts'),
    join(__dirname, '..', '..', '..', '..', 'apps', 'desktop', 'prompts'),
    join(__dirname, 'prompts'),
  ];

  for (const base of candidateBases) {
    const promptPath = join(base, `${promptName}.md`);
    try {
      if (existsSync(promptPath)) {
        return readFileSync(promptPath, 'utf-8');
      }
    } catch {
      // Try next
    }
  }
  return null;
}

// =============================================================================
// MCP Clients (module-scope for worker lifetime)
// =============================================================================

let mcpClients: McpClientResult[] = [];

// =============================================================================
// Prompt Assembly (provider-agnostic context injection)
// =============================================================================

/** Task Fast Mode flag, read once per worker from task_metadata.json */
let cachedFastMode: boolean | undefined;

let cachedProjectInstructions: string | null | undefined;
let cachedCoreValues: string | null = null;
let cachedProjectInstructionsSource: string | null = null;

/**
 * Assemble a full system prompt by loading the base prompt and injecting
 * project instructions (AGENTS.md or CLAUDE.md fallback). Provider-agnostic —
 * injected for ALL AI providers, not just Anthropic.
 */
async function assemblePrompt(
  promptName: string,
  session: SerializableSessionConfig,
): Promise<string> {
  const basePrompt = loadPrompt(promptName)
    ?? buildFallbackPrompt(promptName as AgentType, session.specDir, session.projectDir);

  // Load project instructions once per worker lifetime
  if (cachedProjectInstructions === undefined) {
    const result = await loadProjectInstructions(session.projectDir, {
      includeTeamDocs: session.useClaudeMd !== false,
    });
    cachedProjectInstructions = result?.content || null;
    cachedCoreValues = result?.coreValues ?? null;
    cachedProjectInstructionsSource = result?.source ?? null;
    if (result) {
      postLog(`Project instructions loaded from ${result.source} (${(result.content.length / 1024).toFixed(1)}KB)`);
    } else {
      postLog('No project instructions found (checked AGENTS.md, CLAUDE.md, .malvy/docs, .malvy/pointers.md)');
    }
    if (session.memoryContext) {
      postLog(`Project memory injected (${session.memoryContext.split('\n').length} items)`);
    }
  }

  // HUMAN_INPUT.md is read on every prompt (not cached) so instructions the
  // user drops into the spec dir mid-build reach the next session
  const humanInput = readHumanInput(session.specDir);
  if (humanInput) {
    postLog('Human input injected from HUMAN_INPUT.md');
  }

  return injectContext(basePrompt, {
    specDir: session.specDir,
    projectDir: session.projectDir,
    coreValues: cachedCoreValues,
    projectInstructions: cachedProjectInstructions,
    memoryContext: session.memoryContext,
    humanInput,
  });
}

/** Contents of `<specDir>/HUMAN_INPUT.md`, or null when absent or empty. */
function readHumanInput(specDir: string | undefined): string | null {
  if (!specDir) return null;
  const filePath = join(specDir, 'HUMAN_INPUT.md');
  if (!existsSync(filePath)) return null;
  try {
    const content = readFileSync(filePath, 'utf-8').trim();
    return content.length > 0 ? content : null;
  } catch {
    return null;
  }
}

// =============================================================================
// CLI-based Session Runner
// =============================================================================

/**
 * Run an agent session via the `claude` CLI subprocess instead of the Vercel AI SDK.
 *
 * This avoids direct calls to api.anthropic.com (which share the OAuth subscription
 * quota with the Claude Code CLI session and trigger 429 rate limits). The CLI manages
 * its own backoff and rate limiting internally, matching the behaviour of Agent Terminals.
 *
 * The combined system+kickoff prompt is piped to stdin. The CLI writes output files
 * (implementation_plan.json, code changes) directly via its Write/Edit tools.
 * Stream-json events are forwarded to the main thread as stream-event messages.
 */
async function runSessionViaCLI(
  agentType: AgentType,
  systemPrompt: string,
  kickoffMessage: string,
  projectDir: string,
  modelId: string,
  abortSignal: AbortSignal,
  configDir?: string,
): Promise<SessionResult> {
  const startTime = Date.now();

  const claudePath = await findExecutable('claude');
  if (!claudePath) {
    return {
      outcome: 'error',
      stepsExecuted: 0,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      messages: [],
      durationMs: Date.now() - startTime,
      toolCallCount: 0,
      error: { code: 'error', message: 'claude CLI not found — install Claude Code', retryable: false },
    };
  }

  const args = [
    '--print',
    '--verbose',
    '--output-format', 'stream-json',
    // Agents never release: Bash is allowed but deploy/publish/upload/git push are denied
    ...taskAgentCliToolArgs(),
    '--model', modelId,
  ];
  // Project setting "Use CLAUDE.md" off: skip project-level settings sources so the CLI
  // does not auto-load the team's CLAUDE.md. 'local' keeps CLAUDE.local.md (Malvy's layer).
  if (config.session.useClaudeMd === false) {
    args.push('--setting-sources', 'user,local');
  }
  // Fast Mode (task_metadata.json fastMode): faster Opus output via the CLI's fastMode setting
  if (cachedFastMode === undefined) {
    cachedFastMode = config.session.specDir ? await getFastMode(config.session.specDir) : false;
  }
  if (cachedFastMode) {
    args.push('--settings', JSON.stringify({ fastMode: true }));
  }

  postLog(`[CLI] Spawning claude for ${agentType}: ${claudePath} ${args.join(' ')}`);

  const combinedPrompt = `${systemPrompt}\n\n${kickoffMessage}`;

  // Merge profile env so the CLI subprocess uses the correct account
  const cliEnv: Record<string, string | undefined> = { ...process.env };
  if (configDir) {
    cliEnv.CLAUDE_CONFIG_DIR = configDir;
  }

  const child = spawn(claudePath, args, {
    cwd: projectDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: cliEnv,
  });

  child.stdin.write(combinedPrompt, 'utf-8');
  child.stdin.end();

  let responseText = '';
  let stdoutBuffer = '';
  let toolCallCount = 0;

  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString('utf-8');
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const event = JSON.parse(trimmed) as Record<string, unknown>;

        if (event.type === 'assistant') {
          const message = event.message as Record<string, unknown> | undefined;
          const content = (message?.content ?? []) as Array<Record<string, unknown>>;
          for (const block of content) {
            if (block.type === 'text') {
              const text = String(block.text ?? '');
              if (text) {
                responseText += text;
                postMessage({
                  type: 'stream-event',
                  taskId: config.taskId,
                  data: { type: 'text-delta', text } as StreamEvent,
                  projectId: config.projectId,
                });
              }
            } else if (block.type === 'tool_use') {
              toolCallCount++;
              postMessage({
                type: 'stream-event',
                taskId: config.taskId,
                data: {
                  type: 'tool-call',
                  toolName: String(block.name ?? 'unknown'),
                  toolCallId: String(block.id ?? ''),
                  args: (block.input ?? {}) as Record<string, unknown>,
                } as StreamEvent,
                projectId: config.projectId,
              });
            }
          }
        } else if (event.type === 'result') {
          if (!responseText && event.result) {
            responseText = String(event.result);
          }
        }
      } catch {
        // ignore JSON parse errors for non-JSON lines
      }
    }
  });

  child.stderr.on('data', (chunk: Buffer) => {
    postLog(`[CLI stderr] ${chunk.toString('utf-8').trim()}`);
  });

  const abortHandler = () => {
    postLog('[CLI] Aborting session via SIGTERM');
    child.kill('SIGTERM');
  };
  abortSignal.addEventListener('abort', abortHandler);

  try {
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.on('close', (code) => {
        abortSignal.removeEventListener('abort', abortHandler);
        resolve(code);
      });
      child.on('error', (err) => {
        abortSignal.removeEventListener('abort', abortHandler);
        reject(err);
      });
    });

    if (abortSignal.aborted) {
      return {
        outcome: 'cancelled',
        stepsExecuted: 0,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        messages: [],
        durationMs: Date.now() - startTime,
        toolCallCount,
      };
    }

    if (exitCode !== 0) {
      return {
        outcome: 'error',
        stepsExecuted: 0,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        messages: [],
        durationMs: Date.now() - startTime,
        toolCallCount,
        error: { code: 'error', message: `claude CLI exited with code ${exitCode}`, retryable: true },
      };
    }

    postLog(`[CLI] ${agentType} session complete (toolCalls=${toolCallCount})`);
    return {
      outcome: 'completed',
      stepsExecuted: 1,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      messages: [],
      durationMs: Date.now() - startTime,
      toolCallCount,
    };
  } catch (error) {
    abortSignal.removeEventListener('abort', abortHandler);
    const msg = error instanceof Error ? error.message : String(error);
    return {
      outcome: 'error',
      stepsExecuted: 0,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      messages: [],
      durationMs: Date.now() - startTime,
      toolCallCount,
      error: { code: 'error', message: msg, retryable: false },
    };
  }
}

// =============================================================================
// Single Session Runner
// =============================================================================

/**
 * Run a single agent session and return the result.
 * Used as the runSession callback for BuildOrchestrator and QALoop.
 */
async function runSingleSession(
  agentType: AgentType,
  phase: Phase,
  systemPrompt: string,
  specDir: string,
  projectDir: string,
  sessionNumber: number,
  subtaskId: string | undefined,
  baseSession: SerializableSessionConfig,
  toolContext: ToolContext,
  registry: ToolRegistry,
  initialUserMessage?: string,
  skipPhaseLogging = false,
  outputSchema?: import('zod').ZodSchema,
): Promise<SessionResult> {
  // Use queue-resolved model ID from baseSession (already mapped to the correct
  // provider-specific model, e.g., 'gpt-5.3-codex' for OpenAI Codex).
  // getPhaseModel() only knows local shorthands (opus → claude-opus-5-5) and
  // would create a mismatch when the provider queue selected a non-Anthropic account.
  const phaseModelId = baseSession.modelId;
  const phaseThinking = await getPhaseThinking(specDir, phase);

  const model = createProvider({
    config: {
      provider: baseSession.provider as SupportedProvider,
      apiKey: baseSession.apiKey,
      baseURL: baseSession.baseURL,
      oauthTokenFilePath: baseSession.oauthTokenFilePath,
    },
    modelId: phaseModelId,
  });

  const tools: Record<string, AITool> = {
    ...registry.getToolsForAgent(agentType, toolContext),
    ...(mergeMcpTools(mcpClients) as Record<string, AITool>),
  };

  // Build initial messages: use provided kickoff message, or fall back to session messages
  const initialMessages = initialUserMessage
    ? [{ role: 'user' as const, content: initialUserMessage }]
    : baseSession.initialMessages;

  // Resolve context window limit from model metadata
  const contextWindowLimit = getModelContextWindow(phaseModelId);

  const sessionConfig: SessionConfig = {
    agentType,
    model,
    systemPrompt,
    initialMessages,
    toolContext,
    maxSteps: baseSession.maxSteps,
    thinkingLevel: phaseThinking as SessionConfig['thinkingLevel'],
    abortSignal: abortController.signal,
    specDir,
    projectDir,
    phase,
    modelShorthand: undefined,
    sessionNumber,
    subtaskId,
    contextWindowLimit,
    outputSchema,
  };

  // Start phase logging for this session (skip when orchestrator manages phases)
  if (logWriter && !skipPhaseLogging) {
    logWriter.startPhase(phase);
  }
  if (logWriter && subtaskId) {
    logWriter.setSubtask(subtaskId);
  }

  const runnerOptions = {
    tools,
    onEvent: (event: StreamEvent) => {
      // Write stream events to task_logs.json for UI log display
      if (logWriter) {
        logWriter.processEvent(event, phase);
      }
      // Also relay to main thread for real-time progress updates
      postMessage({
        type: 'stream-event',
        taskId: config.taskId,
        data: event,
        projectId: config.projectId,
      });
    },
    onAuthRefresh: baseSession.configDir
      ? () => refreshOAuthTokenReactive(baseSession.configDir as string)
      : undefined,
    onModelRefresh: baseSession.configDir
      ? (newToken: string) => createProvider({
          config: {
            provider: baseSession.provider as SupportedProvider,
            apiKey: newToken,
            baseURL: baseSession.baseURL,
          },
          modelId: phaseModelId,
        })
      : undefined,
  };

  let sessionResult: SessionResult;
  try {
    sessionResult = await runContinuableSession(sessionConfig, runnerOptions, {
      contextWindowLimit,
      apiKey: baseSession.apiKey,
      baseURL: baseSession.baseURL,
      oauthTokenFilePath: baseSession.oauthTokenFilePath,
      configDir: baseSession.configDir,
    });
  } catch (error) {
    // Ensure log cleanup happens on failure
    if (logWriter && !skipPhaseLogging) logWriter.endPhase(phase, false);
    if (logWriter) logWriter.setSubtask(undefined);
    throw error;
  }

  // End phase logging — mark as completed or failed based on outcome (skip when orchestrator manages phases)
  if (logWriter && !skipPhaseLogging) {
    const success = sessionResult.outcome === 'completed' || sessionResult.outcome === 'max_steps' || sessionResult.outcome === 'context_window';
    logWriter.endPhase(phase, success);
  }
  if (logWriter) {
    logWriter.setSubtask(undefined);
  }

  return sessionResult;
}

// =============================================================================
// Session Execution
// =============================================================================

async function run(): Promise<void> {
  const { session } = config;

  postLog(`Starting agent session: type=${session.agentType}, model=${session.modelId}`);

  try {
    const securityProfile = buildSecurityProfile(session);
    const toolContext = buildToolContext(session, securityProfile);
    const registry = buildToolRegistry();

    // Initialize MCP clients from session config
    try {
      mcpClients = await createMcpClientsForAgent(session.agentType, {
        context7Enabled: session.mcpOptions?.context7Enabled ?? true,
        linearEnabled: session.mcpOptions?.linearEnabled ?? false,
        electronMcpEnabled: session.mcpOptions?.electronMcpEnabled ?? false,
        puppeteerMcpEnabled: session.mcpOptions?.puppeteerMcpEnabled ?? false,
        projectCapabilities: session.mcpOptions?.projectCapabilities,
        agentMcpAdd: session.mcpOptions?.agentMcpAdd,
        agentMcpRemove: session.mcpOptions?.agentMcpRemove,
      });
      if (mcpClients.length > 0) {
        postLog(`MCP initialized: ${mcpClients.map(c => c.serverId).join(', ')}`);
      }
    } catch (error) {
      postLog(`MCP init failed (non-fatal): ${error instanceof Error ? error.message : String(error)}`);
    }

    // Route to orchestrator for build_orchestrator agent type
    if (session.agentType === 'build_orchestrator') {
      await runBuildOrchestrator(session, toolContext, registry);
      return;
    }

    // Route to QA loop for qa_reviewer agent type
    if (session.agentType === 'qa_reviewer') {
      await runQALoop(session, toolContext, registry);
      return;
    }

    // Route to spec orchestrator for spec_orchestrator agent type
    if (session.agentType === 'spec_orchestrator') {
      if (session.useAgenticOrchestration) {
        await runAgenticSpecOrchestrator(session, toolContext, registry);
      } else {
        await runSpecOrchestrator(session, toolContext, registry);
      }
      return;
    }

    // Default: single session for all other agent types
    await runDefaultSession(session, toolContext, registry);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    postError(`Agent session failed: ${message}`);
  } finally {
    // Cleanup MCP clients
    if (mcpClients.length > 0) {
      await closeAllMcpClients(mcpClients);
    }
  }
}

/**
 * Run a single agent session (default path for spec_orchestrator, etc.)
 */
async function runDefaultSession(
  session: SerializableSessionConfig,
  _toolContext: ToolContext,
  _registry: ToolRegistry,
): Promise<void> {
  postLog(`Running ${session.agentType} session via CLI`);

  const kickoffMessage = session.initialMessages?.[0]?.content
    ? typeof session.initialMessages[0].content === 'string'
      ? session.initialMessages[0].content
      : 'Proceed as described in your system prompt.'
    : 'Proceed as described in your system prompt.';

  const result = await runSessionViaCLI(
    session.agentType,
    session.systemPrompt,
    kickoffMessage,
    session.projectDir,
    session.modelId,
    abortController.signal,
    session.configDir,
  );

  if (result.outcome === 'error' && result.error) {
    postError(`Session failed: ${result.error.message}`);
  }
}

/** Map ExecutionPhase to Phase for log writer. Returns undefined for non-loggable phases. */
function mapExecutionPhaseToPhase(executionPhase: ExecutionPhase): Phase | undefined {
  switch (executionPhase) {
    case 'planning': return 'planning';
    case 'coding': return 'coding';
    case 'qa_review': return 'qa';
    case 'qa_fixing': return 'qa';
    default: return undefined; // idle, complete, failed, pause states
  }
}

/**
 * Run the full build orchestration pipeline:
 * planning → coding (per subtask) → QA review → QA fixing
 */
async function runBuildOrchestrator(
  session: SerializableSessionConfig,
  toolContext: ToolContext,
  registry: ToolRegistry,
): Promise<void> {
  postLog('Starting BuildOrchestrator pipeline (planning → coding → QA)');

  const orchestrator = new BuildOrchestrator({
    specDir: session.specDir,
    projectDir: session.projectDir,
    sourceSpecDir: session.sourceSpecDir,
    abortSignal: abortController.signal,
    verifyCommand: session.verifyCommand,

    // Independent risk / fast-scan reviews before each QA review (/proofread style)
    runReviewLenses: async () => {
      const diff = readTaskDiff(session.projectDir);
      const specFile = join(session.specDir, 'spec.md');
      const spec = existsSync(specFile) ? readFileSync(specFile, 'utf-8') : '';
      const results = await runReviewLenses(diff, spec, async ({ prompt, model }) => {
        const result = await runClaudeCliDetailed({
          prompt,
          cwd: session.projectDir,
          modelId: model,
          allowedTools: ['Read', 'Glob', 'Grep'],
          restrictTools: true,
          minimalContext: true,
          projectContext: true,
          maxTurns: 15,
          abortSignal: abortController.signal,
          // Worker threads can't look up the active profile: pass the task's account explicitly
          env: session.configDir ? { CLAUDE_CONFIG_DIR: session.configDir } : {},
        });
        return result.text || result.resultText;
      });
      for (const r of results) {
        postLog(`QA ${r.lens} review: ${r.error ? `failed (${r.error})` : `${r.findings.length} finding(s)`}`);
      }
      return buildLensSection(results);
    },

    // Revert safety for QA fixes: only inside a task worktree, never the user's checkout
    checkpoint: async () => {
      if (!isTaskWorktree(session.projectDir)) return null;
      return gitCheckpoint(session.projectDir);
    },
    revertTo: async (commit) => {
      if (!isTaskWorktree(session.projectDir)) return false;
      return gitResetHard(session.projectDir, commit);
    },

    generatePrompt: async (agentType, _phase, context) => {
      const promptName = agentType === 'coder' ? 'coder' : agentType;
      let prompt = await assemblePrompt(promptName, session);

      // Inject schema validation error feedback on retry so the planner knows what to fix
      if (context.planningRetryContext) {
        prompt += `\n\n${context.planningRetryContext}`;
      }

      return prompt;
    },

    runSession: async (runConfig) => {
      postLog(`Running ${runConfig.agentType} session via CLI (phase=${runConfig.phase}, session=${runConfig.sessionNumber})`);
      const kickoffMessage = buildKickoffMessage(runConfig.agentType, runConfig.specDir, runConfig.projectDir);
      return runSessionViaCLI(
        runConfig.agentType,
        runConfig.systemPrompt,
        kickoffMessage,
        runConfig.projectDir,
        session.modelId,
        abortController.signal,
        session.configDir,
      );
    },
  });

  orchestrator.on('phase-change', (phase: ExecutionPhase, message: string) => {
    postLog(`Phase: ${phase} — ${message}`);
    // Start the phase in the log writer at orchestrator level (not per-session)
    const logPhase = mapExecutionPhaseToPhase(phase);
    if (logWriter && logPhase) {
      logWriter.startPhase(logPhase, message);
    }
    // Emit XState-compatible task events for phase transitions
    // so the state machine tracks the build lifecycle correctly.
    if (phase === 'coding') {
      postTaskEvent('CODING_STARTED', { subtaskId: '', subtaskDescription: 'Starting coding phase' });
    } else if (phase === 'qa_review') {
      postTaskEvent('QA_STARTED', { iteration: 0, maxIterations: 3 });
    } else if (phase === 'qa_fixing') {
      postTaskEvent('QA_FIXING_STARTED', { iteration: 0 });
    }
    // Emit execution-progress so the main thread can:
    // 1. Re-point the file watcher to the worktree spec dir
    // 2. Update the UI with phase progress
    postMessage({
      type: 'execution-progress',
      taskId: config.taskId,
      data: {
        phase,
        phaseProgress: 0,
        overallProgress: 0,
        message,
      },
      projectId: config.projectId,
    });
  });

  orchestrator.on('iteration-start', (iteration: number, phase: ExecutionPhase) => {
    postMessage({
      type: 'execution-progress',
      taskId: config.taskId,
      data: {
        phase,
        phaseProgress: 0,
        overallProgress: 0,
        message: `Iteration ${iteration} (${phase})`,
      },
      projectId: config.projectId,
    });
  });

  orchestrator.on('session-complete', (_result: SessionResult, phase: string) => {
    // Notify the main process that a session (subtask) completed.
    // This triggers persistPlanPhaseSync → invalidateTasksCache so the frontend
    // sees updated subtask statuses in the implementation plan.
    postMessage({
      type: 'execution-progress',
      taskId: config.taskId,
      data: {
        phase: phase as ExecutionPhase,
        phaseProgress: 0,
        overallProgress: 0,
        message: `Session complete (${phase})`,
      },
      projectId: config.projectId,
    });
  });

  orchestrator.on('log', (message: string) => {
    postLog(message);
  });

  orchestrator.on('error', (error: Error, phase: string) => {
    postLog(`Error in ${phase} phase: ${error.message}`);
  });

  const outcome = await orchestrator.run();

  // End the final phase and flush any remaining accumulated log entries.
  // When the orchestrator reaches 'complete' or 'failed', finalPhase is a terminal
  // state that doesn't map to a log phase. In that case, close whichever log phase
  // is still marked 'active' so the UI shows "Complete" instead of "Running".
  if (logWriter) {
    const finalLogPhase = mapExecutionPhaseToPhase(outcome.finalPhase);
    if (finalLogPhase) {
      logWriter.endPhase(finalLogPhase, outcome.success);
    } else {
      // Terminal state (complete/failed) — close any still-active log phase
      const data = logWriter.getData();
      for (const phase of ['validation', 'coding', 'planning'] as const) {
        if (data.phases[phase]?.status === 'active') {
          const mapped = phase === 'validation' ? 'qa' : phase;
          logWriter.endPhase(mapped as 'qa' | 'coding' | 'planning', outcome.success);
          break;
        }
      }
    }
    logWriter.flush();
  }

  // Emit task events based on orchestration outcome so XState machine
  // can transition to the correct state (e.g., human_review on success).
  if (outcome.success) {
    postTaskEvent('QA_PASSED');
    postTaskEvent('BUILD_COMPLETE');
  } else if (outcome.codingCompleted) {
    // Coding succeeded but QA failed — emit QA-specific event so XState
    // transitions to 'error' with reviewReason='errors' instead of the
    // generic CODING_FAILED which would be misleading.
    postTaskEvent('QA_MAX_ITERATIONS', {
      iteration: outcome.totalIterations,
      maxIterations: 3,
    });
  } else {
    // Pre-QA failure (planning or coding phase)
    postTaskEvent('CODING_FAILED', { error: outcome.error });
  }

  // Map outcome to a SessionResult-compatible result for the bridge
  const result: SessionResult = {
    outcome: outcome.success ? 'completed' : 'error',
    stepsExecuted: outcome.totalIterations,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    messages: [],
    toolCallCount: 0,
    durationMs: outcome.durationMs,
    error: outcome.error
      ? { code: 'error', message: outcome.error, retryable: false }
      : undefined,
  };

  postMessage({
    type: 'result',
    taskId: config.taskId,
    data: result,
    projectId: config.projectId,
  });
}

/**
 * Run the QA validation loop: qa_reviewer → qa_fixer → re-review
 */
async function runQALoop(
  session: SerializableSessionConfig,
  toolContext: ToolContext,
  registry: ToolRegistry,
): Promise<void> {
  postLog('Starting QA validation loop');

  const qaLoop = new QALoop({
    specDir: session.specDir,
    projectDir: session.projectDir,
    abortSignal: abortController.signal,

    generatePrompt: async (agentType, _context) => {
      const promptName = agentType === 'qa_fixer' ? 'qa_fixer' : 'qa_reviewer';
      return assemblePrompt(promptName, session);
    },

    runSession: async (runConfig) => {
      postLog(`Running ${runConfig.agentType} session via CLI (session=${runConfig.sessionNumber})`);
      const kickoffMessage = buildKickoffMessage(runConfig.agentType, runConfig.specDir, runConfig.projectDir);
      return runSessionViaCLI(
        runConfig.agentType,
        runConfig.systemPrompt,
        kickoffMessage,
        runConfig.projectDir,
        session.modelId,
        abortController.signal,
        session.configDir,
      );
    },
  });

  qaLoop.on('log', (message: string) => {
    postLog(message);
  });

  // Start QA validation phase logging at the loop level
  if (logWriter) {
    logWriter.startPhase('qa');
  }

  const outcome = await qaLoop.run();

  // End QA validation phase and flush any remaining accumulated log entries
  if (logWriter) {
    logWriter.endPhase('qa', outcome.approved);
    logWriter.flush();
  }

  // Emit task events so XState machine transitions correctly.
  if (outcome.approved) {
    postTaskEvent('QA_PASSED');
  } else if (outcome.reason === 'max_iterations') {
    postTaskEvent('QA_MAX_ITERATIONS');
  } else {
    postTaskEvent('QA_AGENT_ERROR', { error: outcome.error });
  }

  const result: SessionResult = {
    outcome: outcome.approved ? 'completed' : 'error',
    stepsExecuted: outcome.totalIterations,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    messages: [],
    toolCallCount: 0,
    durationMs: outcome.durationMs,
    error: outcome.error
      ? { code: 'error', message: outcome.error, retryable: false }
      : undefined,
  };

  postMessage({
    type: 'result',
    taskId: config.taskId,
    data: result,
    projectId: config.projectId,
  });
}

/**
 * Regenerate `<specDir>/project_index.json` and return a compact summary of it
 * (plus the file path, so agents can Read the full index on demand).
 * Non-fatal: returns undefined when indexing fails.
 */
function generateProjectIndexSummary(specDir: string, projectDir: string): string | undefined {
  try {
    const indexOutputPath = join(specDir, 'project_index.json');
    postLog('Generating project index...');
    runProjectIndexer(projectDir, indexOutputPath);
    const fullIndex = readFileSync(indexOutputPath, 'utf-8');
    const summary = summarizeProjectIndex(fullIndex);
    if (!summary) return undefined;
    postLog(`Project index generated (${(fullIndex.length / 1024).toFixed(1)}KB, summary ${(summary.length / 1024).toFixed(1)}KB)`);
    return (
      `${summary}\n\n` +
      `Full index (dependencies, routes, models, env vars): \`${indexOutputPath}\` — Read it only if you need those details.`
    );
  } catch (error) {
    postLog(`Project index generation failed (non-fatal): ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

/**
 * Run the spec creation orchestration pipeline with complexity-based phase routing.
 */
async function runSpecOrchestrator(
  session: SerializableSessionConfig,
  toolContext: ToolContext,
  registry: ToolRegistry,
): Promise<void> {
  // Extract the task description from the first user message
  const taskDescription = session.initialMessages?.[0]?.content
    ? typeof session.initialMessages[0].content === 'string'
      ? session.initialMessages[0].content
      : 'Create the specification as described in your system prompt.'
    : 'Create the specification as described in your system prompt.';

  postLog(`Starting SpecOrchestrator pipeline (complexity-first phase routing)`);

  // Generate project index BEFORE any agent runs — gives all phases project context
  const projectIndexContent = generateProjectIndexSummary(session.specDir, session.projectDir);

  const orchestrator = new SpecOrchestrator({
    specDir: session.specDir,
    projectDir: session.projectDir,
    taskDescription,
    projectIndex: projectIndexContent,
    abortSignal: abortController.signal,

    generatePrompt: async (_agentType, phase, context) => {
      const promptName = specPhaseToPromptName(phase);
      let prompt = await assemblePrompt(promptName, session);

      // Inject schema validation error feedback on retry so the agent knows what to fix
      if (context.schemaRetryContext) {
        prompt += `\n\n${context.schemaRetryContext}`;
      }

      return prompt;
    },

    runSession: async (runConfig) => {
      postLog(`Running ${runConfig.agentType} session (spec phase=${runConfig.specPhase ?? runConfig.phase}, session=${runConfig.sessionNumber})`);
      const kickoffMessage = buildSpecKickoffMessage(
        runConfig.agentType,
        runConfig.specDir,
        runConfig.projectDir,
        taskDescription,
        runConfig.priorPhaseOutputs,
        runConfig.projectIndex,
        runConfig.specPhase,
      );
      return runSessionViaCLI(
        runConfig.agentType,
        runConfig.systemPrompt,
        kickoffMessage,
        runConfig.projectDir,
        session.modelId,
        abortController.signal,
        session.configDir,
      );
    },
  });

  // Wire event listeners
  orchestrator.on('phase-start', (phase: SpecPhase, phaseNumber: number, totalPhases: number) => {
    postLog(`Spec phase ${phaseNumber}/${totalPhases}: ${phase}`);
    if (logWriter) {
      logWriter.startPhase('spec', `${phase} (${phaseNumber}/${totalPhases})`);
    }
    postMessage({
      type: 'execution-progress',
      taskId: config.taskId,
      data: {
        phase: 'planning', // spec creation maps to 'planning' in the UI execution phases
        phaseProgress: phaseNumber / Math.max(totalPhases, 1),
        overallProgress: phaseNumber / Math.max(totalPhases, 1),
        message: `Spec creation: ${phase} (${phaseNumber}/${totalPhases})`,
      },
      projectId: config.projectId,
    });
  });

  orchestrator.on('phase-complete', (_phase: SpecPhase, _result: unknown) => {
    // End the current spec log phase so the next one can start fresh
    if (logWriter) {
      logWriter.endPhase('spec', true);
    }
  });

  orchestrator.on('log', (message: string) => {
    postLog(message);
  });

  orchestrator.on('error', (error: Error, phase: SpecPhase) => {
    postLog(`Error in spec ${phase} phase: ${error.message}`);
  });

  const outcome = await orchestrator.run();

  // Emit task event on failure so XState gets a specific signal
  // instead of relying on the generic PROCESS_EXITED fallback.
  if (!outcome.success) {
    postTaskEvent('PLANNING_FAILED', { error: outcome.error });
  }

  // Ensure any still-active log phase is closed and flushed
  if (logWriter) {
    const data = logWriter.getData();
    // toLogPhase('spec') maps to 'planning' in the log writer
    if (data.phases.planning?.status === 'active') {
      logWriter.endPhase('spec', outcome.success);
    }
    logWriter.flush();
  }

  // Map outcome to SessionResult for the worker bridge
  const result: SessionResult = {
    outcome: outcome.success ? 'completed' : 'error',
    stepsExecuted: outcome.phasesExecuted.length,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    messages: [],
    toolCallCount: 0,
    durationMs: outcome.durationMs,
    error: outcome.error
      ? { code: 'error', message: outcome.error, retryable: false }
      : undefined,
  };

  postMessage({
    type: 'result',
    taskId: config.taskId,
    data: result,
    projectId: config.projectId,
  });
}

/**
 * Run the spec creation pipeline using agentic orchestration.
 * Instead of procedural phase routing, an AI orchestrator agent drives the
 * entire pipeline using tools (including SpawnSubagent for specialist work).
 */
async function runAgenticSpecOrchestrator(
  session: SerializableSessionConfig,
  toolContext: ToolContext,
  registry: ToolRegistry,
): Promise<void> {
  // Extract task description
  const taskDescription = session.initialMessages?.[0]?.content
    ? typeof session.initialMessages[0].content === 'string'
      ? session.initialMessages[0].content
      : 'Create the specification as described in your system prompt.'
    : 'Create the specification as described in your system prompt.';

  postLog('Starting Agentic SpecOrchestrator (AI-driven pipeline via SpawnSubagent)');

  // Generate project index
  const projectIndexContent = generateProjectIndexSummary(session.specDir, session.projectDir);

  // Create the SubagentExecutor
  const model = createProvider({
    config: {
      provider: session.provider as SupportedProvider,
      apiKey: session.apiKey,
      baseURL: session.baseURL,
      oauthTokenFilePath: session.oauthTokenFilePath,
    },
    modelId: session.modelId,
  });

  const executor = new SubagentExecutorImpl({
    model,
    registry,
    baseToolContext: {
      ...toolContext,
      allowedWritePaths: [session.specDir],
    },
    loadPrompt: async (promptName: string) => assemblePrompt(promptName, session),
    abortSignal: abortController.signal,
    onSubagentEvent: (agentType: string, event: string) => {
      postLog(`Subagent ${agentType}: ${event}`);
    },
  });

  // Create an extended tool context with the executor
  const orchestratorToolContext: ToolContext & { subagentExecutor: SubagentExecutorImpl } = {
    ...toolContext,
    allowedWritePaths: [session.specDir],
    subagentExecutor: executor,
  };

  // Load the agentic orchestrator prompt
  const systemPrompt = await assemblePrompt('spec_orchestrator_agentic', session);

  // Build the kickoff message
  const kickoffParts = [
    `Create a complete specification for the following task:\n\n${taskDescription}\n`,
    `\nSpec directory: ${session.specDir}`,
    `\nProject directory: ${session.projectDir}`,
  ];

  if (projectIndexContent) {
    kickoffParts.push(`\n\n## PROJECT INDEX\n\n${projectIndexContent}`);
  }

  const kickoffMessage = kickoffParts.join('');

  // Resolve context window and tools
  const contextWindowLimit = getModelContextWindow(session.modelId);
  const phaseThinking = await getPhaseThinking(session.specDir, 'spec');

  // Get tools for the orchestrator (includes SpawnSubagent since it's in AGENT_CONFIGS)
  const tools: Record<string, AITool> = {
    ...registry.getToolsForAgent('spec_orchestrator', orchestratorToolContext),
    ...(mergeMcpTools(mcpClients) as Record<string, AITool>),
  };

  const sessionConfig: SessionConfig = {
    agentType: 'spec_orchestrator',
    model,
    systemPrompt,
    initialMessages: [{ role: 'user' as const, content: kickoffMessage }],
    toolContext: orchestratorToolContext,
    maxSteps: session.maxSteps,
    thinkingLevel: phaseThinking as SessionConfig['thinkingLevel'],
    abortSignal: abortController.signal,
    specDir: session.specDir,
    projectDir: session.projectDir,
    phase: 'spec',
    sessionNumber: 1,
    contextWindowLimit,
  };

  // Start phase logging
  if (logWriter) {
    logWriter.startPhase('spec', 'Agentic spec orchestration');
  }

  let result: SessionResult | undefined;
  try {
    result = await runContinuableSession(sessionConfig, {
      tools,
      onEvent: (event: StreamEvent) => {
        if (logWriter) {
          logWriter.processEvent(event, 'spec');
        }
        postMessage({
          type: 'stream-event',
          taskId: config.taskId,
          data: event,
          projectId: config.projectId,
        });
      },
      onAuthRefresh: session.configDir
        ? () => refreshOAuthTokenReactive(session.configDir as string)
        : undefined,
      onModelRefresh: session.configDir
        ? (newToken: string) => createProvider({
            config: {
              provider: session.provider as SupportedProvider,
              apiKey: newToken,
              baseURL: session.baseURL,
            },
            modelId: session.modelId,
          })
        : undefined,
    }, {
      contextWindowLimit,
      apiKey: session.apiKey,
      baseURL: session.baseURL,
      oauthTokenFilePath: session.oauthTokenFilePath,
      configDir: session.configDir,
    });
  } finally {
    if (logWriter) {
      const success = result?.outcome === 'completed' || result?.outcome === 'max_steps' || result?.outcome === 'context_window';
      logWriter.endPhase('spec', success ?? false);
      logWriter.flush();
    }
  }

  postMessage({
    type: 'result',
    taskId: config.taskId,
    data: result as SessionResult,
    projectId: config.projectId,
  });
}

/**
 * Map a SpecPhase to the prompt file name to load.
 * Falls back to the closest available prompt when a phase-specific one doesn't exist.
 */
function specPhaseToPromptName(phase: SpecPhase): string {
  switch (phase) {
    case 'discovery': return 'spec_gatherer';
    case 'requirements': return 'spec_gatherer';
    case 'complexity_assessment': return 'complexity_assessor';
    case 'research': return 'spec_researcher';
    case 'context': return 'spec_writer';
    case 'spec_writing': return 'spec_writer';
    case 'self_critique': return 'spec_critic';
    case 'planning': return 'planner';
    case 'quick_spec': return 'spec_quick';
    case 'validation': return 'spec_writer';
    default: return 'spec_writer';
  }
}

/**
 * Build a kickoff user message for a spec phase session.
 * Includes accumulated context from prior phases to eliminate redundant file reads.
 */
function buildSpecKickoffMessage(
  agentType: AgentType,
  specDir: string,
  projectDir: string,
  taskDescription: string,
  priorPhaseOutputs?: Record<string, string>,
  projectIndex?: string,
  specPhase?: string,
): string {
  // Build the base task-specific message
  let baseMessage: string;

  // Spec phase takes priority over agentType for kickoff routing
  // (e.g., complexity_assessment uses spec_gatherer agentType but needs a different kickoff)
  if (specPhase === 'complexity_assessment') {
    baseMessage = `Assess the complexity of the following task and write your assessment to ${specDir}/complexity_assessment.json. Task: ${taskDescription}. Project root: ${projectDir}. Determine if this is a SIMPLE, STANDARD, or COMPLEX task based on the scope of changes required.\n\nIMPORTANT: This is the FIRST phase of the spec pipeline. No spec.md or other spec files exist yet — do NOT attempt to read them. Assess complexity based on the task description and the project structure at ${projectDir} only.`;
  } else switch (agentType) {
    case 'spec_discovery':
      baseMessage = `Analyze the project structure at ${projectDir} to understand the codebase architecture, tech stack, and conventions. Write your findings to ${specDir}/context.json. Task context: ${taskDescription}\n\nIMPORTANT: This is an early phase of the spec pipeline. No spec.md exists yet — do NOT attempt to read it. Analyze the project source code at ${projectDir} directly.`;
      break;
    case 'spec_gatherer':
      baseMessage = `Gather and validate requirements for the following task: ${taskDescription}. Project root: ${projectDir}. Write requirements to ${specDir}/requirements.json.\n\nIMPORTANT: This is an early phase of the spec pipeline. No spec.md exists yet — do NOT attempt to read it. Derive requirements from the task description and the project source code at ${projectDir}.`;
      break;
    case 'spec_researcher':
      baseMessage = `Research implementation approaches for: ${taskDescription}. Review relevant code in ${projectDir} and document your findings in ${specDir}/research.json.`;
      break;
    case 'spec_writer':
      baseMessage = `Write the specification for: ${taskDescription}. Write spec.md to ${specDir}. Project root: ${projectDir}.`;
      break;
    case 'planner':
      baseMessage = `Create a detailed implementation plan for: ${taskDescription}. Read the spec at ${specDir}/spec.md and create ${specDir}/implementation_plan.json with concrete coding subtasks. Project root: ${projectDir}.`;
      break;
    case 'spec_critic':
      baseMessage = `Review and critique the specification at ${specDir}/spec.md for completeness, clarity, and technical feasibility. Write your critique findings back to ${specDir}/spec.md with improvements.`;
      break;
    case 'spec_context':
      baseMessage = `Gather project context relevant to: ${taskDescription}. Analyze the codebase at ${projectDir} and write context to ${specDir}/context.json.\n\nIMPORTANT: This is an early phase of the spec pipeline. No spec.md exists yet — do NOT attempt to read it. Analyze the project source code at ${projectDir} directly.`;
      break;
    case 'spec_validation':
      baseMessage = `Validate that ${specDir}/spec.md and ${specDir}/implementation_plan.json are complete, consistent, and ready for implementation. Fix any issues found.`;
      break;
    default:
      baseMessage = `Complete the spec creation task described in your system prompt. Task: ${taskDescription}. Spec directory: ${specDir}. Project directory: ${projectDir}`;
  }

  // Inject accumulated context from prior phases
  const contextSections: string[] = [baseMessage];

  if (projectIndex) {
    contextSections.push(`\n\n## PROJECT INDEX (pre-generated)\n\nThe following project structure summary has been pre-generated for you. Use this as your starting point instead of scanning the entire project:\n\n${projectIndex}`);
  }

  if (priorPhaseOutputs && Object.keys(priorPhaseOutputs).length > 0) {
    contextSections.push('\n\n## CONTEXT FROM PRIOR PHASES\n\nThe following outputs from earlier spec phases are provided to avoid re-reading files:');
    for (const [fileName, content] of Object.entries(priorPhaseOutputs)) {
      const ext = fileName.endsWith('.json') ? 'json' : 'markdown';
      contextSections.push(`\n### ${fileName}\n\n\`\`\`${ext}\n${content}\n\`\`\``);
    }
    contextSections.push('\nUse these outputs as your primary source of context. Only read additional project files if you need specific code patterns not covered above.');
  }

  return contextSections.join('');
}

/**
 * Build a kickoff user message for an agent session.
 * The AI SDK requires at least one user message; this provides a concrete task directive.
 */
function buildKickoffMessage(agentType: AgentType, specDir: string, projectDir: string): string {
  switch (agentType) {
    case 'planner':
      return `Read the spec at ${specDir}/spec.md and create a detailed implementation plan at ${specDir}/implementation_plan.json. Project root: ${projectDir}`;
    case 'coder':
      return `Read ${specDir}/implementation_plan.json and implement the next pending subtask. Project root: ${projectDir}. After completing the subtask, update its status to "completed" in implementation_plan.json.`;
    case 'qa_reviewer':
      return `Review the implementation in ${projectDir} against the specification in ${specDir}/spec.md. Write your findings to ${specDir}/qa_report.md with a clear "Status: PASSED" or "Status: FAILED" line.`;
    case 'qa_fixer':
      return `Read ${specDir}/qa_report.md for the issues found by QA review. Fix all issues in ${projectDir}. After fixing, update ${specDir}/qa_report.md to indicate fixes have been applied.`;
    default:
      return `Complete the task described in your system prompt. Spec directory: ${specDir}. Project directory: ${projectDir}`;
  }
}

/**
 * Build a minimal fallback prompt when the prompts directory is not found.
 */
function buildFallbackPrompt(agentType: AgentType, specDir: string, projectDir: string): string {
  switch (agentType) {
    case 'planner':
      return `You are a planning agent. Read spec.md in ${specDir} and create implementation_plan.json with phases and subtasks. Each subtask must have id, description, and status fields. Set all statuses to "pending".`;
    case 'coder':
      return `You are a coding agent. Implement the current pending subtask from implementation_plan.json in ${specDir}. Project root: ${projectDir}. After completing the subtask, update its status to "completed" in implementation_plan.json.`;
    case 'qa_reviewer':
      return `You are a QA reviewer. Review the implementation in ${projectDir} against the spec in ${specDir}/spec.md. Write your findings to ${specDir}/qa_report.md with "Status: PASSED" or "Status: FAILED".`;
    case 'qa_fixer':
      return `You are a QA fixer. Read ${specDir}/qa_report.md for the issues found by QA review. Fix the issues in ${projectDir}. After fixing, update ${specDir}/implementation_plan.json qa_signoff status to "fixes_applied".`;
    default:
      return `You are an AI agent. Complete the task described in ${specDir}/spec.md for the project at ${projectDir}.`;
  }
}

// Start execution
run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  postError(`Unhandled worker error: ${message}`);
});
