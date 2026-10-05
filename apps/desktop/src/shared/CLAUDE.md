# Shared Module

Types, constants, i18n, and utilities shared between main process and renderer.

## i18n Guidelines

All frontend UI text uses `react-i18next`. Translation files: `i18n/locales/{en,fr}/*.json`

**Namespaces:** `common`, `navigation`, `settings`, `dialogs`, `tasks`, `errors`, `onboarding`, `welcome`

```tsx
import { useTranslation } from 'react-i18next';
const { t } = useTranslation(['navigation', 'common']);

<span>{t('navigation:items.githubPRs')}</span>     // CORRECT
<span>GitHub PRs</span>                             // WRONG

// With interpolation:
<span>{t('errors:task.parseError', { error })}</span>
```

When adding new UI text: add keys to ALL language files, use `namespace:section.key` format.

## Key Type Files (`types/`)

- `task.ts` — Task, Subtask, TaskMetadata, TaskStatus, WorktreeStatus, ImplementationPlan
- `settings.ts` — ThinkingLevel, ModelShorthand
- `terminal.ts` — TerminalSession, TerminalCreateOptions, TerminalWorktreeConfig

## Constants (`constants/`)

- `ipc.ts` — All IPC channel names (IPC_CHANNELS object)
- `themes.ts` — 7 color themes with light/dark variants
- `config.ts` — AUTO_BUILD_PATHS (specs dir, plan file, etc.)

## Utilities (`utils/`)

- `ansi-sanitizer.ts` — Strip ANSI escape codes
- `shell-escape.ts` — Safe shell argument escaping
- `provider-detection.ts` — Detect AI provider from model ID
- `debug-logger.ts` — Conditional debug/error logging
