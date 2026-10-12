import { describe, expect, it } from 'vitest';

import { isProjectPinStrict, pickProjectProfile, suggestProfileForProjectPath } from '../project-claude-profile';

const personal = { id: 'personal', name: 'Personal', email: 'lnsnlssn@gmail.com', isAuthenticated: true };
const chippio = { id: 'chippio', name: 'Work', email: 'linus@chippio.com', isAuthenticated: true };

describe('pickProjectProfile', () => {
  it('returns the active profile when the project is not pinned', () => {
    expect(pickProjectProfile({}, [personal, chippio], personal)).toEqual({
      profile: personal, status: 'default', pinned: false, strict: false,
    });
  });

  it('returns the pinned profile, strict unless turned off', () => {
    expect(pickProjectProfile({ claudeProfileId: 'chippio' }, [personal, chippio], personal)).toMatchObject({
      profile: chippio, pinned: true, strict: true,
    });
    expect(pickProjectProfile({ claudeProfileId: 'chippio', claudeProfileStrict: false }, [personal, chippio], personal).strict).toBe(false);
  });

  it('uses isAuthenticated from the profile when no check is given', () => {
    const loggedOut = { ...chippio, isAuthenticated: false };
    expect(pickProjectProfile({ claudeProfileId: 'chippio' }, [personal, loggedOut], personal).status).toBe('pinned-unauthenticated');
  });

  it('isProjectPinStrict needs a pinned profile', () => {
    expect(isProjectPinStrict({ claudeProfileStrict: true })).toBe(false);
    expect(isProjectPinStrict({ claudeProfileId: 'x' })).toBe(true);
    expect(isProjectPinStrict(undefined)).toBe(false);
  });
});

describe('suggestProfileForProjectPath', () => {
  it('suggests the profile whose email domain matches a folder in the path', () => {
    expect(suggestProfileForProjectPath('/Users/linusnilsson/Documents/chippio/chippio-new/Chippio2', [personal, chippio])).toBe(chippio);
  });

  it('suggests by profile name too', () => {
    const named = { id: 'c', name: 'Chippio subscription' };
    expect(suggestProfileForProjectPath('/Users/me/Documents/chippio/app', [personal, named])).toBe(named);
  });

  it('does not suggest for unrelated paths or from the home folder name', () => {
    expect(suggestProfileForProjectPath('/Users/me/dev/malve/Aperant', [personal, chippio])).toBeUndefined();
    const homeNamed = { id: 'h', name: 'Me', email: 'linusnilsson@example.org' };
    expect(suggestProfileForProjectPath('/Users/linusnilsson/dev/malve', [homeNamed])).toBeUndefined();
  });
});
