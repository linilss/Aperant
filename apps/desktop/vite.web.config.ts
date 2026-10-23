/**
 * Web build of the renderer for LAN remote access (phone browser).
 *
 * Reuses the renderer section of electron.vite.config.ts (aliases, defines,
 * plugins) and aliases `electron` to a WebSocket-backed shim so the preload
 * API in src/preload/api can be reused as-is. Output: out/web, served by
 * src/main/remote/remote-server.ts.
 *
 *   npm run build:web   # one-off build
 *   npm run dev:web     # rebuild on change (reload the phone to pick it up)
 */

import { resolve } from 'node:path';
import { defineConfig, type PluginOption, type UserConfig } from 'vite';
import electronViteConfig from './electron.vite.config';

const renderer = (electronViteConfig as { renderer?: UserConfig }).renderer ?? {};
const rendererAliases = (renderer.resolve?.alias ?? {}) as Record<string, string>;

export default defineConfig({
  root: resolve(__dirname, 'src/renderer/web'),
  base: '/',
  define: renderer.define,
  plugins: renderer.plugins as PluginOption[],
  resolve: {
    alias: {
      ...rendererAliases,
      electron: resolve(__dirname, 'src/renderer/web/electron-shim.ts'),
    },
  },
  build: {
    outDir: resolve(__dirname, 'out/web'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/renderer/web/index.html'),
    },
  },
});
