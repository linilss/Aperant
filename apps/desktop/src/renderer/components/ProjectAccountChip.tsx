/**
 * ProjectAccountChip - shows the Claude account the selected project is pinned to.
 *
 * Rendered next to AuthStatusIndicator in the top bar (desktop) and MobileNav (phone).
 * Hidden when the selected project uses the app default account.
 */

import { useEffect } from 'react';
import { Lock, Pin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { useProjectStore } from '../stores/project-store';
import { useClaudeProfileStore, loadClaudeProfiles } from '../stores/claude-profile-store';
import { pickProjectProfile } from '../../shared/utils/project-claude-profile';

export function ProjectAccountChip() {
  const { t } = useTranslation(['common', 'settings']);
  const project = useProjectStore((state) =>
    state.projects.find((p) => p.id === state.selectedProjectId)
  );
  const profiles = useClaudeProfileStore((state) => state.profiles);
  const activeProfileId = useClaudeProfileStore((state) => state.activeProfileId);
  const pinnedId = project?.settings?.claudeProfileId;
  const needsProfiles = !!pinnedId && profiles.length === 0;

  useEffect(() => {
    if (needsProfiles) {
      void loadClaudeProfiles();
    }
  }, [needsProfiles]);

  if (!project || !pinnedId) return null;
  const pinnedProfile = profiles.find((p) => p.id === pinnedId);
  if (!pinnedProfile) return null;

  const activeProfile = profiles.find((p) => p.id === activeProfileId);
  const pick = pickProjectProfile(project.settings, profiles, activeProfile);
  const strict = project.settings.claudeProfileStrict !== false;
  const isFallback = pick.status !== 'pinned';
  const sessionPercent = pinnedProfile.usage
    ? Math.round(pinnedProfile.usage.sessionUsagePercent)
    : undefined;
  const Icon = strict ? Lock : Pin;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              'flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-semibold',
              isFallback
                ? 'border-warning/30 bg-warning/10 text-warning'
                : 'border-border bg-muted/50 text-foreground'
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate max-w-[120px] max-md:max-w-[80px]">{pinnedProfile.name}</span>
            {sessionPercent !== undefined && (
              <span className="shrink-0 font-normal text-muted-foreground">{sessionPercent}%</span>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs space-y-1 text-xs">
          <div className="font-medium">{t('common:usage.projectAccount')}</div>
          <div>{t('common:usage.projectAccountTooltip', { name: pinnedProfile.name })}</div>
          {pick.status === 'pinned-unauthenticated' && (
            <div className="text-warning">
              {t('settings:projectSections.general.claudeAccount.unauthenticated', {
                name: pinnedProfile.name
              })}
            </div>
          )}
          <div className="text-muted-foreground">
            {strict ? t('common:usage.projectAccountStrict') : t('common:usage.projectAccountFallback')}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
