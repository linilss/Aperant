/**
 * Backlog: roadmap features and ideation ideas in one list. Plan promotes
 * either one to the Board (an idea first becomes a roadmap feature, then the
 * planning proofread creates its task); Dismiss steers future generations away.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, Settings2, Sparkles } from 'lucide-react';

import { getActiveIdeas, loadIdeation, useIdeationStore } from '../../stores/ideation-store';
import { planFeature } from '../../stores/roadmap-store';
import { useAddIdeaToRoadmap } from '../ideation/hooks/useAddIdeaToRoadmap';
import { IdeaDetailPanel } from '../ideation/IdeaDetailPanel';
import { FeatureCard } from './FeatureCard';
import { hasCompetitorInsight } from './utils';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { IDEATION_TYPE_COLORS, IDEATION_TYPE_LABELS } from '../../../shared/constants';
import type { Idea, Roadmap, RoadmapFeature } from '../../../shared/types';

const STATUS_FILTERS = ['open', 'building', 'done', 'dismissed'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
const KIND_FILTERS = ['all', 'features', 'ideas'] as const;
type KindFilter = (typeof KIND_FILTERS)[number];

/** Open: no task yet (to promote or dismiss); building: has a task; done; dismissed */
function featureMatches(feature: RoadmapFeature, filter: StatusFilter): boolean {
  if (filter === 'dismissed') return feature.status === 'dismissed';
  if (filter === 'done') return feature.status === 'done';
  if (filter === 'building') return !!feature.linkedSpecId && feature.status !== 'done' && feature.status !== 'dismissed';
  return !feature.linkedSpecId && feature.status !== 'done' && feature.status !== 'dismissed';
}

/** Ideas are open until they become a feature (then the feature is listed) or are dismissed */
function ideaMatches(idea: Idea, filter: StatusFilter): boolean {
  if (filter === 'dismissed') return idea.status === 'dismissed';
  if (filter === 'open') return idea.status !== 'dismissed' && idea.status !== 'converted' && !idea.roadmapFeatureId;
  return false;
}

function IdeaRow({
  idea,
  busy,
  onOpen,
  onPlan,
  onDismiss,
}: {
  idea: Idea;
  busy: boolean;
  onOpen: () => void;
  onPlan: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation('common');
  const open = idea.status !== 'dismissed';
  return (
    <Card className="cursor-pointer p-4 transition-colors hover:bg-muted/50 max-md:p-3" onClick={onOpen}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={IDEATION_TYPE_COLORS[idea.type]}>
              {IDEATION_TYPE_LABELS[idea.type] ?? idea.type}
            </Badge>
            <Badge variant="outline" className="text-xs text-muted-foreground">
              {t('backlog.idea')}
            </Badge>
          </div>
          <h3 className="break-words font-medium">{idea.title}</h3>
          <p className="line-clamp-2 text-sm text-muted-foreground">{idea.description}</p>
        </div>
        {open && (
          <div className="flex shrink-0 items-center gap-1 max-md:[&>button]:h-10">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              title={t('roadmap.planAll.tooltip')}
              onClick={(e) => {
                e.stopPropagation();
                onPlan();
              }}
            >
              <Sparkles className="mr-1 h-3 w-3" />
              {t('roadmap.plan')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              title={t('roadmap.dismissFeature')}
              aria-label={t('roadmap.dismissFeature')}
              onClick={(e) => {
                e.stopPropagation();
                onDismiss();
              }}
            >
              <Ban className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

interface BacklogListProps {
  roadmap: Roadmap;
  projectId: string;
  onFeatureSelect: (feature: RoadmapFeature) => void;
  onGoToTask: (specId: string) => void;
  onArchive?: (featureId: string) => void;
  /** Ideation's generation settings (idea types, focus) */
  onOpenIdeaSettings?: () => void;
}

export function BacklogList({ roadmap, projectId, onFeatureSelect, onGoToTask, onArchive, onOpenIdeaSettings }: BacklogListProps) {
  const { t } = useTranslation('common');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [openIdeaId, setOpenIdeaId] = useState<string | null>(null);
  const session = useIdeationStore((s) => s.session);
  const ideationProjectId = useIdeationStore((s) => s.currentProjectId);
  const { addingIdeas, handleAddToRoadmap } = useAddIdeaToRoadmap(projectId);

  useEffect(() => {
    if (useIdeationStore.getState().currentProjectId !== projectId) void loadIdeation(projectId);
  }, [projectId]);

  const ideas = useMemo(
    () => (ideationProjectId === projectId && session ? [...getActiveIdeas(session), ...session.ideas.filter((i) => i.status === 'dismissed')] : []),
    [session, ideationProjectId, projectId]
  );

  const countFor = (filter: StatusFilter) =>
    (kindFilter === 'ideas' ? 0 : roadmap.features.filter((f) => featureMatches(f, filter)).length) +
    (kindFilter === 'features' ? 0 : ideas.filter((i) => ideaMatches(i, filter)).length);

  const features = kindFilter === 'ideas' ? [] : roadmap.features.filter((f) => featureMatches(f, statusFilter));
  const shownIdeas = kindFilter === 'features' ? [] : ideas.filter((i) => ideaMatches(i, statusFilter));

  const planIdea = async (idea: Idea) => {
    const featureId = await handleAddToRoadmap(idea);
    if (featureId) await planFeature(projectId, featureId);
  };

  const dismissIdea = async (idea: Idea) => {
    const result = await window.electronAPI.dismissIdea(projectId, idea.id);
    if (result.success) useIdeationStore.getState().dismissIdea(idea.id);
  };

  const openIdea = openIdeaId ? ideas.find((i) => i.id === openIdeaId) : undefined;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {STATUS_FILTERS.map((filter) => (
          <Button
            key={filter}
            size="sm"
            variant={statusFilter === filter ? 'secondary' : 'ghost'}
            className="h-7 px-2.5 text-xs"
            onClick={() => setStatusFilter(filter)}
          >
            {t(`roadmap.listFilter.${filter}`)}
            <span className="ml-1.5 tabular-nums text-muted-foreground">{countFor(filter)}</span>
          </Button>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        {KIND_FILTERS.map((filter) => (
          <Button
            key={filter}
            size="sm"
            variant={kindFilter === filter ? 'secondary' : 'ghost'}
            className="h-7 px-2.5 text-xs"
            onClick={() => setKindFilter(filter)}
          >
            {t(`backlog.kind.${filter}`)}
          </Button>
        ))}
        {onOpenIdeaSettings && (
          <Button size="sm" variant="ghost" className="ml-auto h-7 gap-1 px-2.5 text-xs" onClick={onOpenIdeaSettings}>
            <Settings2 className="h-3.5 w-3.5" />
            {t('backlog.ideaSettings')}
          </Button>
        )}
      </div>

      <div className="grid gap-3">
        {features.map((feature) => (
          <FeatureCard
            key={feature.id}
            feature={feature}
            onClick={() => onFeatureSelect(feature)}
            onConvertToSpec={() => undefined}
            onGoToTask={onGoToTask}
            onArchive={onArchive}
            hasCompetitorInsight={hasCompetitorInsight(feature)}
          />
        ))}
        {shownIdeas.map((idea) => (
          <IdeaRow
            key={idea.id}
            idea={idea}
            busy={addingIdeas.has(idea.id)}
            onOpen={() => setOpenIdeaId(idea.id)}
            onPlan={() => void planIdea(idea)}
            onDismiss={() => void dismissIdea(idea)}
          />
        ))}
        {features.length === 0 && shownIdeas.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">{t('backlog.empty')}</p>
        )}
      </div>

      {openIdea && (
        <IdeaDetailPanel
          idea={openIdea}
          projectId={projectId}
          onClose={() => setOpenIdeaId(null)}
          onConvert={(idea) => {
            setOpenIdeaId(null);
            void planIdea(idea);
          }}
          onDismiss={(idea) => {
            setOpenIdeaId(null);
            void dismissIdea(idea);
          }}
          onGoToTask={onGoToTask}
          onAddToRoadmap={(idea) => void handleAddToRoadmap(idea)}
          isAddingToRoadmap={addingIdeas.has(openIdea.id)}
        />
      )}
    </div>
  );
}
