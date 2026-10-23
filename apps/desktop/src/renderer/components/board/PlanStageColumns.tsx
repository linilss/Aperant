/**
 * The To do column's planned roadmap features: promoted to Planned but without
 * their task yet (being proofread). Ideas and the roadmap itself are lists
 * (Ideation, Roadmap, MoSCoW); a feature with a task is shown by its task card.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useDraggable } from '@dnd-kit/core';
import { Calendar, Sparkles } from 'lucide-react';

import { useRoadmapStore, loadRoadmap, planFeature } from '../../stores/roadmap-store';
import { useFeatureActions, useFeatureDelete } from '../roadmap/hooks';
import { FeatureDetailPanel } from '../roadmap/FeatureDetailPanel';
import { SortableFeatureCard } from '../SortableFeatureCard';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import type { RoadmapFeature, TaskStatus } from '../../../shared/types';

const FEATURE_PREFIX = 'feature:';

/** Wraps a card so the board's drag-and-drop can move it (ids are prefixed, never task ids) */
function Draggable({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={cn('touch-none pointer-coarse:touch-manipulation pointer-coarse:select-none', isDragging && 'opacity-40')}>
      {children}
    </div>
  );
}

/** A column the board renders before its task columns */
export interface LeadingColumn {
  id: string;
  label: string;
  count: number;
  render: (flat: boolean) => ReactNode;
}

/** Roadmap features waiting for their task, shown inside the To do column */
export interface TodoExtras {
  count: number;
  content: ReactNode;
  action: ReactNode;
}

/**
 * Planned features for the To do column plus the feature dialog they open. `onGoToTask` opens a
 * linked task's detail.
 */
export function usePlanStageColumns(
  projectId: string | undefined,
  options: { onGoToTask: (specId: string) => void }
): {
  columns: LeadingColumn[];
  trailing: LeadingColumn[];
  todo: TodoExtras;
  dialog: ReactNode;
  onDrop: (activeId: string, target: { stage?: string; taskColumn?: TaskStatus }) => void;
  renderOverlay: (activeId: string) => ReactNode;
} {
  const { t } = useTranslation(['common']);
  const roadmap = useRoadmapStore((s) => s.roadmap);
  const refiningIds = useRoadmapStore((s) => s.refiningFeatureIds);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { convertFeatureToSpec } = useFeatureActions();
  const { deleteFeature } = useFeatureDelete(projectId ?? '');

  // Load the roadmap when the project changes (the Roadmap tab does the same)
  useEffect(() => {
    if (projectId && useRoadmapStore.getState().roadmap?.projectId !== projectId) void loadRoadmap(projectId);
  }, [projectId]);

  const projectRoadmap = roadmap && roadmap.projectId === projectId ? roadmap : null;
  const planned = useMemo(
    () => (projectRoadmap?.features ?? []).filter((f) => f.status === 'planned' && !f.linkedSpecId),
    [projectRoadmap]
  );

  const featureCard = (feature: RoadmapFeature) => (
    <Draggable key={feature.id} id={`${FEATURE_PREFIX}${feature.id}`}>
      <SortableFeatureCard
        feature={feature}
        roadmap={projectRoadmap ?? undefined}
        onClick={() => setSelectedId(feature.id)}
        // Shows the Plan button (rerun the proofread if it stopped)
        onConvertToSpec={() => undefined}
        onGoToTask={options.onGoToTask}
        dragDisabled
      />
    </Draggable>
  );

  // A planned feature dropped into the build columns: (re)run the proofread, which creates its task
  const onDrop = (activeId: string, target: { stage?: string; taskColumn?: TaskStatus }) => {
    if (!projectId || !target.taskColumn || !activeId.startsWith(FEATURE_PREFIX)) return;
    void planFeature(projectId, activeId.slice(FEATURE_PREFIX.length));
  };

  const renderOverlay = (activeId: string) => {
    const feature = planned.find((f) => `${FEATURE_PREFIX}${f.id}` === activeId);
    return feature ? <SortableFeatureCard feature={feature} roadmap={projectRoadmap ?? undefined} onClick={() => undefined} dragDisabled /> : null;
  };

  const unplanned = planned.filter((f) => !refiningIds[f.id]).map((f) => f.id);

  // Shown at the top of To do until the proofread creates their tasks
  const todo: TodoExtras = {
    count: planned.length,
    content: planned.length > 0 ? (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" />
          <span>{t('board.columns.planned')} · {planned.length}</span>
          <div className="h-px flex-1 bg-border" />
        </div>
        {planned.map(featureCard)}
      </div>
    ) : null,
    action:
      projectId && unplanned.length > 0 ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => void window.electronAPI.planRoadmapFeatures(projectId, unplanned)}
          title={t('roadmap.planAll.tooltip')}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {t('roadmap.planAll.button', { count: unplanned.length })}
        </Button>
      ) : null,
  };

  const selected = selectedId ? projectRoadmap?.features.find((f) => f.id === selectedId) : undefined;
  const dialog = selected && projectId && (
    <FeatureDetailPanel
      feature={selected}
      onClose={() => setSelectedId(null)}
      onConvertToSpec={(feature) => void convertFeatureToSpec(projectId, feature, selected, () => setSelectedId(null))}
      onGoToTask={(specId) => {
        setSelectedId(null);
        options.onGoToTask(specId);
      }}
      onDelete={(featureId) => {
        setSelectedId(null);
        void deleteFeature(featureId);
      }}
    />
  );

  return { columns: [], trailing: [], todo, dialog, onDrop, renderOverlay };
}
