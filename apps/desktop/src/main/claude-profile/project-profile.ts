/**
 * Per-project Claude account resolution (main process).
 *
 * A project can be pinned to one Claude profile (ProjectSettings.claudeProfileId) so
 * its work bills that subscription. Everything that spawns Claude for a project —
 * agents, CLI runners, the SDK auth queue and Agent Terminals — resolves the profile
 * here instead of reading the app's active profile directly.
 */

import { homedir } from 'node:os';
import path from 'node:path';

import type { ClaudeProfile } from '../../shared/types/agent';
import type { Project } from '../../shared/types/project';
import { pickProjectProfile, type ProjectProfileStatus } from '../../shared/utils/project-claude-profile';
import { getClaudeProfileManager } from '../claude-profile-manager';
import { projectStore } from '../project-store';

/** A project id, a path inside a project (worktrees included), or both. */
export type ProjectRef = string | { projectId?: string; projectPath?: string } | undefined | null;

export interface ProjectProfileResolution {
  /** Profile the project's Claude work runs on */
  profile: ClaudeProfile;
  status: ProjectProfileStatus;
  /** `profile` is the project's pinned profile */
  pinned: boolean;
  /** Pinned and strict: never switch this project to another account */
  strict: boolean;
  project?: Project;
}

/** Profile binding the AI layer needs to run a pinned project's work. */
export interface ProjectProfileBinding {
  profileId: string;
  profileName: string;
  strict: boolean;
  /** Expanded CLAUDE_CONFIG_DIR of the pinned profile */
  configDir?: string;
  /** Env for a `claude` CLI subprocess (CLAUDE_CONFIG_DIR etc.) */
  env: Record<string, string>;
}

function expandHome(dir: string): string {
  return dir.startsWith('~') ? dir.replace(/^~/, homedir()) : dir;
}

function normalize(p: string): string {
  return path.resolve(expandHome(p));
}

/** Find the project a ref points to. Paths match the project root or anything below it. */
export function findProjectForRef(ref: ProjectRef): Project | undefined {
  if (!ref) return undefined;
  const projects = projectStore.getProjects();
  const { projectId, projectPath } = typeof ref === 'string' ? { projectId: ref, projectPath: ref } : ref;

  if (projectId) {
    const byId = projects.find((p) => p.id === projectId);
    if (byId) return byId;
  }
  if (!projectPath) return undefined;

  const target = normalize(projectPath);
  let best: Project | undefined;
  for (const project of projects) {
    if (!project.path) continue;
    const root = normalize(project.path);
    const inside = target === root || target.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
    if (inside && (!best || root.length > normalize(best.path).length)) best = project;
  }
  return best;
}

/**
 * Resolve the Claude profile a project runs on: the pinned profile if set, existing
 * and authenticated (a non-strict pin also yields to a rate limit), else the active one.
 */
export function resolveProfileForProject(ref: ProjectRef): ProjectProfileResolution {
  const manager = getClaudeProfileManager();
  const active = manager.getActiveProfile();
  const project = findProjectForRef(ref);

  const pinnedId = project?.settings?.claudeProfileId;
  const pinnedProfile = pinnedId ? manager.getProfile(pinnedId) : undefined;
  const pick = pickProjectProfile(project?.settings, pinnedProfile ? [pinnedProfile] : [], active, {
    isAuthenticated: (p) => manager.hasValidAuth(p.id),
    isRateLimited: (p) => manager.isProfileRateLimited(p.id).limited,
  });

  return {
    profile: pick.profile ?? active,
    status: pick.status,
    pinned: pick.pinned,
    strict: pick.strict,
    project,
  };
}

/** Pinned profile binding for a project, or null when it uses the app's active profile. */
export function getProjectProfileBinding(ref: ProjectRef): ProjectProfileBinding | null {
  const resolution = resolveProfileForProject(ref);
  if (!resolution.pinned) return null;
  // Strict pin to an account that no longer exists: refuse instead of using another one
  if (resolution.strict && resolution.status === 'pinned-missing') {
    throw new Error(
      'This project is pinned to a Claude account that no longer exists. Choose an account in Project settings → General.'
    );
  }
  const { profile } = resolution;
  return {
    profileId: profile.id,
    profileName: profile.name,
    strict: resolution.strict,
    configDir: profile.configDir ? expandHome(profile.configDir) : undefined,
    env: getClaudeProfileManager().getProfileEnv(profile.id),
  };
}

/**
 * Env for a `claude` CLI subprocess doing a project's work: the pinned profile's env,
 * or the active profile's env when the project isn't pinned (or isn't a project).
 */
export function getProjectProfileEnv(ref: ProjectRef): Record<string, string> {
  return getProjectProfileBinding(ref)?.env ?? getClaudeProfileManager().getActiveProfileEnv();
}

/** The project's strict pin (profile id + name), or null if it may switch accounts. */
export function getStrictProjectPin(ref: ProjectRef): { profileId: string; profileName: string } | null {
  const resolution = resolveProfileForProject(ref);
  return resolution.strict ? { profileId: resolution.profile.id, profileName: resolution.profile.name } : null;
}
