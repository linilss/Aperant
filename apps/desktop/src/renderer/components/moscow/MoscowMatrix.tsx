import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { Grid2x2, Map as MapIcon } from 'lucide-react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { FeatureDetailPanel } from '../roadmap/FeatureDetailPanel';
import { useFeatureActions, useFeatureDelete } from '../roadmap/hooks';
import { getCompetitorInsightsForFeature } from '../roadmap/utils';
import { useRoadmapStore, loadRoadmap } from '../../stores/roadmap-store';
import { useToast } from '../../hooks/use-toast';
import { MOSCOW_QUADRANTS, MoscowQuadrant } from './MoscowQuadrant';
import type { RoadmapFeature, RoadmapFeaturePriority } from '../../../shared/types';

interface MoscowMatrixProps {
  projectId: string;
  onGoToRoadmap: () => void;
  onGoToTask?: (specId: string) => void;
}

const QUADRANT_IDS = MOSCOW_QUADRANTS.map((q) => q.id) as string[];

function isQuadrantId(id: string): id is RoadmapFeaturePriority {
  return QUADRANT_IDS.includes(id);
}

export function MoscowMatrix({ projectId, onGoToRoadmap, onGoToTask }: MoscowMatrixProps) {
  const { t } = useTranslation('common');
  const { toast } = useToast();

  const roadmap = useRoadmapStore((state) => state.roadmap);
  const competitorAnalysis = useRoadmapStore((state) => state.competitorAnalysis);
  const updateFeature = useRoadmapStore((state) => state.updateFeature);

  const { convertFeatureToSpec } = useFeatureActions();
  const { deleteFeature } = useFeatureDelete(projectId);

  const [isLoading, setIsLoading] = useState(false);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [activeFeature, setActiveFeature] = useState<RoadmapFeature | null>(null);
  const [overQuadrant, setOverQuadrant] = useState<RoadmapFeaturePriority | null>(null);

  // Load the roadmap only if the store does not already hold this project's roadmap
  useEffect(() => {
    if (useRoadmapStore.getState().currentProjectId === projectId) return;
    let cancelled = false;
    setIsLoading(true);
    loadRoadmap(projectId).finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const projectRoadmap = roadmap && roadmap.projectId === projectId ? roadmap : null;

  const featuresByPriority = useMemo(() => {
    const grouped = { must: [], should: [], could: [], wont: [] } as Record<
      RoadmapFeaturePriority,
      RoadmapFeature[]
    >;
    for (const feature of projectRoadmap?.features ?? []) {
      (grouped[feature.priority] ?? grouped.should).push(feature);
    }
    return grouped;
  }, [projectRoadmap?.features]);

  // Derive from the store so the panel reflects optimistic updates
  const selectedFeature =
    projectRoadmap?.features.find((f) => f.id === selectedFeatureId) ?? null;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const findFeature = (id: string) => projectRoadmap?.features.find((f) => f.id === id);

  const resolveTargetPriority = (overId: string): RoadmapFeaturePriority | null => {
    if (isQuadrantId(overId)) return overId;
    return findFeature(overId)?.priority ?? null;
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveFeature(findFeature(event.active.id as string) ?? null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    setOverQuadrant(event.over ? resolveTargetPriority(event.over.id as string) : null);
  };

  const handleDragCancel = () => {
    setActiveFeature(null);
    setOverQuadrant(null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveFeature(null);
    setOverQuadrant(null);
    if (!over) return;

    const featureId = active.id as string;
    const feature = findFeature(featureId);
    const targetPriority = resolveTargetPriority(over.id as string);
    if (!feature || !targetPriority || feature.priority === targetPriority) return;

    const previousPriority = feature.priority;
    updateFeature(featureId, { priority: targetPriority });

    let error: string | undefined;
    try {
      const result = await window.electronAPI.updateFeaturePriority(projectId, featureId, targetPriority);
      if (!result.success) error = result.error;
      else return;
    } catch (err) {
      error = err instanceof Error ? err.message : undefined;
    }

    // Revert only if nothing else changed the priority in the meantime
    const current = useRoadmapStore.getState().roadmap?.features.find((f) => f.id === featureId);
    if (current?.priority === targetPriority) {
      updateFeature(featureId, { priority: previousPriority });
    }
    toast({
      title: t('roadmap.moscow.updateFailed'),
      description: error || t('errors.unknownError'),
      variant: 'destructive',
    });
  };

  const handleConvertToSpec = async (feature: RoadmapFeature) => {
    // Selection is derived from the store, so the local setter is a no-op
    await convertFeatureToSpec(projectId, feature, selectedFeature, () => undefined);
  };

  const handleGoToTask = (specId: string) => {
    onGoToTask?.(specId);
  };

  const handleDeleteFeature = async (featureId: string) => {
    await deleteFeature(featureId);
    if (selectedFeatureId === featureId) setSelectedFeatureId(null);
  };

  const header = (
    <div className="flex items-center justify-between border-b border-border px-6 py-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Grid2x2 className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="font-semibold text-foreground">{t('roadmap.moscow.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('roadmap.moscow.subtitle')}</p>
        </div>
      </div>
    </div>
  );

  if (!projectRoadmap) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="flex flex-1 items-center justify-center p-6">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t('roadmap.moscow.loading')}</p>
          ) : (
            <Card className="w-full max-w-lg p-8 text-center">
              <Grid2x2 className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
              <h2 className="mb-2 text-xl font-semibold">{t('roadmap.moscow.empty.title')}</h2>
              <p className="mb-6 text-muted-foreground">{t('roadmap.moscow.empty.description')}</p>
              <Button onClick={onGoToRoadmap} size="lg">
                <MapIcon className="mr-2 h-4 w-4" />
                {t('roadmap.moscow.empty.goToRoadmap')}
              </Button>
            </Card>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {header}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-4 p-6">
          {MOSCOW_QUADRANTS.map((quadrant) => (
            <MoscowQuadrant
              key={quadrant.id}
              quadrant={quadrant}
              features={featuresByPriority[quadrant.id]}
              roadmap={projectRoadmap}
              isOver={overQuadrant === quadrant.id}
              onFeatureClick={(feature) => setSelectedFeatureId(feature.id)}
              onConvertToSpec={handleConvertToSpec}
              onGoToTask={handleGoToTask}
            />
          ))}
        </div>

        <DragOverlay>
          {activeFeature ? (
            <div className="drag-overlay-card">
              <Card className="w-80 p-4 shadow-2xl">
                <div className="font-medium">{activeFeature.title}</div>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {activeFeature.description}
                </p>
              </Card>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {selectedFeature && (
        <FeatureDetailPanel
          feature={selectedFeature}
          onClose={() => setSelectedFeatureId(null)}
          onConvertToSpec={handleConvertToSpec}
          onGoToTask={handleGoToTask}
          onDelete={handleDeleteFeature}
          competitorInsights={getCompetitorInsightsForFeature(selectedFeature, competitorAnalysis)}
        />
      )}
    </div>
  );
}
