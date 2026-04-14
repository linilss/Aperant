import { useTranslation } from 'react-i18next';
import { FlaskConical } from 'lucide-react';
import { Button } from '../ui/button';

interface TestsEmptyStateProps {
  onDiscover: () => void;
  isLoading: boolean;
}

export function TestsEmptyState({ onDiscover, isLoading }: TestsEmptyStateProps) {
  const { t } = useTranslation('tests');

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <FlaskConical className="h-8 w-8 text-muted-foreground" />
      </div>
      <div className="max-w-sm space-y-2">
        <h3 className="text-lg font-semibold text-foreground">{t('empty.title')}</h3>
        <p className="text-sm text-muted-foreground">{t('empty.description')}</p>
        <p className="text-xs text-muted-foreground">{t('empty.hint')}</p>
      </div>
      <Button onClick={onDiscover} disabled={isLoading}>
        {t('discoverProjects')}
      </Button>
    </div>
  );
}
