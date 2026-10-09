import { useSyncExternalStore } from 'react';

/**
 * Matches Tailwind's `max-md` range. The desktop Electron window has a
 * minWidth of 800px (src/main/index.ts), so this is only ever true in the
 * LAN web UI on a phone-sized viewport.
 */
export const MOBILE_MEDIA_QUERY = '(max-width: 767px)';

function getMediaQueryList(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(MOBILE_MEDIA_QUERY);
}

function subscribe(onChange: () => void): () => void {
  const mql = getMediaQueryList();
  if (!mql) return () => {};
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  return getMediaQueryList()?.matches ?? false;
}

/** True below Tailwind's `md` breakpoint (phone portrait). Use for structural layout changes. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
