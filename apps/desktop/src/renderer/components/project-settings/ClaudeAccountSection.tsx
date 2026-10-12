import { useEffect } from 'react';
import { AlertCircle, Lightbulb } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../ui/select';
import { useClaudeProfileStore, loadClaudeProfiles } from '../../stores/claude-profile-store';
import {
  pickProjectProfile,
  suggestProfileForProjectPath
} from '../../../shared/utils/project-claude-profile';
import type {
  ClaudeProfile,
  Project,
  ProjectSettings as ProjectSettingsType
} from '../../../shared/types';

/** Select value for "use the app's active profile" (claudeProfileId unset) */
export const APP_DEFAULT_PROFILE_VALUE = '__default__';

interface ClaudeAccountSectionProps {
  project: Project;
  settings: ProjectSettingsType;
  setSettings: React.Dispatch<React.SetStateAction<ProjectSettingsType>>;
}

export function ClaudeAccountSection({ project, settings, setSettings }: ClaudeAccountSectionProps) {
  const { t } = useTranslation(['settings']);
  const profiles = useClaudeProfileStore((state) => state.profiles);
  const activeProfileId = useClaudeProfileStore((state) => state.activeProfileId);
  const hasProfiles = profiles.length > 0;

  // Load once on mount (not on every empty render — the user may have no profiles)
  useEffect(() => {
    if (useClaudeProfileStore.getState().profiles.length === 0) {
      void loadClaudeProfiles();
    }
  }, []);

  const activeProfile = profiles.find((p) => p.id === activeProfileId);
  const pick = pickProjectProfile(settings, profiles, activeProfile);
  const pinnedId = settings.claudeProfileId;
  const pinnedProfile = pinnedId ? profiles.find((p) => p.id === pinnedId) : undefined;
  const suggestion = suggestProfileForProjectPath(project.path, profiles);
  const showSuggestion = !!suggestion && suggestion.id !== pinnedId;

  const setProfile = (profileId: string | undefined) => {
    setSettings({ ...settings, claudeProfileId: profileId });
  };

  const renderUsage = (profile: ClaudeProfile) =>
    profile.usage
      ? t('projectSections.general.claudeAccount.usage', {
          session: Math.round(profile.usage.sessionUsagePercent),
          weekly: Math.round(profile.usage.weeklyUsagePercent)
        })
      : null;

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">
          {t('projectSections.general.claudeAccount.title')}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t('projectSections.general.claudeAccount.description')}
        </p>
      </div>

      {!hasProfiles ? (
        <p className="text-xs text-muted-foreground">
          {t('projectSections.general.claudeAccount.noProfiles')}
        </p>
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="claudeProfile" className="sr-only">
              {t('projectSections.general.claudeAccount.title')}
            </Label>
            <Select
              value={pinnedId ?? APP_DEFAULT_PROFILE_VALUE}
              onValueChange={(value) =>
                setProfile(value === APP_DEFAULT_PROFILE_VALUE ? undefined : value)
              }
            >
              <SelectTrigger id="claudeProfile" className="w-full md:max-w-md">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={APP_DEFAULT_PROFILE_VALUE}>
                  {activeProfile
                    ? t('projectSections.general.claudeAccount.appDefault', { name: activeProfile.name })
                    : t('projectSections.general.claudeAccount.appDefaultNone')}
                </SelectItem>
                {/* Keep a stale pin selectable so the trigger doesn't render blank */}
                {pinnedId && !pinnedProfile && (
                  <SelectItem value={pinnedId}>{pinnedId}</SelectItem>
                )}
                {profiles.map((profile) => {
                  const usage = renderUsage(profile);
                  return (
                    <SelectItem key={profile.id} value={profile.id}>
                      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                        <span className="truncate">{profile.name}</span>
                        {profile.email && (
                          <span className="truncate text-xs text-muted-foreground">{profile.email}</span>
                        )}
                        {usage && <span className="text-xs text-muted-foreground">{usage}</span>}
                        {profile.isAuthenticated === false && (
                          <span className="text-xs text-warning">
                            {t('projectSections.general.claudeAccount.notAuthenticated')}
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {pick.status === 'pinned-missing' && (
            <Warning text={t('projectSections.general.claudeAccount.missing')} />
          )}
          {pick.status === 'pinned-unauthenticated' && pinnedProfile && (
            <Warning
              text={t('projectSections.general.claudeAccount.unauthenticated', { name: pinnedProfile.name })}
            />
          )}

          {pinnedId && (
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="claudeProfileStrict" className="font-normal text-foreground">
                  {t('projectSections.general.claudeAccount.strict')}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t('projectSections.general.claudeAccount.strictDescription')}
                </p>
              </div>
              <Switch
                id="claudeProfileStrict"
                checked={settings.claudeProfileStrict !== false}
                onCheckedChange={(checked) =>
                  setSettings({ ...settings, claudeProfileStrict: checked })
                }
              />
            </div>
          )}

          {showSuggestion && suggestion && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 p-3 max-md:flex-col max-md:items-stretch">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Lightbulb className="h-4 w-4 shrink-0 text-primary" />
                <span className="text-xs text-foreground">
                  {t('projectSections.general.claudeAccount.suggestion', { name: suggestion.name })}
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 max-md:w-full"
                onClick={() => setProfile(suggestion.id)}
              >
                {t('projectSections.general.claudeAccount.suggestionAction', { name: suggestion.name })}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Warning({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 text-xs text-warning">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}
