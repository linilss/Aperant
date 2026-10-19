/**
 * The Board's incoming column: roadmap features promoted to Planned that don't
 * have their task yet (being proofread). Ideas and the roadmap itself are lists
 * (Ideation, Roadmap, MoSCoW); a feature with a task is shown by its task card.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { ChevronLeft, ChevronRight, Calendar, Sparkles } from 'lucide-react';

import { useRoadmapStore, loadRoadmap, planFeature } from '../../stores/roadmap-store';
import { useFeatureActions, useFeatureDelete } from '../roadmap/hooks';
import { FeatureDetailPanel } from '../roadmap/FeatureDetailPanel';
import { SortableFeatureCard } from '../SortableFeatureCard';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
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

const COLLAPSE_KEY = 'malvy.board.collapsedPlanColumns';

function readCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

function writeCollapsed(value: Record<string, boolean>): void {
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify(value));
  } catch {
    // per-viewer convenience only
  }
}

interface StageColumnProps {
  id: string;
  label: string;
  count: number;
  icon: ReactNode;
  borderClass: string;
  flat: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  action?: ReactNode;
  empty: string;
  children: ReactNode;
}

function StageColumn({ id, label, count, icon, borderClass, flat, collapsed, onToggleCollapsed, action, empty, children }: StageColumnProps) {
  const { t } = useTranslation(['tasks']);
  const { setNodeRef, isOver } = useDroppable({ id: `stage:${id}` });
  if (collapsed && !flat) {
    return (
      <button
        ref={setNodeRef}
        key={id}
        type="button"
        onClick={onToggleCollapsed}
        className={cn(
          'flex w-12 shrink-0 flex-col items-center gap-3 rounded-xl border border-white/5 border-t-2 bg-secondary/20 py-4 text-muted-foreground hover:text-foreground',
          borderClass,
          isOver && 'drop-zone-highlight'
        )}
        aria-label={t('kanban.expandColumn')}
      >
        <ChevronRight className="h-4 w-4" />
        <span className="text-xs tabular-nums">{count}</span>
        <span className="text-sm font-semibold [writing-mode:vertical-rl]">{label}</span>
      </button>
    );
  }
  return (
    <div key={id} className={flat ? 'flex w-full' : 'flex w-80 shrink-0'}>
      <div
        ref={setNodeRef}
        className={cn(
          'flex min-w-0 flex-1 flex-col rounded-xl border border-white/5 border-t-2 bg-linear-to-b from-secondary/30 to-transparent',
          borderClass,
          isOver && 'drop-zone-highlight'
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-white/5 p-4 max-md:px-3 max-md:py-2">
          <div className="flex min-w-0 items-center gap-2.5">
            {!flat && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={onToggleCollapsed}
                aria-label={t('kanban.collapseColumn')}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
            )}
            <span className="text-muted-foreground">{icon}</span>
            <h2 className="truncate text-sm font-semibold text-foreground">{label}</h2>
            <span className="column-count-badge">{count}</span>
          </div>
          {action}
        </div>
        <ScrollArea className={flat ? 'h-auto' : 'min-h-0 flex-1'}>
          <div className="space-y-3 p-3">
            {count === 0 ? <p className="py-6 text-center text-sm text-muted-foreground/70">{empty}</p> : children}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

/**
 * The Planned column plus the feature dialog it opens. `onGoToTask` opens a
 * linked task's detail.
 */
export function usePlanStageColumns(
  projectId: string | undefined,
  options: { onGoToTask: (specId: string) => void }
): {
  columns: LeadingColumn[];
  trailing: LeadingColumn[];
  dialog: ReactNode;
  onDrop: (activeId: string, target: { stage?: string; taskColumn?: TaskStatus }) => void;
  renderOverlay: (activeId: string) => ReactNode;
} {
  const { t } = useTranslation(['common']);
  const roadmap = useRoadmapStore((s) => s.roadmap);
  const refiningIds = useRoadmapStore((s) => s.refiningFeatureIds);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapsed);
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

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = { ...current, [id]: !current[id] };
      writeCollapsed(next);
      return next;
    });

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

  const columns: LeadingColumn[] = [
    {
      id: 'planned',
      label: t('board.columns.planned'),
      count: planned.length,
      render: (flat) => (
        <StageColumn
          key="planned"
          id="planned"
          label={t('board.columns.planned')}
          count={planned.length}
          icon={<Calendar className="h-4 w-4" />}
          borderClass="border-t-info"
          flat={flat}
          collapsed={!!collapsed.planned}
          onToggleCollapsed={() => toggle('planned')}
          empty={t('board.emptyPlanned')}
          action={
            projectId &&
            unplanned.length > 0 && (
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
            )
          }
        >
          {planned.map(featureCard)}
        </StageColumn>
      ),
    },
  ];

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

  return { columns, trailing: [], dialog, onDrop, renderOverlay };
}
