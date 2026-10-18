/**
 * The planning stages of the one board: Ideas (inbox) → Under Review → Planned,
 * shown before the build columns. Reads the ideation and roadmap stores; a
 * feature that already has a task is shown by its task card, not here.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Lightbulb, Eye, Calendar, Plus, X, Sparkles, ExternalLink } from 'lucide-react';

import { useIdeationStore, loadIdeation, getActiveIdeas } from '../../stores/ideation-store';
import { useRoadmapStore, loadRoadmap } from '../../stores/roadmap-store';
import { useAddIdeaToRoadmap } from '../ideation/hooks/useAddIdeaToRoadmap';
import { useFeatureActions, useFeatureDelete } from '../roadmap/hooks';
import { FeatureDetailPanel } from '../roadmap/FeatureDetailPanel';
import { SortableFeatureCard } from '../SortableFeatureCard';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '../../lib/utils';
import type { Idea, RoadmapFeature } from '../../../shared/types';

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
  if (collapsed && !flat) {
    return (
      <button
        key={id}
        type="button"
        onClick={onToggleCollapsed}
        className={cn(
          'flex w-12 shrink-0 flex-col items-center gap-3 rounded-xl border border-white/5 border-t-2 bg-secondary/20 py-4 text-muted-foreground hover:text-foreground',
          borderClass
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
        className={cn(
          'flex min-w-0 flex-1 flex-col rounded-xl border border-white/5 border-t-2 bg-linear-to-b from-secondary/30 to-transparent',
          borderClass
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

function IdeaCard({
  idea,
  adding,
  onAdd,
  onDismiss,
}: {
  idea: Idea;
  adding: boolean;
  onAdd: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation(['common']);
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="line-clamp-2 text-sm font-medium leading-snug">{idea.title}</h3>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground"
          onClick={onDismiss}
          aria-label={t('board.dismissIdea')}
          title={t('board.dismissIdea')}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      {idea.description && <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{idea.description}</p>}
      <div className="mt-2 flex justify-end">
        <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={onAdd} disabled={adding}>
          <Plus className="h-3 w-3" />
          {t('board.toRoadmap')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Columns for ideas and roadmap features without a task, plus the feature
 * dialog they open. `onGoToTask` opens a linked task's detail.
 */
export function usePlanStageColumns(
  projectId: string | undefined,
  options: { onGoToTask: (specId: string) => void; onOpenIdeation?: () => void }
): { columns: LeadingColumn[]; dialog: ReactNode } {
  const { t } = useTranslation(['common']);
  const roadmap = useRoadmapStore((s) => s.roadmap);
  const refiningIds = useRoadmapStore((s) => s.refiningFeatureIds);
  const session = useIdeationStore((s) => s.session);
  const ideationProjectId = useIdeationStore((s) => s.currentProjectId);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapsed);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { convertFeatureToSpec } = useFeatureActions();
  const { deleteFeature } = useFeatureDelete(projectId ?? '');
  const { addingIdeas, handleAddToRoadmap } = useAddIdeaToRoadmap(projectId ?? '');

  // Load what the board shows when the project changes (the pages do the same)
  useEffect(() => {
    if (!projectId) return;
    if (useRoadmapStore.getState().roadmap?.projectId !== projectId) void loadRoadmap(projectId);
    if (useIdeationStore.getState().currentProjectId !== projectId) void loadIdeation(projectId);
  }, [projectId]);

  const projectRoadmap = roadmap && roadmap.projectId === projectId ? roadmap : null;
  const features = useMemo(() => (projectRoadmap?.features ?? []).filter((f) => !f.linkedSpecId), [projectRoadmap]);
  const underReview = features.filter((f) => f.status === 'under_review');
  const planned = features.filter((f) => f.status === 'planned');
  const ideas = useMemo(
    () =>
      ideationProjectId === projectId
        ? getActiveIdeas(session).filter((i) => i.status !== 'converted' && !i.roadmapFeatureId)
        : [],
    [session, ideationProjectId, projectId]
  );

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = { ...current, [id]: !current[id] };
      writeCollapsed(next);
      return next;
    });

  const dismissIdea = async (idea: Idea) => {
    if (!projectId) return;
    const result = await window.electronAPI.dismissIdea(projectId, idea.id);
    if (result.success) useIdeationStore.getState().dismissIdea(idea.id);
  };

  const featureCard = (feature: RoadmapFeature) => (
    <SortableFeatureCard
      key={feature.id}
      feature={feature}
      roadmap={projectRoadmap ?? undefined}
      onClick={() => setSelectedId(feature.id)}
      // Shows the Plan button (proofread, then create the task)
      onConvertToSpec={() => undefined}
      onGoToTask={options.onGoToTask}
      dragDisabled
    />
  );

  const unplanned = planned.filter((f) => !refiningIds[f.id]).map((f) => f.id);

  const columns: LeadingColumn[] = [
    {
      id: 'ideas',
      label: t('board.columns.ideas'),
      count: ideas.length,
      render: (flat) => (
        <StageColumn
          key="ideas"
          id="ideas"
          label={t('board.columns.ideas')}
          count={ideas.length}
          icon={<Lightbulb className="h-4 w-4" />}
          borderClass="border-t-warning/60"
          flat={flat}
          collapsed={!!collapsed.ideas}
          onToggleCollapsed={() => toggle('ideas')}
          empty={t('board.emptyIdeas')}
          action={
            options.onOpenIdeation && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={options.onOpenIdeation}
                title={t('board.openIdeation')}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {t('board.generate')}
              </Button>
            )
          }
        >
          {ideas.map((idea) => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              adding={addingIdeas.has(idea.id)}
              onAdd={() => void handleAddToRoadmap(idea)}
              onDismiss={() => void dismissIdea(idea)}
            />
          ))}
        </StageColumn>
      ),
    },
    {
      id: 'under_review',
      label: t('board.columns.underReview'),
      count: underReview.length,
      render: (flat) => (
        <StageColumn
          key="under_review"
          id="under_review"
          label={t('board.columns.underReview')}
          count={underReview.length}
          icon={<Eye className="h-4 w-4" />}
          borderClass="border-t-muted-foreground/50"
          flat={flat}
          collapsed={!!collapsed.under_review}
          onToggleCollapsed={() => toggle('under_review')}
          empty={t('board.emptyUnderReview')}
        >
          {underReview.map(featureCard)}
        </StageColumn>
      ),
    },
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

  return { columns, dialog };
}
