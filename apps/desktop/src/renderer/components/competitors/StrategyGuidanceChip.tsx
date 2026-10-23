import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Compass } from 'lucide-react';
import { getTopDirection, loadCompetitors, useCompetitorStore } from '../../stores/competitor-store';

interface StrategyGuidanceChipProps {
  projectId: string;
  /** Navigate back to the Competitors page */
  onClick?: () => void;
}

function useTopDirection(projectId: string) {
  const storeProjectId = useCompetitorStore((s) => s.projectId);
  const data = useCompetitorStore((s) => s.data);

  useEffect(() => {
    void loadCompetitors(projectId);
  }, [projectId]);

  return storeProjectId === projectId ? getTopDirection(data) : null;
}

/** "Guided by: <top direction>" — shown on Roadmap/Ideation when a ranking is saved */
export function StrategyGuidanceChip({ projectId, onClick }: StrategyGuidanceChipProps) {
  const { t } = useTranslation('common');
  const top = useTopDirection(projectId);
  if (!top) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary hover:bg-primary/20 disabled:cursor-default"
      title={t('competitors.chip.tooltip')}
    >
      <Compass className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{t('competitors.chip.guidedBy', { title: top.title })}</span>
    </button>
  );
}

/** The chip in a slim row above a page header; renders nothing without a saved ranking */
export function StrategyGuidanceBar({ projectId, onClick }: StrategyGuidanceChipProps) {
  const top = useTopDirection(projectId);
  if (!top) return null;
  return (
    <div className="shrink-0 px-4 pt-3 max-md:px-3">
      <StrategyGuidanceChip projectId={projectId} onClick={onClick} />
    </div>
  );
}
