import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { MouseAndPenSensor, TOUCH_DRAG_ACTIVATION } from '../../lib/dnd-sensors';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { Compass, Grid2x2, Map as MapIcon } from 'lucide-react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { FeatureDetailPanel } from '../roadmap/FeatureDetailPanel';
import { useFeatureActions, useFeatureDelete } from '../roadmap/hooks';
import { getCompetitorInsightsForFeature } from '../roadmap/utils';
import { useRoadmapStore, loadRoadmap } from '../../stores/roadmap-store';
import { useToast } from '../../hooks/use-toast';
import { MOSCOW_QUADRANTS, MoscowQuadrant } from './MoscowQuadrant';
import { StrategyGuidanceChip } from '../competitors/StrategyGuidanceChip';
import { DirectionTag, useProjectDirections } from '../competitors/DirectionTagChips';
import { loadCompetitors } from '../../stores/competitor-store';
import { cn } from '../../lib/utils';
import {
  UNTAGGED_FILTER,
  filterFeaturesByDirection,
  hasDirectionTagging,
  toggleDirectionFilter,
} from './direction-filter';
import type { RoadmapFeature, RoadmapFeaturePriority } from '../../../shared/types';

interface MoscowMatrixProps {
  projectId: string;
  onGoToRoadmap: () => void;
  onGoToTask?: (specId: string) => void;
  /** Navigate to the Competitors page (strategy chip / empty-state funnel) */
  onGoToCompetitors?: () => void;
}

const QUADRANT_IDS = MOSCOW_QUADRANTS.map((q) => q.id) as string[];

function isQuadrantId(id: string): id is RoadmapFeaturePriority {
  return QUADRANT_IDS.includes(id);
}

export function MoscowMatrix({ projectId, onGoToRoadmap, onGoToTask, onGoToCompetitors }: MoscowMatrixProps) {
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
  /** Selected direction ids / UNTAGGED_FILTER; empty = all directions */
  const [directionFilter, setDirectionFilter] = useState<string[]>([]);

  const directions = useProjectDirections(projectId);

  // Directions feed the tag chips and the filter row
  useEffect(() => {
    void loadCompetitors(projectId);
    setDirectionFilter([]);
  }, [projectId]);

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

  const allFeatures = projectRoadmap?.features;
  const isTagged = useMemo(() => hasDirectionTagging(allFeatures ?? []), [allFeatures]);
  const showDirectionFilter = isTagged && directions.length > 0;

  const featuresByPriority = useMemo(() => {
    const grouped = { must: [], should: [], could: [], wont: [] } as Record<
      RoadmapFeaturePriority,
      RoadmapFeature[]
    >;
    const visible = showDirectionFilter
      ? filterFeaturesByDirection(allFeatures ?? [], directionFilter, directions)
      : (allFeatures ?? []);
    for (const feature of visible) {
      (grouped[feature.priority] ?? grouped.should).push(feature);
    }
    return grouped;
  }, [allFeatures, showDirectionFilter, directionFilter, directions]);

  // Derive from the store so the panel reflects optimistic updates
  const selectedFeature =
    projectRoadmap?.features.find((f) => f.id === selectedFeatureId) ?? null;

  const sensors = useSensors(
    useSensor(MouseAndPenSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: TOUCH_DRAG_ACTIVATION }),
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
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-6 py-4 max-md:px-3 max-md:py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Grid2x2 className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="font-semibold text-foreground">{t('roadmap.moscow.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('roadmap.moscow.subtitle')}</p>
        </div>
      </div>
      <div className="min-w-0 max-md:w-full">
        <StrategyGuidanceChip projectId={projectId} onClick={onGoToCompetitors} />
      </div>
    </div>
  );

  const filterChipClass = (active: boolean) =>
    cn(
      'inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs transition-colors',
      active
        ? 'border-primary bg-primary/10 text-primary'
        : 'border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground'
    );

  const directionBar = showDirectionFilter ? (
    <div
      role="toolbar"
      aria-label={t('roadmap.moscow.directions.filterLabel')}
      className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border px-6 py-2 max-md:px-3"
    >
      <button
        type="button"
        aria-pressed={directionFilter.length === 0}
        onClick={() => setDirectionFilter([])}
        className={filterChipClass(directionFilter.length === 0)}
      >
        {t('roadmap.moscow.directions.all')}
      </button>
      {directions.map((direction, i) => {
        const active = directionFilter.includes(direction.id);
        return (
          <button
            key={direction.id}
            type="button"
            aria-pressed={active}
            onClick={() => setDirectionFilter((prev) => toggleDirectionFilter(prev, direction.id))}
            className={cn('rounded-full', active && 'ring-2 ring-primary ring-offset-1 ring-offset-background')}
          >
            <DirectionTag direction={direction} rank={i + 1} className="py-0.5 text-xs" />
          </button>
        );
      })}
      <button
        type="button"
        aria-pressed={directionFilter.includes(UNTAGGED_FILTER)}
        onClick={() => setDirectionFilter((prev) => toggleDirectionFilter(prev, UNTAGGED_FILTER))}
        className={filterChipClass(directionFilter.includes(UNTAGGED_FILTER))}
      >
        {t('roadmap.moscow.directions.untagged')}
      </button>
    </div>
  ) : directions.length > 0 && !isTagged ? (
    <p className="flex shrink-0 items-center gap-1.5 border-b border-border px-6 py-2 text-xs text-muted-foreground max-md:px-3">
      <Compass className="h-3.5 w-3.5 shrink-0" />
      {t('roadmap.moscow.directions.regenerateHint')}
    </p>
  ) : null;

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
              <p className="mb-3 text-muted-foreground">{t('roadmap.moscow.empty.description')}</p>
              <p className="mb-6 text-sm font-medium text-foreground">{t('roadmap.moscow.empty.funnel')}</p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button onClick={onGoToRoadmap} size="lg">
                  <MapIcon className="mr-2 h-4 w-4" />
                  {t('roadmap.moscow.empty.generateRoadmap')}
                </Button>
                {onGoToCompetitors && (
                  <Button onClick={onGoToCompetitors} size="lg" variant="outline">
                    <Compass className="mr-2 h-4 w-4" />
                    {t('roadmap.moscow.empty.goToCompetitors')}
                  </Button>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {header}
      {directionBar}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-4 p-6 max-md:grid-cols-1 max-md:grid-rows-none max-md:auto-rows-[minmax(16rem,auto)] max-md:gap-3 max-md:overflow-y-auto max-md:p-3">
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
