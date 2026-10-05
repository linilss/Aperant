import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { PhaseCard } from './PhaseCard';
import { FeatureCard } from './FeatureCard';
import { RoadmapKanbanView } from '../RoadmapKanbanView';
import { getFeaturesByPhase } from '../../stores/roadmap-store';
import { hasCompetitorInsight } from './utils';
import type { RoadmapTabsProps } from './types';
import type { RoadmapFeature, RoadmapPhase } from '../../../shared/types';

export function RoadmapTabs({
  roadmap,
  activeTab,
  onTabChange,
  onFeatureSelect,
  onConvertToSpec,
  onGoToTask,
  onArchive,
  onSave,
}: RoadmapTabsProps) {
  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="h-full flex flex-col">
      <TabsList className="shrink-0 mx-4 mt-4">
        <TabsTrigger value="kanban">Kanban</TabsTrigger>
        <TabsTrigger value="phases">Phases</TabsTrigger>
        <TabsTrigger value="features">All Features</TabsTrigger>
      </TabsList>

      {/* Kanban View */}
      <TabsContent value="kanban" className="flex-1 min-h-0 overflow-hidden">
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
      <TabsContent value="phases" className="flex-1 min-h-0 overflow-auto p-4">
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
      <TabsContent value="features" className="flex-1 min-h-0 overflow-auto p-4">
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
    </Tabs>
  );
}
