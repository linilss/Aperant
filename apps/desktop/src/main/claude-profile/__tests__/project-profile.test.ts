import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClaudeProfile } from '../../../shared/types/agent';
import type { Project, ProjectSettings } from '../../../shared/types/project';

const state = vi.hoisted(() => ({
  projects: [] as Project[],
  profiles: [] as ClaudeProfile[],
  activeId: 'personal',
  unauthenticated: new Set<string>(),
  rateLimited: new Set<string>(),
}));

vi.mock('../../project-store', () => ({
  projectStore: { getProjects: () => state.projects },
}));

vi.mock('../../claude-profile-manager', () => ({
  getClaudeProfileManager: () => ({
    getActiveProfile: () => state.profiles.find((p) => p.id === state.activeId),
    getProfile: (id: string) => state.profiles.find((p) => p.id === id),
    hasValidAuth: (id: string) => !state.unauthenticated.has(id),
    isProfileRateLimited: (id: string) => ({ limited: state.rateLimited.has(id) }),
    getProfileEnv: (id: string) => ({ CLAUDE_CONFIG_DIR: `/cfg/${id}` }),
    getActiveProfileEnv: () => ({ CLAUDE_CONFIG_DIR: `/cfg/${state.activeId}` }),
  }),
}));

import {
  findProjectForRef,
  getProjectProfileBinding,
  getProjectProfileEnv,
  getStrictProjectPin,
  resolveProfileForProject,
} from '../project-profile';

const CHIPPIO_ROOT = path.resolve('/Users/me/Documents/chippio/app');

function profile(id: string): ClaudeProfile {
  return { id, name: id === 'chippio' ? 'Chippio' : 'Personal', isDefault: id === 'personal', configDir: `/cfg/${id}`, createdAt: new Date() };
}

function project(id: string, projectPath: string, settings: Partial<ProjectSettings> = {}): Project {
  return {
    id,
    name: id,
    path: projectPath,
    autoBuildPath: '.malvy',
    settings: { model: 'sonnet', notifications: { onTaskComplete: true, onTaskFailed: true, onReviewNeeded: true, sound: false }, ...settings },
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Project;
}

describe('resolveProfileForProject', () => {
  beforeEach(() => {
    state.profiles = [profile('personal'), profile('chippio')];
    state.activeId = 'personal';
    state.unauthenticated.clear();
    state.rateLimited.clear();
    state.projects = [
      project('chippio-app', CHIPPIO_ROOT, { claudeProfileId: 'chippio' }),
      project('malve', path.resolve('/Users/me/dev/malve')),
    ];
  });

  it('uses the pinned profile (strict by default)', () => {
    const r = resolveProfileForProject({ projectId: 'chippio-app' });
    expect(r.profile.id).toBe('chippio');
    expect(r).toMatchObject({ pinned: true, strict: true, status: 'pinned' });
  });

  it('finds the project from a path inside it (task worktrees)', () => {
    const worktree = path.join(CHIPPIO_ROOT, '.malvy', 'worktrees', 'tasks', '001-x');
    expect(findProjectForRef({ projectPath: worktree })?.id).toBe('chippio-app');
    expect(resolveProfileForProject({ projectPath: worktree }).profile.id).toBe('chippio');
    // A sibling folder that only shares a prefix is not inside the project
    expect(findProjectForRef({ projectPath: `${CHIPPIO_ROOT}-other` })).toBeUndefined();
  });

  it('falls back to the active profile for an unpinned project or unknown path', () => {
    expect(resolveProfileForProject({ projectId: 'malve' })).toMatchObject({ pinned: false, status: 'default' });
    expect(resolveProfileForProject({ projectPath: '/tmp/elsewhere' }).profile.id).toBe('personal');
    expect(resolveProfileForProject(undefined).profile.id).toBe('personal');
  });

  it('a strict pin to a deleted profile is blocked for work, a non-strict pin falls back', () => {
    state.profiles = [profile('personal')];
    const strict = resolveProfileForProject('chippio-app');
    expect(strict).toMatchObject({ pinned: true, strict: true, status: 'pinned-missing' });
    expect(() => getProjectProfileBinding('chippio-app')).toThrow(/no longer exists/);

    state.projects[0].settings.claudeProfileStrict = false;
    const r = resolveProfileForProject('chippio-app');
    expect(r.profile.id).toBe('personal');
    expect(r).toMatchObject({ pinned: false, status: 'pinned-missing' });
  });

  it('a strict pin stays on a logged-out account, a non-strict pin falls back', () => {
    state.unauthenticated.add('chippio');
    const strict = resolveProfileForProject('chippio-app');
    expect(strict.profile.id).toBe('chippio');
    expect(strict).toMatchObject({ pinned: true, strict: true, status: 'pinned-unauthenticated' });

    state.projects[0].settings.claudeProfileStrict = false;
    const r = resolveProfileForProject('chippio-app');
    expect(r.profile.id).toBe('personal');
    expect(r.status).toBe('pinned-unauthenticated');
  });

  it('a strict pin stays on a rate-limited account; a non-strict pin falls back', () => {
    state.rateLimited.add('chippio');
    expect(resolveProfileForProject('chippio-app')).toMatchObject({ pinned: true, strict: true });

    state.projects[0].settings.claudeProfileStrict = false;
    const r = resolveProfileForProject('chippio-app');
    expect(r.profile.id).toBe('personal');
    expect(r.status).toBe('pinned-rate-limited');
  });

  it('builds CLI env and bindings from the pinned profile only', () => {
    expect(getProjectProfileEnv({ projectPath: CHIPPIO_ROOT })).toEqual({ CLAUDE_CONFIG_DIR: '/cfg/chippio' });
    expect(getProjectProfileEnv({ projectPath: '/Users/me/dev/malve' })).toEqual({ CLAUDE_CONFIG_DIR: '/cfg/personal' });
    expect(getProjectProfileBinding('malve')).toBeNull();
    expect(getProjectProfileBinding('chippio-app')).toMatchObject({ profileId: 'chippio', strict: true, configDir: '/cfg/chippio' });
  });

  it('reports a strict pin only for strict projects', () => {
    expect(getStrictProjectPin('chippio-app')).toEqual({ profileId: 'chippio', profileName: 'Chippio' });
    state.projects[0].settings.claudeProfileStrict = false;
    expect(getStrictProjectPin('chippio-app')).toBeNull();
    expect(getStrictProjectPin('malve')).toBeNull();
  });
});
