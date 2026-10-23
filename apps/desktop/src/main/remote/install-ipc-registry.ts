/**
 * Side-effect module: wraps ipcMain so every invoke handler is recorded for
 * remote access. Imported first in main/index.ts so it runs before any module
 * can register a handler.
 */
import { installIpcRegistry } from './ipc-registry';

installIpcRegistry();
