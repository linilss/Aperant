/**
 * Remember the main window's position and size between launches
 * (userData/window-state.json). A saved rect is used only while a display
 * still contains its centre, so unplugging that screen falls back to the default.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { app, type BrowserWindow, type Rectangle, screen } from 'electron';

interface WindowState extends Rectangle {
  maximized?: boolean;
}

const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

/** Pure check, exported for tests: is the rect's centre on one of the displays? */
export function isOnSomeDisplay(rect: Rectangle, displays: Rectangle[]): boolean {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return displays.some((d) => cx >= d.x && cx < d.x + d.width && cy >= d.y && cy < d.y + d.height);
}

/** The saved bounds if they still fit a connected display, else null */
export function loadWindowState(): WindowState | null {
  try {
    const s = JSON.parse(readFileSync(stateFile(), 'utf-8')) as WindowState;
    if (![s.x, s.y, s.width, s.height].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    if (s.width < 200 || s.height < 200) return null;
    return isOnSomeDisplay(s, screen.getAllDisplays().map((d) => d.bounds)) ? s : null;
  } catch {
    return null;
  }
}

/** Save the window's bounds whenever it moves or resizes (debounced) and on close */
export function trackWindowState(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    const state: WindowState = { ...(win.isMaximized() ? win.getNormalBounds() : win.getBounds()), maximized: win.isMaximized() };
    try {
      writeFileSync(stateFile(), JSON.stringify(state));
    } catch {
      // best effort
    }
  };
  const later = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 500);
  };
  win.on('resize', later);
  win.on('move', later);
  win.on('close', save);
}
