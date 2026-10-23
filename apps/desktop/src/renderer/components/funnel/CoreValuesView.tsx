import { Gem } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader, PAGE_BODY, PAGE_ROOT } from '../ui/page-header';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '../../lib/utils';
import { CoreValuesCard } from '../context/index/CoreValuesCard';
import { NextStepButton } from './NextStepButton';

interface CoreValuesViewProps {
  projectId: string;
  onGoToContext: () => void;
}

/** Understand → Core values: the first funnel step, edited full width */
export function CoreValuesView({ projectId, onGoToContext }: CoreValuesViewProps) {
  const { t } = useTranslation('context');
  const next = <NextStepButton label={t('pages.coreValues.next')} onClick={onGoToContext} />;

  return (
    <div className={PAGE_ROOT}>
      <PageHeader
        icon={Gem}
        title={t('pages.coreValues.title')}
        subtitle={t('pages.coreValues.subtitle')}
        extra={<span className="max-md:hidden">{next}</span>}
      />
      <ScrollArea className={cn(PAGE_BODY, 'max-md:h-auto')}>
        <div className="mx-auto max-w-4xl space-y-4 p-6 max-md:p-3">
          <CoreValuesCard projectId={projectId} large />
          <div className="flex justify-end">{next}</div>
        </div>
      </ScrollArea>
    </div>
  );
}
