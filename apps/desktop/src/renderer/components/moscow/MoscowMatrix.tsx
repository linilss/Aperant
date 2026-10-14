import { useEffect, useMemo, useRef, useState, type TouchEvent } from 'react';
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
import { useIsMobile } from '../../hooks/useIsMobile';
import { cn } from '../../lib/utils';
import { MOSCOW_QUADRANTS, MoscowQuadrant, MoscowQuadrantList } from './MoscowQuadrant';
import { StrategyGuidanceChip } from '../competitors/StrategyGuidanceChip';
import { useProjectDirections } from '../competitors/DirectionTagChips';
import { DirectionFilterBar } from '../competitors/DirectionFilterBar';
import { loadCompetitors } from '../../stores/competitor-store';
import { filterFeaturesByDirection, hasDirectionTagging } from './direction-filter';
import type { RoadmapFeature, RoadmapFeaturePriority } from '../../../shared/types';

interface MoscowMatrixProps {
  projectId: string;
  onGoToRoadmap: () => void;
  onGoToTask?: (specId: string) => void;
  /** Navigate to the Competitors page (strategy chip / empty-state funnel) */
  onGoToCompetitors?: () => void;
  /** Rendered as a Roadmap tab: no own header, scrolls with the Roadmap page on phones */
  embedded?: boolean;
}

const QUADRANT_IDS = MOSCOW_QUADRANTS.map((q) => q.id) as string[];

function isQuadrantId(id: string): id is RoadmapFeaturePriority {
  return QUADRANT_IDS.includes(id);
}

/** Horizontal swipe distance (px) that switches the phone tab */
const SWIPE_THRESHOLD = 60;

const tabStorageKey = (projectId: string) => `moscow-mobile-tab:${projectId}`;

function readStoredTab(projectId: string): RoadmapFeaturePriority {
  try {
    const stored = localStorage.getItem(tabStorageKey(projectId));
    if (stored && isQuadrantId(stored)) return stored;
  } catch {
    // Storage unavailable (private mode etc.) — fall back to the first tab
  }
  return 'must';
}

function storeTab(projectId: string, tab: RoadmapFeaturePriority) {
  try {
    localStorage.setItem(tabStorageKey(projectId), tab);
  } catch {
    // Best effort only
  }
}

export function MoscowMatrix({ projectId, onGoToRoadmap, onGoToTask, onGoToCompetitors, embedded = false }: MoscowMatrixProps) {
  const { t } = useTranslation('common');
  const { toast } = useToast();
  const isMobile = useIsMobile();

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

  /** Phone layout: which quadrant's list is shown */
  const [mobileTab, setMobileTab] = useState<RoadmapFeaturePriority>(() => readStoredTab(projectId));
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  const directions = useProjectDirections(projectId);

  useEffect(() => {
    setMobileTab(readStoredTab(projectId));
  }, [projectId]);

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
      if (feature.status === 'dismissed') continue;
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

    const feature = findFeature(active.id as string);
    const targetPriority = resolveTargetPriority(over.id as string);
    if (!feature || !targetPriority) return;
    await moveFeature(feature, targetPriority);
  };

  /** Optimistic priority change, reverted (with a toast) if the IPC call fails */
  const moveFeature = async (feature: RoadmapFeature, targetPriority: RoadmapFeaturePriority) => {
    if (feature.priority === targetPriority) return;
    const featureId = feature.id;
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

  const selectMobileTab = (tab: RoadmapFeaturePriority) => {
    if (tab === mobileTab) return;
    setMobileTab(tab);
    storeTab(projectId, tab);
    // Show the new list from its top (just below the sticky tabs) if scrolled past it
    const scroller = scrollRef.current;
    const headerHeight = headerRef.current?.offsetHeight ?? 0;
    if (!embedded && scroller && scroller.scrollTop > headerHeight) scroller.scrollTop = headerHeight;
  };

  const handleSwipeStart = (e: TouchEvent) => {
    const touch = e.touches[0];
    swipeStart.current = e.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY } : null;
  };

  const handleSwipeEnd = (e: TouchEvent) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    const touch = e.changedTouches[0];
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    // Mostly-horizontal gestures only, so vertical scrolling never switches tabs
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const index = QUADRANT_IDS.indexOf(mobileTab) + (dx < 0 ? 1 : -1);
    const next = MOSCOW_QUADRANTS[index];
    if (next) selectMobileTab(next.id);
  };

  const header = embedded ? null : (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-6 py-4 max-md:px-3 max-md:py-2.5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 max-md:hidden">
          <Grid2x2 className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="font-semibold text-foreground">{t('roadmap.moscow.title')}</h2>
          <p className="text-sm text-muted-foreground max-md:hidden">{t('roadmap.moscow.subtitle')}</p>
        </div>
      </div>
      <div className="min-w-0 max-md:w-full">
        <StrategyGuidanceChip projectId={projectId} onClick={onGoToCompetitors} />
      </div>
    </div>
  );

  const directionBar = (
    <DirectionFilterBar
      directions={directions}
      selected={directionFilter}
      onChange={setDirectionFilter}
      isTagged={isTagged}
      untaggedHint={t('roadmap.moscow.directions.regenerateHint')}
      ariaLabel={t('roadmap.moscow.directions.filterLabel')}
      className="border-b border-border px-6 py-2 max-md:px-3"
    />
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

  const detailPanel = selectedFeature && (
    <FeatureDetailPanel
      feature={selectedFeature}
      onClose={() => setSelectedFeatureId(null)}
      onConvertToSpec={handleConvertToSpec}
      onGoToTask={handleGoToTask}
      onDelete={handleDeleteFeature}
      competitorInsights={getCompetitorInsightsForFeature(selectedFeature, competitorAnalysis)}
    />
  );

  if (isMobile) {
    const activeQuadrant = MOSCOW_QUADRANTS.find((q) => q.id === mobileTab) ?? MOSCOW_QUADRANTS[0];
    return (
      <div ref={scrollRef} className={embedded ? undefined : 'h-full overflow-y-auto overscroll-contain'}>
        <div ref={headerRef}>{header}</div>
        <div className={cn('border-b border-border bg-background', !embedded && 'sticky top-0 z-10')}>
          {directionBar}
          <div
            role="tablist"
            aria-label={t('roadmap.moscow.quadrantTabsLabel')}
            className="mx-3 my-2 grid grid-cols-4 gap-0.5 rounded-lg bg-secondary/60 p-0.5"
          >
            {MOSCOW_QUADRANTS.map((quadrant) => {
              const selected = quadrant.id === mobileTab;
              return (
                <button
                  key={quadrant.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  title={t(`roadmap.moscow.quadrants.${quadrant.id}.title`)}
                  onClick={() => selectMobileTab(quadrant.id)}
                  className={cn(
                    'flex min-w-0 items-center justify-center gap-1.5 rounded-md px-1 py-1.5 text-xs font-medium transition-colors',
                    selected ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
                  )}
                >
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', quadrant.dotClass)} />
                  <span className="truncate">{t(`roadmap.moscow.quadrants.${quadrant.id}.short`)}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {featuresByPriority[quadrant.id].length}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div
          className="min-h-[60vh] p-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]"
          onTouchStart={handleSwipeStart}
          onTouchEnd={handleSwipeEnd}
          onTouchCancel={() => {
            swipeStart.current = null;
          }}
        >
          <MoscowQuadrantList
            quadrant={activeQuadrant}
            features={featuresByPriority[activeQuadrant.id]}
            roadmap={projectRoadmap}
            onFeatureClick={(feature) => setSelectedFeatureId(feature.id)}
            onMoveFeature={(feature, priority) => void moveFeature(feature, priority)}
          />
        </div>
        {detailPanel}
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

      {detailPanel}
    </div>
  );
}
