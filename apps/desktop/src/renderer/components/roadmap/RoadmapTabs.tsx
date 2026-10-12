import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { PhaseCard } from './PhaseCard';
import { FeatureCard } from './FeatureCard';
import { RoadmapKanbanView } from '../RoadmapKanbanView';
import { MoscowMatrix } from '../moscow/MoscowMatrix';
import { getFeaturesByPhase } from '../../stores/roadmap-store';
import { hasCompetitorInsight } from './utils';
import { PAGE_STICKY } from '../ui/page-header';
import { cn } from '../../lib/utils';
import type { RoadmapTabsProps } from './types';
import type { RoadmapFeature, RoadmapPhase } from '../../../shared/types';

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
  onSave,
}: RoadmapTabsProps) {
  const { t } = useTranslation('common');
  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="h-full flex flex-col max-md:h-auto">
      {/* Compact tab row: the only part that stays pinned while a phone scrolls the page */}
      <div className={cn('shrink-0 px-4 pt-4 max-md:border-b max-md:border-border max-md:px-3 max-md:py-2', PAGE_STICKY)}>
        <TabsList className="max-md:grid max-md:h-12 max-md:w-full max-md:grid-cols-4 max-md:[&>button]:h-10">
          <TabsTrigger value="kanban">{t('roadmap.tabs.kanban')}</TabsTrigger>
          <TabsTrigger value="phases">{t('roadmap.tabs.phases')}</TabsTrigger>
          <TabsTrigger value="features">{t('roadmap.tabs.allFeatures')}</TabsTrigger>
          <TabsTrigger value="moscow">{t('roadmap.tabs.moscow')}</TabsTrigger>
        </TabsList>
      </div>

      {/* Kanban View */}
      <TabsContent value="kanban" className="flex-1 min-h-0 overflow-hidden max-md:mt-0 max-md:flex-none max-md:overflow-visible">
        <RoadmapKanbanView
          key={roadmap.updatedAt?.toString()}
          roadmap={roadmap}
          onFeatureClick={onFeatureSelect}
          onConvertToSpec={onConvertToSpec}
          onGoToTask={onGoToTask}
          onArchive={onArchive}
          onSave={onSave}
        />
      </TabsContent>

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

      {/* All Features View */}
      <TabsContent value="features" className="flex-1 min-h-0 overflow-auto p-4 max-md:mt-0 max-md:flex-none max-md:overflow-visible max-md:p-3">
        <div className="grid gap-3">
          {roadmap.features.map((feature: RoadmapFeature) => (
            <FeatureCard
              key={feature.id}
              feature={feature}
              onClick={() => onFeatureSelect(feature)}
              onConvertToSpec={onConvertToSpec}
              onGoToTask={onGoToTask}
              onArchive={onArchive}
              hasCompetitorInsight={hasCompetitorInsight(feature)}
            />
          ))}
        </div>
      </TabsContent>
      {/* MoSCoW: the same features read by priority */}
      <TabsContent value="moscow" className="flex-1 min-h-0 overflow-hidden max-md:mt-0 max-md:flex-none max-md:overflow-visible">
        <MoscowMatrix
          embedded
          projectId={projectId}
          onGoToRoadmap={() => onTabChange('kanban')}
          onGoToTask={onGoToTask}
          onGoToCompetitors={onGoToCompetitors}
        />
      </TabsContent>
    </Tabs>
  );
}
