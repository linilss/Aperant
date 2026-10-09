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
    <div className="flex items-center justify-between border-b border-border px-6 py-4 max-md:flex-wrap max-md:gap-3 max-md:px-4 max-md:py-3">
      <div className="flex items-center gap-3 max-md:min-w-0 max-md:flex-1 max-md:basis-full">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <FlaskConical className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0">
          <h2 className="font-semibold text-foreground">{t('title')}</h2>
          <p className="text-sm text-muted-foreground max-md:text-xs">
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
          className="max-md:h-10"
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
            className="max-md:h-10"
            onClick={onStop}
            disabled={!selectedProjectId}
          >
            <Square className="mr-2 h-4 w-4" />
            {t('stop')}
          </Button>
        ) : (
          <Button
            size="sm"
            className="max-md:h-10"
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
