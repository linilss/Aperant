import { useCallback, useSyncExternalStore } from 'react';

/**
 * Matches Tailwind's `max-md` range. The desktop Electron window has a
 * minWidth of 800px (src/main/index.ts), so this is only ever true in the
 * LAN web UI on a phone-sized viewport.
 */
export const MOBILE_MEDIA_QUERY = '(max-width: 767px)';

/**
 * Matches Tailwind's `max-lg` range: phones plus narrow desktop windows (800–1023px),
 * where the sidebar collapses to an icon rail and two-pane views show one pane at a time.
 */
export const COMPACT_MEDIA_QUERY = '(max-width: 1023px)';

function getMediaQueryList(query: string): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(query);
}

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = getMediaQueryList(query);
      if (!mql) return () => {};
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query]
  );
  const getSnapshot = useCallback(() => getMediaQueryList(query)?.matches ?? false, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** True below Tailwind's `md` breakpoint (phone portrait). Use for structural layout changes. */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_MEDIA_QUERY);
}

/** True below Tailwind's `lg` breakpoint (phones and narrow desktop windows). */
export function useIsCompact(): boolean {
  return useMediaQuery(COMPACT_MEDIA_QUERY);
}
