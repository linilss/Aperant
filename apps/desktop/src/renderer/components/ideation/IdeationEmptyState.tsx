import { useTranslation } from 'react-i18next';
import { Lightbulb, Settings2, AlertCircle, Sparkles } from 'lucide-react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Switch } from '../ui/switch';
import {
  IDEATION_TYPE_LABELS
} from '../../../shared/constants';
import type { IdeationType, IdeationConfig } from '../../../shared/types';
import { TypeIcon } from './TypeIcon';
import { ALL_IDEATION_TYPES } from './constants';
import { IdeationFocusInput } from './IdeationFocusInput';

interface IdeationEmptyStateProps {
  config: IdeationConfig;
  hasToken: boolean | null;
  isCheckingToken: boolean;
  onGenerate: () => void;
  onOpenConfig: () => void;
  onToggleIdeationType: (type: IdeationType) => void;
  onFocusChange: (focus: string) => void;
}

export function IdeationEmptyState({
  config,
  hasToken,
  isCheckingToken,
  onGenerate,
  onOpenConfig,
  onToggleIdeationType,
  onFocusChange
}: IdeationEmptyStateProps) {
  const { t } = useTranslation('common');
  return (
    // Scrolls instead of centering past the edges when the card is taller than the view (phones)
    <div className="h-full overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4 max-md:px-3">
        <Card className="w-full max-w-lg p-8 text-center max-md:p-5">
          <Lightbulb className="h-12 w-12 text-muted-foreground mx-auto mb-4 max-md:h-10 max-md:w-10 max-md:mb-3" />
          <h2 className="text-xl font-semibold mb-2">{t('ideation.empty.title')}</h2>
          <p className="text-muted-foreground mb-6 max-md:mb-4 max-md:text-sm">
            {t('ideation.empty.description')}
          </p>

          {/* Configuration Preview */}
          <div className="mb-6 p-4 bg-muted/50 rounded-lg text-left max-md:mb-4 max-md:p-3">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium">{t('ideation.empty.enabledTypes')}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={onOpenConfig}
                aria-label={t('ideation.empty.openConfig')}
              >
                <Settings2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-2">
              {ALL_IDEATION_TYPES.map((type) => (
                <div
                  key={type}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <TypeIcon type={type} />
                    <span className="text-sm">{IDEATION_TYPE_LABELS[type]}</span>
                  </div>
                  <Switch
                    checked={config.enabledTypes.includes(type)}
                    onCheckedChange={() => onToggleIdeationType(type)}
                    aria-label={IDEATION_TYPE_LABELS[type]}
                  />
                </div>
              ))}
            </div>
            <div className="mt-4 border-t border-border pt-4">
              <IdeationFocusInput value={config.focus ?? ''} onChange={onFocusChange} />
            </div>
          </div>

          <Button onClick={onGenerate} size="lg" disabled={isCheckingToken}>
            <Sparkles className="h-4 w-4 mr-2" />
            {t('ideation.empty.generate')}
          </Button>

          {/* Show warning if no provider is configured */}
          {hasToken === false && !isCheckingToken && (
            <p className="mt-3 text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4 inline-block mr-1 text-warning" />
              {t('ideation.empty.noProvider')}
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
