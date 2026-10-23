# AI Agent Layer

All AI agent logic uses the Vercel AI SDK v6 (`ai` package). Never use `@anthropic-ai/sdk` directly.

## Architecture

- **Provider Layer** (`providers/`) — Multi-provider via `createProviderRegistry()`. Supports Anthropic, OpenAI, Google, Bedrock, Azure, Mistral, Groq, xAI, Ollama. Provider-specific transforms handle thinking token normalization and prompt caching.
- **Session Runtime** (`session/`) — `runAgentSession()` uses `streamText()` with `stopWhen: stepCountIs(N)`. Error classification (429/401/400), progress tracking.
- **Worker Threads** (`agent/`) — Sessions run in `worker_threads` to avoid blocking main process. `WorkerBridge` relays events to `AgentManagerEvents`.
- **Build Orchestration** (`orchestration/`) — Planner → coder → QA pipeline (build/QA/spec sessions run through the `claude` CLI). `SpawnSubagent` for orchestrator agents (SDK path). `RefineOrchestrator` handles the mega-groom pipeline. A spec dir's `HUMAN_INPUT.md` is injected into every prompt.
- **Tools** (`tools/`) — 8 builtin tools (Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch) defined with Zod schemas via `tool()`.
- **Security** (`security/`) — Bash validator, command parser, path containment with identical allowlist behavior.
- **Config** (`config/`) — `AGENT_CONFIGS` registry (24 agent types), phase-aware model resolution, thinking budgets.

## Key Patterns

```typescript
import { streamText, stepCountIs } from 'ai';

const result = streamText({
  model: provider,
  system: systemPrompt,
  messages: conversationHistory,
  tools: toolRegistry.getToolsForAgent(agentType),
  stopWhen: stepCountIs(1000),
  onStepFinish: ({ toolCalls, text, usage }) => {
    progressTracker.update(toolCalls, text);
  },
});
```

## Agent Prompts (`prompts/`)

| Prompt | Purpose |
|--------|---------|
| planner.md | Implementation plan with subtasks |
| coder.md | Subtask implementation |
| qa_reviewer.md / qa_fixer.md | Acceptance validation / issue fixes |
| spec_gatherer/researcher/writer/critic.md | Spec creation pipeline |
| refine/ | Mega-groom pipeline (understand, prd, grill, plan, proofread) |

## Spec Directory Structure

Each spec in `.malvy/specs/XXX-name/` contains: `spec.md`, `implementation_plan.json`, `task_metadata.json`, `refine_session.json`, `context.json`, `qa_report.md`

## Memory System (built-in, libSQL)

`memory/` holds the store (`MemoryServiceImpl`, singleton via `ipc-handlers/context/memory-service-factory.ts`, main process only — workers can't open `memory.db`). Agents use it through `agent/agent-memory.ts`: before a spec/build/QA worker starts, `buildTaskMemoryContext()` (pinned → verified → relevant, ~1.5k tokens) becomes `SerializableSessionConfig.memoryContext`, which `injectContext()` adds as the `## PROJECT MEMORY` section (CLI and SDK paths). After a successful build/QA, `learnFromCompletedTask()` stores distilled insights as `needsReview` memories (`memory/task-learning.ts`). Gate: app `memoryEnabled`, overridable per project (`memory/memory-enabled.ts`). No memory MCP server.

## E2E Testing (Electron MCP)

QA agents interact with the running app via Chrome DevTools Protocol. Start with `npm run dev:debug`. Tools: `take_screenshot`, `click_by_text`, `fill_input`, `get_page_structure`, `send_keyboard_shortcut`, `eval`.
