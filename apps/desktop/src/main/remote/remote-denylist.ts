/**
 * IPC channels that remote (LAN web) clients may not call.
 *
 * These either act on the desktop machine's screen/OS in a way that makes no
 * sense from a phone (native dialogs, opening apps/folders, screen capture,
 * clipboard), affect the app process itself (install update/quit), or manage
 * remote access itself (a paired device must not be able to re-pair or
 * disable revocation).
 *
 * Keep this the single source of truth; the remote server checks both
 * `invoke` and `send` messages against it.
 */

import { IPC_CHANNELS } from '../../shared/constants/ipc';

export const REMOTE_DENIED_CHANNELS: ReadonlySet<string> = new Set<string>([
  // Native dialogs / pickers (would pop up on the desktop screen)
  IPC_CHANNELS.DIALOG_SELECT_DIRECTORY,

  // Opening things on the desktop OS
  IPC_CHANNELS.SHELL_OPEN_EXTERNAL, // web client opens links locally instead
  IPC_CHANNELS.SHELL_OPEN_TERMINAL,
  IPC_CHANNELS.TASK_WORKTREE_OPEN_IN_IDE,
  IPC_CHANNELS.TASK_WORKTREE_OPEN_IN_TERMINAL,
  IPC_CHANNELS.DEBUG_OPEN_LOGS_FOLDER,
  IPC_CHANNELS.DEBUG_COPY_DEBUG_INFO, // writes the desktop clipboard

  // Installers that open an external terminal window on the desktop
  IPC_CHANNELS.CLAUDE_CODE_INSTALL,
  IPC_CHANNELS.CLAUDE_CODE_INSTALL_VERSION,
  IPC_CHANNELS.GITLAB_INSTALL_CLI,
  IPC_CHANNELS.OLLAMA_INSTALL,

  // Screen capture of the desktop
  IPC_CHANNELS.SCREENSHOT_GET_SOURCES,
  IPC_CHANNELS.SCREENSHOT_CAPTURE,

  // App lifecycle (quit + install update)
  IPC_CHANNELS.APP_UPDATE_INSTALL,

  // Desktop-process-only settings
  IPC_CHANNELS.SPELLCHECK_SET_LANGUAGES,
  IPC_CHANNELS.SENTRY_STATE_CHANGED,

  // Remote access management itself
  IPC_CHANNELS.REMOTE_ACCESS_GET_STATUS,
  IPC_CHANNELS.REMOTE_ACCESS_SET_CONFIG,
  IPC_CHANNELS.REMOTE_ACCESS_ROTATE_TOKEN,
]);

export function isRemoteChannelDenied(channel: string): boolean {
  return REMOTE_DENIED_CHANNELS.has(channel);
}
