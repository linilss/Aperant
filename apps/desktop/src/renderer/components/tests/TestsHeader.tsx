import { useTranslation } from 'react-i18next';
import { FlaskConical, Play, Square, RefreshCw } from 'lucide-react';
import { Button } from '../ui/button';

interface TestsHeaderProps {
  isRunning: boolean;
  isLoading: boolean;
  hasProjects: boolean;
  selectedProjectId: string | null;
  onDiscover: () => void;
  onRunAll: () => void;
  onStop: () => void;
}

export function TestsHeader({
  isRunning,
  isLoading,
  hasProjects,
  selectedProjectId,
  onDiscover,
  onRunAll,
  onStop,
}: TestsHeaderProps) {
  const { t } = useTranslation('tests');

  return (
    <div className="flex items-center justify-between border-b border-border px-6 py-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <FlaskConical className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="font-semibold text-foreground">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">
            {hasProjects
              ? t('results.noResults')
              : t('empty.description')}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onDiscover}
          disabled={isLoading || isRunning}
        >
          {isLoading ? (
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          {t('discoverProjects')}
        </Button>
        {isRunning ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={onStop}
            disabled={!selectedProjectId}
          >
            <Square className="mr-2 h-4 w-4" />
            {t('stop')}
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={onRunAll}
            disabled={!hasProjects || isLoading || !selectedProjectId}
          >
            <Play className="mr-2 h-4 w-4" />
            {t('runAll')}
          </Button>
        )}
      </div>
    </div>
  );
}
