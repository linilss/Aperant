import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { PhaseCard } from './PhaseCard';
import { FeatureCard } from './FeatureCard';
import { MoscowMatrix } from '../moscow/MoscowMatrix';
import { getFeaturesByPhase } from '../../stores/roadmap-store';
import { hasCompetitorInsight } from './utils';
import { PAGE_STICKY } from '../ui/page-header';
import { cn } from '../../lib/utils';
import type { RoadmapTabsProps } from './types';
import type { RoadmapFeature, RoadmapPhase } from '../../../shared/types';

const LIST_FILTERS = ['open', 'building', 'done', 'dismissed'] as const;
type ListFilter = (typeof LIST_FILTERS)[number];

/** Open: no task yet (to promote or dismiss); building: has a task; done; dismissed */
function matchesListFilter(feature: RoadmapFeature, filter: ListFilter): boolean {
  if (filter === 'dismissed') return feature.status === 'dismissed';
  if (filter === 'done') return feature.status === 'done';
  if (filter === 'building') return !!feature.linkedSpecId && feature.status !== 'done' && feature.status !== 'dismissed';
  return !feature.linkedSpecId && feature.status !== 'done' && feature.status !== 'dismissed';
}

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
}: RoadmapTabsProps) {
  const { t } = useTranslation('common');
  const [listFilter, setListFilter] = useState<ListFilter>('open');
  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="h-full flex flex-col max-md:h-auto">
      {/* Compact tab row: the only part that stays pinned while a phone scrolls the page */}
      <div className={cn('shrink-0 px-4 pt-4 max-md:border-b max-md:border-border max-md:px-3 max-md:py-2', PAGE_STICKY)}>
        {/* The kanban of features is the Board's Flow tab */}
        <TabsList className="max-md:grid max-md:h-12 max-md:w-full max-md:grid-cols-3 max-md:[&>button]:h-10">
          <TabsTrigger value="features">{t('roadmap.tabs.list')}</TabsTrigger>
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

      {/* The roadmap as a list: promote (Plan) to the Board, or dismiss */}
      <TabsContent value="features" className="flex-1 min-h-0 overflow-auto p-4 max-md:mt-0 max-md:flex-none max-md:overflow-visible max-md:p-3">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {LIST_FILTERS.map((filter) => (
            <Button
              key={filter}
              size="sm"
              variant={listFilter === filter ? 'secondary' : 'ghost'}
              className="h-7 px-2.5 text-xs"
              onClick={() => setListFilter(filter)}
            >
              {t(`roadmap.listFilter.${filter}`)}
              <span className="ml-1.5 tabular-nums text-muted-foreground">
                {roadmap.features.filter((f) => matchesListFilter(f, filter)).length}
              </span>
            </Button>
          ))}
        </div>
        <div className="grid gap-3">
          {roadmap.features.filter((f) => matchesListFilter(f, listFilter)).map((feature: RoadmapFeature) => (
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
          onGoToRoadmap={() => onTabChange('features')}
          onGoToTask={onGoToTask}
          onGoToCompetitors={onGoToCompetitors}
        />
      </TabsContent>
    </Tabs>
  );
}
