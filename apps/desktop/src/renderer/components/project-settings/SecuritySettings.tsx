import { useTranslation } from 'react-i18next';
import {
  Database,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import type { ProjectEnvConfig, ProjectSettings as ProjectSettingsType } from '../../../shared/types';

interface SecuritySettingsProps {
  envConfig: ProjectEnvConfig | null;
  settings: ProjectSettingsType;
  setSettings: React.Dispatch<React.SetStateAction<ProjectSettingsType>>;
  updateEnvConfig: (updates: Partial<ProjectEnvConfig>) => void;

  // Collapsible section
  expanded: boolean;
  onToggle: () => void;
}

/**
 * Project-level memory override. The embedding provider is app-wide
 * (the memory service only reads app settings), so only the on/off
 * override lives here.
 */
export function SecuritySettings({
  envConfig,
  settings: _settings,
  setSettings: _setSettings,
  updateEnvConfig,
  expanded,
  onToggle
}: SecuritySettingsProps) {
  const { t } = useTranslation('settings');

  if (!envConfig) return null;

  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between text-sm font-semibold text-foreground hover:text-foreground/80"
      >
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4" />
          {t('projectSections.memory.title')}
          <span className={`px-2 py-0.5 text-xs rounded-full ${
            envConfig.memoryEnabled
              ? 'bg-success/10 text-success'
              : 'bg-muted text-muted-foreground'
          }`}>
            {envConfig.memoryEnabled
              ? t('projectSections.memory.enabledBadge')
              : t('projectSections.memory.disabledBadge')}
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </button>

      {expanded && (
        <div className="space-y-4 pl-6 pt-2">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="font-normal text-foreground">{t('projectSections.memory.enableLabel')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('projectSections.memory.enableDescription')}
              </p>
            </div>
            <Switch
              checked={envConfig.memoryEnabled}
              onCheckedChange={(checked) => updateEnvConfig({ memoryEnabled: checked })}
            />
          </div>

          {!envConfig.memoryEnabled && (
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">
                {t('projectSections.memory.disabledNote')}
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
