# Renderer (React UI)

## Tech Stack

React 19, TypeScript (strict), Zustand 5, Tailwind CSS v4, Radix UI, xterm.js 6, Vite 7, Motion (Framer Motion)

## Path Aliases (tsconfig.json)

| Alias | Maps to |
|-------|---------|
| `@/*` | `src/renderer/*` |
| `@shared/*` | `src/shared/*` |
| `@preload/*` | `src/preload/*` |
| `@features/*` | `src/renderer/features/*` |
| `@components/*` | `src/renderer/shared/components/*` |
| `@hooks/*` | `src/renderer/shared/hooks/*` |
| `@lib/*` | `src/renderer/shared/lib/*` |

## State Management (Zustand)

All state in `stores/`. Key stores:

- `project-store.ts` — Active project, project list
- `task-store.ts` — Tasks/specs management
- `terminal-store.ts` — Terminal sessions, output callbacks, buffer manager
- `settings-store.ts` — User preferences
- `github/issues-store.ts`, `github/pr-review-store.ts` — GitHub integration
- `insights-store.ts`, `roadmap-store.ts`, `kanban-settings-store.ts`

Main process also has stores: `src/main/project-store.ts`, `src/main/terminal-session-store.ts`

## Styling

- **Tailwind CSS v4** with `@tailwindcss/postcss` plugin
- **7 color themes** defined in `src/shared/constants/themes.ts` — each has light/dark variants via CSS custom properties
- Utility: `clsx` + `tailwind-merge` via `cn()` helper
- Component variants: `class-variance-authority` (CVA)

## Component Patterns

- UI primitives in `components/ui/` (Radix-based: Button, Dialog, Badge, Tabs, etc.)
- Task detail: `components/task-detail/` — TaskDetailModal with tabs (Overview, Subtasks, Logs, Files, Refine)
- Terminal: `components/Terminal.tsx` uses `useXterm`, `usePtyProcess`, `useTerminalEvents` hooks
- Kanban: `components/KanbanBoard.tsx` + `TaskCard.tsx` (memoized with custom comparator)

## IPC from Renderer

Call main process via `window.electronAPI.*` (exposed by preload). Preload APIs in `src/preload/api/` — one file per domain (task-api, terminal-api, etc.).
