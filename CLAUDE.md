# CLAUDE.md

Malvy (formerly Auto Claude) is an autonomous multi-agent coding framework — a TypeScript Electron desktop app with a self-contained AI agent layer (Vercel AI SDK v6). Users describe a goal and AI agents handle planning, implementation, and QA in isolated git worktrees.

> **Deep-dive:** [src/main/CLAUDE.md](apps/desktop/src/main/CLAUDE.md) | [src/main/ai/CLAUDE.md](apps/desktop/src/main/ai/CLAUDE.md) | **Frontend:** [apps/desktop/CONTRIBUTING.md](apps/desktop/CONTRIBUTING.md)

## Critical Rules

**Vercel AI SDK only** — All AI interactions use `ai` package via `apps/desktop/src/main/ai/`. NEVER use `@anthropic-ai/sdk` directly. Use `createProvider()` and `streamText()`/`generateText()`.

**i18n required** — All frontend text uses `react-i18next`. Hardcoded strings break localization. Add keys to `en/*.json` only — English is the only locale; don't add other languages.

**Platform abstraction** — Never use `process.platform` directly. Import from `apps/desktop/src/main/platform/`.

**PR target** — Always target `develop`, not `main`. Main is for releases.

**No console.log** — Invisible in bundled Electron. Use Sentry for production errors.

**No time estimates** — Provide priority-based ordering instead.

## Work Approach: Orchestrator-First

You are an orchestrator. Break work into streams, delegate to agent teams, verify and integrate.

1. **Investigate** — Read code before hypothesizing. Glob/Grep for simple lookups, Explore agent for broad research.
2. **Plan** — Identify changes, files, and parallelizable work. Create task lists for multi-step tasks.
3. **Delegate** — Each agent gets: specific goal, file paths, patterns to follow, acceptance criteria.
4. **Verify** — Review outputs, run tests, fix integration issues.

**Delegate:** multi-file changes, cross-codebase research, parallel workstreams. **Do directly:** single-file edits, quick lookups, tasks where you already have context.

**Minimal changes only** — Simplest approach first. If the user asks for X, implement X.

**Default to action** — Implement rather than suggest. Read code to fill gaps rather than asking.

## Context Management

Context auto-compacts — don't stop tasks early. Use git commits and task lists to persist state. Make parallel tool calls when reading multiple files or running independent commands.

## Known Gotchas

**Electron path resolution** — Check `app.isPackaged` and `process.resourcesPath` differences between dev and production builds.

**Resetting PR Review State** — In the project's `.malvy/github/`: `rm pr/logs_*.json pr/review_*.json`.

## Project Structure

```
apps/
└── desktop/                 # Electron desktop application (sole app)
    ├── prompts/             # Agent system prompts (.md)
    └── src/
        ├── main/            # Electron main process — see src/main/CLAUDE.md
        │   ├── ai/          # AI agent layer — see src/main/ai/CLAUDE.md
        │   ├── agent/       # Agent queue, process, state, events
        │   ├── terminal/    # PTY daemon, lifecycle, Claude integration
        │   ├── claude-profile/ # Multi-profile credentials, token refresh
        │   ├── ipc-handlers/# 40+ handler modules by domain
        │   └── platform/    # Cross-platform abstraction
        ├── preload/         # Electron preload (electronAPI bridge)
        ├── renderer/        # React UI — see src/renderer/CLAUDE.md
        │   ├── components/  # UI components
        │   ├── stores/      # 24+ Zustand stores
        │   └── hooks/       # Custom hooks
        ├── shared/          # Shared types, i18n, constants — see src/shared/CLAUDE.md
        └── types/           # TypeScript type definitions
guides/                      # Documentation
scripts/                     # Build and utility scripts
```

## Commands

```bash
npm run install:all          # Install all dependencies
npm start                    # Production build + run
npm run dev                  # Development with HMR
npm run dev:debug            # Debug mode (verbose + Electron MCP)
```

| Task | Command | Tool |
|------|---------|------|
| Unit tests | `cd apps/desktop && npm test` | Vitest |
| E2E tests | `cd apps/desktop && npm run test:e2e` | Playwright |
| Type check | `cd apps/desktop && npm run typecheck` | tsc (strict) |
| Lint | `cd apps/desktop && npm run lint` | Biome |
| Release | `node scripts/bump-version.js patch\|minor\|major` | — |

## Code Quality

- **Linting:** Biome (`npm run lint` / `npm run lint:fix`)
- **Type checking:** `npm run typecheck` (strict mode)
- **Pre-commit:** Husky + lint-staged runs Biome on staged files
- **Testing:** Vitest + React Testing Library + jsdom
