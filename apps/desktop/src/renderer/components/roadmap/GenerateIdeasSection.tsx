/**
 * "Generate ideas with AI" inside Add Feature: the Ideation type toggles and
 * focus, then a run that adds ideas to the Backlog (existing ideas stay).
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Loader2, Sparkles } from 'lucide-react';

import { appendIdeation, loadIdeation, useIdeationStore } from '../../stores/ideation-store';
import { useIsOverviewProject } from '../../stores/project-store';
import { IDEATION_TYPE_COLORS, IDEATION_TYPE_LABELS } from '../../../shared/constants';
import { ALL_IDEATION_TYPES } from '../ideation/constants';
import { IdeationFocusInput } from '../ideation/IdeationFocusInput';
import { TypeIcon } from '../ideation/TypeIcon';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import type { IdeationType } from '../../../shared/types';

export function GenerateIdeasSection({ projectId, onStarted }: { projectId: string; onStarted?: () => void }) {
  const { t } = useTranslation('dialogs');
  const [open, setOpen] = useState(false);
  const config = useIdeationStore((s) => s.config);
  const isGenerating = useIdeationStore((s) => s.isGenerating);
  const setConfig = useIdeationStore((s) => s.setConfig);
  // Overview projects generate Features only (main enforces it too)
  const overviewOnly = useIsOverviewProject(projectId);
  const types: IdeationType[] = overviewOnly ? ['features'] : ALL_IDEATION_TYPES;

  useEffect(() => {
    if (open && useIdeationStore.getState().currentProjectId !== projectId) void loadIdeation(projectId);
  }, [open, projectId]);

  const enabled = config.enabledTypes.filter((type) => types.includes(type));
  const toggle = (type: IdeationType) =>
    setConfig({
      enabledTypes: config.enabledTypes.includes(type)
        ? config.enabledTypes.filter((x) => x !== type)
        : [...config.enabledTypes, type],
    });

  const generate = () => {
    if (enabled.length === 0) return;
    appendIdeation(projectId, enabled);
    onStarted?.();
  };

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <Sparkles className="h-4 w-4 text-primary" />
        {t('addFeature.generate.title')}
      </button>
      {open && (
        <div className="space-y-3 border-t border-border p-3">
          <IdeationFocusInput value={config.focus ?? ''} onChange={(focus) => setConfig({ focus })} />
          <div className="flex flex-wrap gap-1.5">
            {types.map((type) => {
              const on = config.enabledTypes.includes(type);
              return (
                <button
                  key={type}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(type)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
                    on ? IDEATION_TYPE_COLORS[type] : 'border-border text-muted-foreground hover:text-foreground'
                  )}
                >
                  <TypeIcon type={type} />
                  {IDEATION_TYPE_LABELS[type]}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{t('addFeature.generate.hint')}</p>
            <Button size="sm" onClick={generate} disabled={enabled.length === 0 || isGenerating}>
              {isGenerating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
              {isGenerating ? t('addFeature.generate.running') : t('addFeature.generate.button', { count: enabled.length })}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
