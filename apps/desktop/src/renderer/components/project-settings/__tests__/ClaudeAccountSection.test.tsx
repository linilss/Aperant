/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import '../../../../shared/i18n';
import { ClaudeAccountSection, APP_DEFAULT_PROFILE_VALUE } from '../ClaudeAccountSection';
import { useClaudeProfileStore } from '../../../stores/claude-profile-store';
import type { ClaudeProfile, Project, ProjectSettings } from '../../../../shared/types';

// Radix Select uses portals that don't work in jsdom — render a flat, testable stand-in
let selectCallback: ((v: string) => void) | null = null;
vi.mock('../../ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: React.ReactNode }) => {
    selectCallback = onValueChange;
    return <div data-testid="select" data-value={value}>{children}</div>;
  },
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <div data-testid={`select-item-${value}`}>{children}</div>
  )
}));

function profile(overrides: Partial<ClaudeProfile>): ClaudeProfile {
  return {
    id: 'p',
    name: 'Profile',
    isDefault: false,
    isAuthenticated: true,
    createdAt: new Date(),
    ...overrides
  };
}

const personal = profile({
  id: 'personal',
  name: 'Personal',
  email: 'linus@example.com',
  isDefault: true,
  usage: {
    sessionUsagePercent: 42,
    sessionResetTime: '',
    weeklyUsagePercent: 10,
    weeklyResetTime: '',
    lastUpdated: new Date()
  }
});
const chippio = profile({ id: 'chippio', name: 'Chippio', email: 'linus@chippio.com' });
const loggedOut = profile({ id: 'old', name: 'Old', isAuthenticated: false });

function project(path: string): Project {
  return {
    id: 'proj',
    name: 'App',
    path,
    autoBuildPath: '',
    settings: baseSettings,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

const baseSettings: ProjectSettings = {
  model: 'opus',
  notifications: { onTaskComplete: true, onTaskFailed: true, onReviewNeeded: true, sound: false }
} as ProjectSettings;

describe('ClaudeAccountSection', () => {
  let setSettings: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    selectCallback = null;
    setSettings = vi.fn();
    useClaudeProfileStore.setState({
      profiles: [personal, chippio, loggedOut],
      activeProfileId: 'personal'
    });
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      getClaudeProfiles: vi.fn().mockResolvedValue({ success: false })
    };
  });

  const renderSection = (settings: ProjectSettings = baseSettings, path = '/Users/linus/dev/other') =>
    render(
      <ClaudeAccountSection
        project={project(path)}
        settings={settings}
        setSettings={setSettings as unknown as React.Dispatch<React.SetStateAction<ProjectSettings>>}
      />
    );

  it('renders the app default option and every profile with email, usage and login state', () => {
    renderSection();

    expect(screen.getByTestId(`select-item-${APP_DEFAULT_PROFILE_VALUE}`)).toHaveTextContent(
      'App default (currently: Personal)'
    );
    expect(screen.getByTestId('select-item-personal')).toHaveTextContent('linus@example.com');
    expect(screen.getByTestId('select-item-personal')).toHaveTextContent('42% session · 10% week');
    expect(screen.getByTestId('select-item-chippio')).toBeInTheDocument();
    expect(screen.getByTestId('select-item-old')).toHaveTextContent('not logged in');
    expect(screen.getByTestId('select')).toHaveAttribute('data-value', APP_DEFAULT_PROFILE_VALUE);
    // Strict toggle only shows once a profile is pinned
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('pins the project to the selected profile and clears it with the default option', () => {
    renderSection();

    selectCallback?.('chippio');
    expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({ claudeProfileId: 'chippio' }));

    selectCallback?.(APP_DEFAULT_PROFILE_VALUE);
    expect(setSettings).toHaveBeenLastCalledWith(expect.objectContaining({ claudeProfileId: undefined }));
  });

  it('turns the strict pin off from the switch', () => {
    renderSection({ ...baseSettings, claudeProfileId: 'chippio' });

    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);

    expect(setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ claudeProfileId: 'chippio', claudeProfileStrict: false })
    );
  });

  it('suggests the matching account for a chippio path and applies it on click', () => {
    renderSection(baseSettings, '/Users/linus/Documents/chippio/app');

    expect(screen.getByText('Use the Chippio account for this project?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use Chippio' }));

    expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({ claudeProfileId: 'chippio' }));
  });

  it('hides the suggestion once the project is pinned to that account', () => {
    renderSection({ ...baseSettings, claudeProfileId: 'chippio' }, '/Users/linus/Documents/chippio/app');

    expect(screen.queryByText('Use the Chippio account for this project?')).not.toBeInTheDocument();
  });

  it('warns when the pinned profile is missing or logged out', () => {
    const { unmount } = renderSection({ ...baseSettings, claudeProfileId: 'gone' });
    expect(screen.getByText(/no longer exists/)).toBeInTheDocument();
    unmount();

    renderSection({ ...baseSettings, claudeProfileId: 'old' });
    expect(screen.getByText(/Old is not logged in/)).toBeInTheDocument();
  });

  it('shows the empty state when there are no profiles', () => {
    useClaudeProfileStore.setState({ profiles: [] });
    renderSection();

    expect(screen.getByText(/No Claude accounts yet/)).toBeInTheDocument();
    expect(window.electronAPI.getClaudeProfiles).toHaveBeenCalled();
  });
});
