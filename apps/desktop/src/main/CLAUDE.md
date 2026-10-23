# Main Process

Electron main process modules. All code here runs in Node.js, not the browser.

## Agent Management (`agent/`)

- **`agent-queue.ts`** — Queue routing, prioritization, spec number locking
- **`agent-process.ts`** — Spawns worker threads via `WorkerBridge` for agent execution
- **`agent-state.ts`** — Tracks running agent state and status
- **`agent-events.ts`** — Lifecycle events and state transitions from worker threads

## Terminal System (`terminal/`)

Full PTY-based terminal integration:
- **`pty-daemon.ts`** / **`pty-manager.ts`** — Background PTY process management (detached daemon, Unix socket/named pipe communication)
- **`terminal-lifecycle.ts`** — Session creation, cleanup, event handling
- **`cli-integration-handler.ts`** — Claude CLI invocation, profile switching, rate limit detection, session capture
- **`terminal-manager.ts`** — Facade coordinating lifecycle, events, and persistence
- Max 12 terminals per project. External terminals (refine, OAuth) use `addExternalTerminal()` and don't count toward limit.

## Claude Profile System (`claude-profile/`)

Multi-profile credential management for switching between Claude accounts:
- **`credential-utils.ts`** — OS credential storage (Keychain/Windows Credential Manager)
- **`token-refresh.ts`** — OAuth token lifecycle and automatic refresh
- **`usage-monitor.ts`** — API usage tracking and rate limiting per profile
- **`profile-scorer.ts`** — Scores profiles by usage and availability

## IPC Handlers (`ipc-handlers/`)

40+ handler modules organized by domain. Pattern: `ipcMain.handle()` / `ipcMain.on()` with channels from `shared/constants/ipc.ts`. Renderer calls via `window.electronAPI.*`.

Key domains: `task/` (execution, worktree, plan-file-utils), `terminal-handlers.ts`, `github/`, `gitlab/`, `settings-handlers.ts`, `task-refine-handlers.ts`.

## Cross-Platform (`platform/`)

Never use `process.platform` directly. Import from here:

| Function | Purpose |
|----------|---------|
| `isWindows()` / `isMacOS()` / `isLinux()` | OS detection |
| `getPathDelimiter()` | `;` (Win) or `:` (Unix) |
| `findExecutable(name)` | Cross-platform executable lookup |
| `requiresShell(command)` | `.cmd/.bat` shell detection (Win) |

Use `findExecutable()` and `joinPaths()` instead of hardcoded paths.

## Worktree Paths (`worktree-paths.ts`)

Task worktrees: `.malvy/worktrees/tasks/{specId}/`, branches: `{branchPrefix}{specId}` (ProjectSettings.branchPrefix, default `malvy/`; build names via `shared/utils/task-branch.ts`, look up existing ones via `utils/task-branch-resolver.ts` — legacy `malvy/`/`auto-claude/` still match). Terminal worktrees: `.malvy/worktrees/terminal/{name}/`. Legacy: `.worktrees/`.

## Invisible mode

Never modify tracked files in user projects. Ignore Malvy files via `<git-dir>/info/exclude` (`git-exclude.ts`), never `.gitignore`. No Malvy signatures in anything posted to GitHub/GitLab/Azure (reviews, PR bodies, commit messages).

Docs: team `CLAUDE.md`/`AGENTS.md` are read-only input; Malvy writes only `.malvy/docs/<path>/CLAUDE.md` and `.malvy/pointers.md` (`claude-docs.ts`), and wires them into Claude CLI via `CLAUDE.local.md` imports (`claude-local.ts`).
