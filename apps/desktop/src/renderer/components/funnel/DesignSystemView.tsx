import { Palette } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader, PAGE_BODY, PAGE_ROOT } from '../ui/page-header';
import { cn } from '../../lib/utils';
import { DesignTab } from '../context/design/DesignTab';
import { NextStepButton } from './NextStepButton';

interface DesignSystemViewProps {
  projectId: string;
  onGoToCompetitors: () => void;
}

/** Understand → Design: the project's design system (last Understand step before Plan) */
export function DesignSystemView({ projectId, onGoToCompetitors }: DesignSystemViewProps) {
  const { t } = useTranslation('context');

  return (
    <div className={PAGE_ROOT}>
      <PageHeader
        icon={Palette}
        title={t('pages.design.title')}
        subtitle={t('pages.design.subtitle')}
        extra={<NextStepButton label={t('pages.design.next')} onClick={onGoToCompetitors} />}
      />
      <div className={cn(PAGE_BODY, 'overflow-hidden max-md:overflow-visible')}>
        <DesignTab projectId={projectId} />
      </div>
    </div>
  );
}
