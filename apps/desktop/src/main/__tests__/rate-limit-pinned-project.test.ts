/**
 * A project pinned (strict) to a Claude account must not be offered or moved to
 * another account when that account hits its limit.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../claude-profile-manager', () => ({
  getClaudeProfileManager: () => ({
    getActiveProfile: () => ({ id: 'personal', name: 'Personal', isDefault: true }),
    getProfile: (id: string) => ({ id, name: id === 'chippio' ? 'Chippio' : 'Personal', isDefault: id !== 'chippio' }),
  }),
}));

vi.mock('../claude-profile/project-profile', () => ({
  getStrictProjectPin: (ref: { projectId?: string }) =>
    ref.projectId === 'chippio-app' ? { profileId: 'chippio', profileName: 'Chippio' } : null,
}));

import { createSDKRateLimitInfo } from '../rate-limit-detector';

const detection = {
  isRateLimited: true,
  profileId: 'chippio',
  resetTime: '6pm',
  suggestedProfile: { id: 'personal', name: 'Personal' },
};

describe('createSDKRateLimitInfo — pinned project', () => {
  it('drops the switch suggestion and flags the pin for a strict project', () => {
    const info = createSDKRateLimitInfo('roadmap', detection, { projectId: 'chippio-app' });
    expect(info.pinnedToProject).toBe(true);
    expect(info.suggestedProfile).toBeUndefined();
    expect(info.profileName).toBe('Chippio');
  });

  it('keeps the suggestion for an unpinned project', () => {
    const info = createSDKRateLimitInfo('roadmap', detection, { projectId: 'malve' });
    expect(info.pinnedToProject).toBeUndefined();
    expect(info.suggestedProfile).toEqual({ id: 'personal', name: 'Personal' });
  });
});
