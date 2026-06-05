# Plan: Multi-Phase Refine Pipeline ("Mega-Groom")

> Source PRD: conversation-based PRD with 10 grilling decisions resolved

## Architectural decisions

- **Execution backend**: Claude CLI subprocess (`claude --print --verbose --output-format stream-json`), not Vercel AI SDK (timeout concerns)
- **UI surface**: xterm.js terminal embedded in a new "Refine" tab within TaskDetailModal (not a side panel)
- **Input method**: User types directly in the terminal during interactive phases
- **Orchestration**: `RefineOrchestrator` class in main process drives the phase state machine, spawns sequential CLI invocations
- **Context flow**: File-based accumulation — each phase writes structured output to the spec directory; orchestrator injects prior outputs into next phase's prompt. Total injected context budget: 30K chars max. When cumulative context exceeds this, earlier phase outputs are summarized to ~2K each while the most recent 2 phases retain full fidelity.
- **Phase completion detection**: Orchestrator reads the CLI's `--output-format stream-json` JSON events (not raw PTY byte stream) to detect structured output blocks. This avoids false matches from ANSI escape sequences or user/codebase content that happens to contain XML-like tags.
- **Persistence**: `refine_session.json` in `.malvy/specs/{specId}/` stores phase progress, mode, and phase outputs for resume
- **Plan output**: `implementation_plan.json` (existing Malvy format) — build pipeline auto-skips planner when this exists from refine
- **PRD output**: `spec.md` (existing format) — build pipeline auto-skips spec creation when this exists from refine
- **Proofread**: 3 sequential CLI invocations with different perspective prompts, consensus auto-fix (≥2/3 agree)
- **Auto-mode grill**: AI grills itself (asks and answers its own design questions)
- **Terminal identity**: Uses `addExternalTerminal()` (not subject to 12-terminal limit), scoped to task ID

---

## Phase 1: Terminal-in-Tab Foundation

**User stories**: As a user, I want a terminal embedded in the task modal showing the AI's work, so I can see file reads, tool calls, and reasoning in real time

### What to build

Add a "Refine" tab to TaskDetailModal alongside the existing Overview/Subtasks/Logs/Files tabs. When the user clicks the Refine or Auto-refine button, switch to this tab and spawn a dedicated PTY terminal inside it. The terminal runs in the project directory and is linked to the task via `associatedTaskId`. Wire up the existing `Terminal` component with `useXterm`, `usePtyProcess`, and `useTerminalEvents` hooks. The Refine/Auto-refine buttons move from the overview section to the Refine tab header (or remain in overview but switch to the Refine tab on click). On tab switch away and back, the terminal persists (PTY stays alive, xterm replays buffer).

**Key files to create/modify:**

- `apps/desktop/src/renderer/components/task-detail/RefineTerminalTab.tsx` — New component wrapping the `Terminal` component for the refine context. Manages terminal lifecycle (create on first open, destroy on task close). Uses `addExternalTerminal()` to register the terminal in the store without counting toward the 12-terminal limit.
- `apps/desktop/src/renderer/components/task-detail/TaskDetailModal.tsx` — Add "Refine" TabsTrigger and TabsContent. Wire Refine/Auto-refine buttons to switch to this tab and trigger terminal creation.
- `apps/desktop/src/main/ipc-handlers/task-refine-handlers.ts` — Add new IPC handler `TASK_REFINE_TERMINAL_START` that creates a PTY terminal scoped to the task's project directory and invokes Claude CLI with the "understand" phase prompt.
- `apps/desktop/src/shared/constants/ipc.ts` — Add `TASK_REFINE_TERMINAL_START` and `TASK_REFINE_PHASE_CHANGE` channel constants.
- `apps/desktop/src/preload/api/task-api.ts` — Expose `taskRefineTerminalStart(taskId, autoMode)` to renderer.

### Acceptance criteria

- [ ] TaskDetailModal shows a "Refine" tab for tasks in backlog or in_progress status
- [ ] Clicking "Refine" or "Auto-refine" switches to the Refine tab and spawns an xterm.js terminal
- [ ] The terminal runs in the task's project directory with a working PTY
- [ ] Claude CLI is invoked in the terminal with the understand phase prompt and Read/Glob/Grep tools
- [ ] Terminal output streams in real time (text, tool calls visible)
- [ ] Switching tabs preserves terminal state (PTY alive, buffer replayed)
- [ ] Closing the task detail modal keeps the PTY alive; reopening shows the terminal with scrollback
- [ ] Terminal uses the active Claude profile's credentials

---

## Phase 2: Phase Orchestration Pipeline

**User stories**: As a user, I want to see which phase I'm in and what's coming next; I want auto-mode to run autonomously; I want interactive mode to pause for my input; I want to skip phases I don't need

### What to build

Build a `RefineOrchestrator` class in the main process that manages a 5-phase pipeline: Understand → PRD → Grill → Plan → Proofread. (Subtask creation is a programmatic step within the Plan phase — see Phase 4.) The orchestrator drives the terminal by injecting phase-specific prompts into sequential Claude CLI invocations. Each phase has its own system prompt file. Between phases, the orchestrator extracts structured output from the CLI's stream-json events (not raw PTY parsing) and writes it to the spec directory. The next phase's prompt includes accumulated context from prior phases (total budget: 30K chars; earlier outputs summarized when the budget is exceeded).

Add a phase indicator bar above the terminal in the Refine tab showing: phase name, phase number (e.g., "3/6 — Grill"), and status of each phase (pending/active/completed/skipped). Add a "Skip" button to advance past the current phase.

Auto-mode: all phases run without pausing. The Grill phase uses a self-grilling prompt where the AI asks and answers its own design questions.

Interactive mode: the Understand and Grill phases wait for user input in the terminal. Other phases run autonomously. The orchestrator detects phase completion by reading the CLI's stream-json output events for the structured output blocks (e.g., `<prd>`, `<plan_json>`), not by parsing raw PTY bytes.

**Key files to create/modify:**

- `apps/desktop/src/main/ai/orchestration/refine-orchestrator.ts` — New file. Phase state machine, context accumulation, phase transition logic. Manages sequential CLI invocations via the existing `runFeatureRefine()` pattern (or a new `runRefinePhase()` helper). Emits `TASK_REFINE_PHASE_CHANGE` IPC events on transitions.
- `apps/desktop/prompts/refine/refine_understand.md` — Explore codebase, ask clarifying questions (interactive) or work autonomously (auto). Output: `<understanding>` block with key findings.
- `apps/desktop/prompts/refine/refine_prd.md` — Write structured PRD from understanding context. Output: `<prd>` block.
- `apps/desktop/prompts/refine/refine_grill.md` — Stress-test design decisions one at a time. Interactive: ask user. Auto: self-grill. Output: `<grill_decisions>` block.
- `apps/desktop/prompts/refine/refine_grill_auto.md` — Auto-mode variant where AI identifies and resolves its own design questions.
- `apps/desktop/prompts/refine/refine_plan.md` — Convert PRD + grill decisions to phased implementation plan in Malvy JSON format. Output: `<plan_json>` block.
- `apps/desktop/src/renderer/components/task-detail/RefinePhaseBar.tsx` — New component. Horizontal phase indicator showing all 5 phases with status icons. Skip button.
- `apps/desktop/src/renderer/components/task-detail/RefineTerminalTab.tsx` — Integrate RefinePhaseBar above terminal. Listen for `TASK_REFINE_PHASE_CHANGE` events to update phase state.
- `apps/desktop/src/renderer/stores/task-refine-store.ts` — Replace chat-message state with phase-aware state: `currentPhase`, `phases[]` with status, `mode` (auto/interactive).
- `apps/desktop/src/main/ipc-handlers/task-refine-handlers.ts` — Wire up RefineOrchestrator. Handle phase skip requests. Route `TASK_REFINE_TERMINAL_START` to orchestrator.
- `apps/desktop/src/shared/constants/ipc.ts` — Add `TASK_REFINE_SKIP_PHASE` channel.
- `apps/desktop/src/preload/api/task-api.ts` — Expose `taskRefineSkipPhase(taskId)` and `onTaskRefinePhaseChange(callback)`.

### Acceptance criteria

- [ ] Refine flow runs through all 5 phases sequentially in auto-mode without user intervention
- [ ] Interactive mode pauses at Understand and Grill phases, waiting for user terminal input
- [ ] Phase indicator bar shows current phase, completed phases, and upcoming phases
- [ ] Skip button advances to the next phase (current phase marked as skipped)
- [ ] Each phase's structured output is extracted and written to the spec directory
- [ ] Context from prior phases is injected into subsequent phase prompts (visible in terminal as system context)
- [ ] Auto-mode Grill phase shows AI asking and answering its own design questions
- [ ] Terminal buffer is preserved between phases (no clear/reset). A separator banner (e.g., `=== Phase 3: Grill ===`) is printed at each transition. Phase bar updates synchronously with the first output line of the new phase.

---

## Phase 3: Session Persistence & Resume

**User stories**: As a user, I want to close the refine modal and reopen it later without losing progress

### What to build

Persist the refine pipeline state to `.malvy/specs/{specId}/refine_session.json` at both phase START (marking in_progress) and phase COMPLETION (marking completed with output). The file stores: current phase, completed phases with their outputs, mode (auto/interactive), and a timestamp. This dual-write ensures crash recovery — if the app crashes mid-phase, the session file shows the phase as in_progress, and on resume the orchestrator re-runs it from scratch. When the user reopens the Refine tab for a task, the orchestrator reads `refine_session.json` and resumes from the last completed phase boundary.

On resume: the terminal shows a summary of completed phases (phase name + "completed" badge), then starts the next incomplete phase. Any phase that was in-flight when the user closed is re-run from scratch (partial CLI output is not resumable).

The existing `RefineTaskPanel` side panel is deprecated in this phase — remove it and migrate all entry points to the Refine tab.

**Key files to create/modify:**

- `apps/desktop/src/main/ai/orchestration/refine-orchestrator.ts` — Add `saveSession()` (called after each phase completion) and `loadSession()` (called on orchestrator init). `saveSession()` writes `refine_session.json` atomically via `writeFileAtomicSync()`. `loadSession()` reads it and sets the orchestrator's phase state.
- `apps/desktop/src/shared/types/task.ts` — Add `RefineSession` type: `{ currentPhase, completedPhases[], phaseOutputs: Record<string, string>, mode, updatedAt }`.
- `apps/desktop/src/renderer/components/task-detail/RefineTerminalTab.tsx` — On mount, check for existing session. If found, show resume UI (summary of completed phases) before starting terminal. Add "Restart from scratch" button that deletes `refine_session.json` and starts fresh.
- `apps/desktop/src/main/ipc-handlers/task-refine-handlers.ts` — Add `TASK_REFINE_GET_SESSION` handler that reads `refine_session.json` and returns session state to renderer. Add `TASK_REFINE_RESET_SESSION` handler.
- `apps/desktop/src/preload/api/task-api.ts` — Expose `taskRefineGetSession(taskId)` and `taskRefineResetSession(taskId)`.
- `apps/desktop/src/shared/constants/ipc.ts` — Add `TASK_REFINE_GET_SESSION` and `TASK_REFINE_RESET_SESSION` channels.
- `apps/desktop/src/renderer/components/task-detail/RefineTaskPanel.tsx` — Delete this file (deprecated side panel).
- `apps/desktop/src/renderer/stores/task-refine-store.ts` — Remove chat-message-based state that supported the old side panel. Keep phase-aware state only.

### Acceptance criteria

- [ ] `refine_session.json` is written at phase start (status: in_progress) and phase completion (status: completed with output)
- [ ] If the app crashes or is force-quit during a phase, that phase is not marked complete, and on resume it restarts from the beginning of that phase
- [ ] Closing the modal and reopening resumes at the correct phase (not from scratch)
- [ ] Resume shows a summary of completed phases before continuing
- [ ] In-flight phase at close time is re-run from the beginning on resume
- [ ] "Restart from scratch" button deletes session and starts phase 1
- [ ] Old RefineTaskPanel side panel is removed — no regressions in task detail modal
- [ ] Session file uses atomic writes to prevent corruption on crash

---

## Phase 4: Plan Output & Build Integration

**User stories**: As a user, I want the final plan to automatically create subtasks on my kanban task; I want "Start Task" to skip the planner when a refine plan exists

### What to build

The Plan phase (phase 4 of the pipeline) writes its output as a valid `implementation_plan.json` in Malvy format to `.malvy/specs/{specId}/`. The PRD phase (phase 2) writes its output to `spec.md` in the same directory. Both use the existing `plan-file-utils.ts` infrastructure for thread-safe writes. After writing `implementation_plan.json`, the orchestrator invalidates the task cache so the renderer picks up the new subtasks — this is the "Create Subtasks" step (programmatic, not an AI phase).

The build pipeline already handles the skip logic: `BuildOrchestrator.isFirstRun()` returns false when a valid `implementation_plan.json` exists, skipping the planner. Similarly, `execution-handlers.ts` already skips `startSpecCreation()` when `spec.md` exists. No new flags are needed — the refine pipeline just needs to write these files in the correct format and location.

**Key files to create/modify:**

- `apps/desktop/src/main/ai/orchestration/refine-orchestrator.ts` — After Plan phase extracts `<plan_json>`, validate against `ImplementationPlanSchema` (Zod), write to `implementation_plan.json` via `withPlanLock()`. After PRD phase extracts `<prd>`, write to `spec.md`. Invalidate task cache after writes so subtasks appear on the kanban.
- `apps/desktop/prompts/refine/refine_plan.md` — Ensure the plan prompt instructs the AI to output the exact Malvy `implementation_plan.json` schema (phases, subtasks with id/title/description/status/verification, workflow_type, final_acceptance). Include the schema in the prompt.

### Acceptance criteria

- [ ] Plan phase writes valid `implementation_plan.json` that passes Zod schema validation
- [ ] PRD phase writes `spec.md` with structured PRD content
- [ ] Subtasks appear in the Subtasks tab immediately after Plan phase completes
- [ ] "Start Task" on a task with refine outputs skips spec creation and planner — goes straight to coder (existing `isFirstRun()` and `hasSpec` detection, no new flags)
- [ ] Tasks without refine outputs still follow the normal spec → plan → code flow (no regressions)
- [ ] Plan file uses thread-safe writes via `withPlanLock()`

---

## Phase 5: Proofread with Consensus

**User stories**: As a user, I want the plan proofread by multiple perspectives, so risks and gaps are caught early

### What to build

After the Plan phase writes `implementation_plan.json`, the Proofread phase (phase 5) runs three sequential Claude CLI invocations, each with a different perspective prompt:

1. **Risks & Security** — looks for data loss, auth gaps, race conditions, missing error handling, unclear acceptance criteria
2. **Feasibility & Dependencies** — checks slice feasibility, dependency ordering, missing stories, testability, correct phase boundaries
3. **Clarity & Scope** — catches ambiguous wording, missing acceptance criteria, inconsistencies between PRD and plan, scope creep

Each perspective reads the plan + PRD + grill decisions and outputs findings as structured XML: `<findings>` containing `<finding phase="N" category="..." issue="..." fix="..." />` elements.

The orchestrator collects all findings, groups by (phase + root concern), and applies the consensus rule: findings flagged by ≥2 perspectives are auto-fixed by running a synthesis CLI invocation that rewrites the affected plan sections. Findings from only 1 perspective are skipped.

The terminal shows all three reviews streaming, then a summary of what was auto-fixed.

**Key files to create/modify:**

- `apps/desktop/prompts/refine/refine_proofread_risks.md` — Risks & security perspective prompt. Reads plan + PRD, outputs `<findings>` XML.
- `apps/desktop/prompts/refine/refine_proofread_feasibility.md` — Feasibility & dependencies perspective prompt.
- `apps/desktop/prompts/refine/refine_proofread_clarity.md` — Clarity & scope perspective prompt.
- `apps/desktop/prompts/refine/refine_synthesize.md` — Takes consensus findings and the current plan, outputs an updated `<plan_json>` block with fixes applied.
- `apps/desktop/src/main/ai/orchestration/refine-orchestrator.ts` — Add `runProofreadPhase()` method: runs 3 sequential CLI invocations, parses `<findings>` XML from each, groups findings by concern, filters by consensus (≥2/3), runs synthesis pass if fixes needed, writes updated `implementation_plan.json`.
- `apps/desktop/src/renderer/components/task-detail/RefinePhaseBar.tsx` — Show proofread sub-progress (review 1/3, 2/3, 3/3) during the proofread phase.

### Acceptance criteria

- [ ] Three perspective reviews run sequentially in the terminal, each clearly labeled
- [ ] Findings are extracted and grouped by phase + root concern
- [ ] Findings flagged by ≥2 perspectives are auto-fixed via synthesis pass
- [ ] Findings from only 1 perspective are silently skipped
- [ ] Updated plan is written back to `implementation_plan.json` after synthesis
- [ ] Terminal shows a summary: N findings reviewed, X auto-fixed, Y skipped
- [ ] Subtasks tab reflects any changes from the proofread fixes
- [ ] If no findings reach consensus, proofread completes without a synthesis pass
