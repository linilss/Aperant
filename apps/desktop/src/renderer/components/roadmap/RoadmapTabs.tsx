import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { PhaseCard } from './PhaseCard';
import { BacklogList } from './BacklogList';
import { MoscowMatrix } from '../moscow/MoscowMatrix';
import { getFeaturesByPhase } from '../../stores/roadmap-store';
import { PAGE_STICKY } from '../ui/page-header';
import { cn } from '../../lib/utils';
import type { RoadmapTabsProps } from './types';
import type { RoadmapPhase } from '../../../shared/types';

export function RoadmapTabs({
  roadmap,
  projectId,
  onGoToCompetitors,
  activeTab,
  onTabChange,
  onFeatureSelect,
  onConvertToSpec,
  onGoToTask,
  onArchive,
  onSave: _onSave,
  onOpenIdeaSettings,
}: RoadmapTabsProps) {
  const { t } = useTranslation('common');
  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="h-full flex flex-col max-md:h-auto">
      {/* Compact tab row: the only part that stays pinned while a phone scrolls the page */}
      <div className={cn('shrink-0 px-4 pt-4 max-md:border-b max-md:border-border max-md:px-3 max-md:py-2', PAGE_STICKY)}>
        {/* The kanban of features is the Board's Flow tab */}
        <TabsList className="max-md:grid max-md:h-12 max-md:w-full max-md:grid-cols-3 max-md:[&>button]:h-10">
          <TabsTrigger value="features">{t('roadmap.tabs.backlog')}</TabsTrigger>
          <TabsTrigger value="phases">{t('roadmap.tabs.phases')}</TabsTrigger>
          <TabsTrigger value="moscow">{t('roadmap.tabs.moscow')}</TabsTrigger>
        </TabsList>
      </div>

      {/* Phases View */}
      <TabsContent value="phases" className="flex-1 min-h-0 overflow-auto p-4 max-md:mt-0 max-md:flex-none max-md:overflow-visible max-md:p-3">
        <div className="space-y-6">
          {roadmap.phases.map((phase: RoadmapPhase, index: number) => (
            <PhaseCard
              key={phase.id}
              phase={phase}
              features={getFeaturesByPhase(roadmap, phase.id)}
              isFirst={index === 0}
              onFeatureSelect={onFeatureSelect}
              onConvertToSpec={onConvertToSpec}
              onGoToTask={onGoToTask}
              onArchive={onArchive}
            />
          ))}
        </div>
      </TabsContent>

      {/* Backlog: features and ideas in one list; Plan promotes to the Board, Dismiss steers away */}
      <TabsContent value="features" className="flex-1 min-h-0 overflow-auto p-4 max-md:mt-0 max-md:flex-none max-md:overflow-visible max-md:p-3">
        <BacklogList
          roadmap={roadmap}
          projectId={projectId}
          onFeatureSelect={onFeatureSelect}
          onGoToTask={onGoToTask}
          onArchive={onArchive}
          onOpenIdeaSettings={onOpenIdeaSettings}
        />
      </TabsContent>
      {/* MoSCoW: the same features read by priority */}
      <TabsContent value="moscow" className="flex-1 min-h-0 overflow-hidden max-md:mt-0 max-md:flex-none max-md:overflow-visible">
        <MoscowMatrix
          embedded
          projectId={projectId}
          onGoToRoadmap={() => onTabChange('features')}
          onGoToTask={onGoToTask}
          onGoToCompetitors={onGoToCompetitors}
        />
      </TabsContent>
    </Tabs>
  );
}
