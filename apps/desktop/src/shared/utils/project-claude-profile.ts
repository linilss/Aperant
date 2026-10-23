/**
 * Per-project Claude account (profile) selection.
 *
 * Pure logic shared by the main process (which spawns Claude for a project) and the
 * renderer (which shows the project's account). ProjectSettings.claudeProfileId pins
 * a project to one Claude profile; absent means "use the app's active profile".
 */

import type { ProjectSettings } from '../types/project';

export interface ProfileLike {
  id: string;
  name: string;
  email?: string;
  isAuthenticated?: boolean;
}

export type ProjectProfileStatus =
  /** Project is not pinned — the app's active profile is used */
  | 'default'
  /** Project is pinned and the pinned profile is used */
  | 'pinned'
  /** Pinned profile no longer exists — falls back to the active profile */
  | 'pinned-missing'
  /** Pinned profile is not logged in — falls back to the active profile */
  | 'pinned-unauthenticated'
  /** Pinned profile is rate limited and the pin is not strict — falls back */
  | 'pinned-rate-limited';

export interface ProjectProfilePick<P extends ProfileLike> {
  /** Profile the project's Claude work runs on (undefined only when no profiles exist) */
  profile: P | undefined;
  status: ProjectProfileStatus;
  /** True when `profile` is the project's pinned profile */
  pinned: boolean;
  /** True when pinned and the pin is strict (never switch away on rate limit) */
  strict: boolean;
}

type PinSettings = Pick<ProjectSettings, 'claudeProfileId' | 'claudeProfileStrict'> | undefined;

/** Strict defaults to true whenever a profile is pinned. */
export function isProjectPinStrict(settings: PinSettings): boolean {
  return !!settings?.claudeProfileId && settings.claudeProfileStrict !== false;
}

/**
 * Pick the profile a project runs on: the pinned one if it exists and is
 * authenticated (and, for a non-strict pin, not rate limited), else `active`.
 */
export function pickProjectProfile<P extends ProfileLike>(
  settings: PinSettings,
  profiles: readonly P[],
  active: P | undefined,
  checks: {
    isAuthenticated?: (profile: P) => boolean;
    isRateLimited?: (profile: P) => boolean;
  } = {},
): ProjectProfilePick<P> {
  const fallback = (status: ProjectProfileStatus): ProjectProfilePick<P> => ({
    profile: active,
    status,
    pinned: false,
    strict: false,
  });

  const pinnedId = settings?.claudeProfileId;
  if (!pinnedId) return fallback('default');

  const strict = isProjectPinStrict(settings);
  const pinned = profiles.find((p) => p.id === pinnedId);
  // A strict pin never falls back to another account: missing/logged-out means "blocked",
  // so work fails with a clear message instead of billing another subscription.
  if (!pinned) {
    return strict
      ? { profile: undefined, status: 'pinned-missing', pinned: true, strict: true }
      : fallback('pinned-missing');
  }

  const isAuthenticated = checks.isAuthenticated ?? ((p: P) => p.isAuthenticated !== false);
  if (!isAuthenticated(pinned)) {
    return strict
      ? { profile: pinned, status: 'pinned-unauthenticated', pinned: true, strict: true }
      : fallback('pinned-unauthenticated');
  }

  if (!strict && checks.isRateLimited?.(pinned)) return fallback('pinned-rate-limited');

  return { profile: pinned, status: 'pinned', pinned: true, strict };
}

/** Words too generic to tie an account to a project folder. */
const GENERIC_TOKENS = new Set([
  'claude', 'account', 'default', 'personal', 'private', 'work', 'main', 'profile',
  'gmail', 'googlemail', 'outlook', 'hotmail', 'icloud', 'yahoo', 'proton', 'protonmail',
  'users', 'documents', 'home', 'desktop', 'projects', 'project', 'code', 'mail',
]);

function profileTokens(profile: ProfileLike): string[] {
  const parts = [profile.name, ...(profile.email ? profile.email.split('@') : [])];
  return parts
    .flatMap((part) => part.toLowerCase().split(/[^a-z0-9]+/))
    .filter((token) => token.length >= 4 && !GENERIC_TOKENS.has(token));
}

/**
 * Suggest a profile for a project from its path: a profile whose name or email
 * contains a word that is also a folder in the project path, e.g. a "Chippio"
 * account for /Users/me/Documents/chippio/app. Only suggests when exactly one
 * profile matches. Never applied automatically.
 */
export function suggestProfileForProjectPath<P extends ProfileLike>(
  projectPath: string,
  profiles: readonly P[],
): P | undefined {
  let parts = projectPath.toLowerCase().split(/[\\/]+/).filter(Boolean);
  // Skip the home folder (/Users/<name>, /home/<name>, C:\Users\<name>) so a profile
  // whose email matches the OS user name doesn't match every project
  const homeIndex = parts.findIndex((part, index) => index < 2 && (part === 'users' || part === 'home'));
  if (homeIndex !== -1) parts = parts.slice(homeIndex + 2);
  const segments = new Set(parts);
  const matches = profiles.filter((profile) => profileTokens(profile).some((token) => segments.has(token)));
  return matches.length === 1 ? matches[0] : undefined;
}
