import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '../lib/utils';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from './ui/tooltip';
import { ExternalLink, TrendingUp, Layers, ThumbsUp, Archive, Loader2, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DirectionTagChips, useProjectDirections } from './competitors/DirectionTagChips';
import { resolveFeatureDirections } from './moscow/direction-filter';
import { MoveToMenu, type MoveToConfig } from './roadmap/MoveToMenu';
import { planFeature, useRoadmapStore } from '../stores/roadmap-store';
import { useIsOverviewProject } from '../stores/project-store';
import { TaskOutcomeBadge, getTaskOutcomeColorClass } from './roadmap/TaskOutcomeBadge';
import {
  ROADMAP_PRIORITY_COLORS,
  ROADMAP_PRIORITY_LABELS,
  ROADMAP_COMPLEXITY_COLORS,
  ROADMAP_IMPACT_COLORS
} from '../../shared/constants';
import type { RoadmapFeature, Roadmap } from '../../shared/types';

interface SortableFeatureCardProps {
  feature: RoadmapFeature;
  roadmap?: Roadmap;
  onClick: () => void;
  onConvertToSpec?: (feature: RoadmapFeature) => void;
  onGoToTask?: (specId: string) => void;
  onArchive?: (featureId: string) => void;
  /**
   * Phone layout: title + one metadata row, no description or action buttons
   * (both live in the detail panel opened on tap).
   */
  compact?: boolean;
  /** Turn off drag-and-drop for this card (e.g. phone layouts that use "Move to…") */
  dragDisabled?: boolean;
  /** Shows a "Move to…" menu on compact cards */
  moveTo?: MoveToConfig;
}

export function SortableFeatureCard({
  feature,
  roadmap,
  onClick,
  onConvertToSpec,
  onGoToTask,
  onArchive,
  compact = false,
  dragDisabled = false,
  moveTo
}: SortableFeatureCardProps) {
  const { t } = useTranslation('common');
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver
  } = useSortable({ id: feature.id, disabled: dragDisabled });
  const refining = useRoadmapStore((state) => !!state.refiningFeatureIds[feature.id]);
  const overviewOnly = useIsOverviewProject(roadmap?.projectId);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Prevent z-index stacking issues during drag
    zIndex: isDragging ? 50 : undefined
  };

  const hasCompetitorInsight =
    !!feature.competitorInsightIds && feature.competitorInsightIds.length > 0;

  // Get phase name for the feature
  const phaseName = roadmap?.phases.find((p) => p.id === feature.phaseId)?.name;

  // Check if feature has external source (e.g., Canny)
  const isExternal = feature.source?.provider && feature.source.provider !== 'internal';

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-feature-id={feature.id}
      className={cn(
        // Touch screens (phone or iPad): swipes scroll, a long press drags
        'touch-none pointer-coarse:touch-manipulation pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none] transition-all duration-200',
        isDragging && 'dragging-placeholder opacity-40 scale-[0.98]',
        isOver && !isDragging && 'ring-2 ring-primary/30 ring-offset-2 ring-offset-background rounded-xl'
      )}
      {...(dragDisabled ? undefined : attributes)}
      {...(dragDisabled ? undefined : listeners)}
    >
      {compact ? (
        <CompactFeatureCardBody
          feature={feature}
          phaseName={phaseName}
          projectId={roadmap?.projectId}
          refining={refining}
          onClick={onClick}
          moveTo={moveTo}
        />
      ) : (
      <Card
        className="p-3 hover:bg-muted/50 cursor-pointer transition-colors"
        onClick={onClick}
      >
        {/* Header - Title with priority badge and action button */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <Badge
                variant="outline"
                className={cn('text-[11px] max-md:text-xs px-1.5 py-0', ROADMAP_PRIORITY_COLORS[feature.priority])}
              >
                {ROADMAP_PRIORITY_LABELS[feature.priority]}
              </Badge>
              {phaseName && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      className="text-[11px] max-md:text-xs px-1.5 py-0 text-muted-foreground border-muted-foreground/30"
                    >
                      <Layers className="h-2.5 w-2.5 mr-0.5" />
                      {phaseName.length > 12 ? `${phaseName.slice(0, 12)}...` : phaseName}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t('roadmap.card.phaseTooltip', { name: phaseName })}
                  </TooltipContent>
                </Tooltip>
              )}
              {refining && (
                <Badge
                  variant="outline"
                  className="text-[11px] max-md:text-xs px-1.5 py-0 text-muted-foreground border-muted-foreground/30"
                  title={t(feature.status === 'planned' ? 'roadmap.proofreadingTooltip' : 'roadmap.refiningTooltip')}
                >
                  <Loader2 className="h-2.5 w-2.5 mr-0.5 animate-spin" />
                  {t(feature.status === 'planned' ? 'roadmap.proofreading' : 'roadmap.refining')}
                </Badge>
              )}
              {hasCompetitorInsight && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      className="text-[11px] max-md:text-xs px-1.5 py-0 text-primary border-primary/50"
                    >
                      <TrendingUp className="h-2.5 w-2.5" />
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t('roadmap.card.competitorTooltip')}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <h3 className="font-medium text-sm leading-snug line-clamp-2">{feature.title}</h3>
            {/* Why the planning proofread sent it back */}
            {feature.status === 'under_review' && feature.proofreadNote && (
              <p className="mt-1 text-xs text-warning line-clamp-2">{feature.proofreadNote}</p>
            )}
            <DirectionTagChips feature={feature} projectId={roadmap?.projectId} />
          </div>
          <div className="shrink-0 flex items-center gap-1">
            {feature.taskOutcome ? (
              <Badge
                variant="outline"
                className={`text-[11px] max-md:text-xs px-1.5 py-0 ${getTaskOutcomeColorClass(feature.taskOutcome)}`}
              >
                <TaskOutcomeBadge outcome={feature.taskOutcome} size="sm" />
              </Badge>
            ) : feature.linkedSpecId ? (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2"
                onClick={(e) => {
                  e.stopPropagation();
                  onGoToTask?.(feature.linkedSpecId!);
                }}
              >
                <ExternalLink className="h-3 w-3 mr-1" />
                {t('roadmap.task')}
              </Button>
            ) : (
              feature.status !== 'done' &&
              !overviewOnly &&
              onConvertToSpec && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2"
                  disabled={refining || !roadmap?.projectId}
                  title={t('roadmap.planAll.tooltip')}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (roadmap?.projectId) void planFeature(roadmap.projectId, feature.id);
                  }}
                >
                  <Sparkles className="h-3 w-3 mr-1" />
                  {t('roadmap.plan')}
                </Button>
              )
            )}
            {feature.status === 'done' && onArchive && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                title={t('roadmap.archiveFeature')}
                aria-label={t('accessibility.archiveFeatureAriaLabel')}
                onClick={(e) => {
                  e.stopPropagation();
                  onArchive(feature.id);
                }}
              >
                <Archive className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>

        {/* Description */}
        <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">
          {feature.description}
        </p>

        {/* Metadata badges - compact row */}
        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          <Badge
            variant="outline"
            className={cn('text-[11px] max-md:text-xs px-1.5 py-0', ROADMAP_COMPLEXITY_COLORS[feature.complexity])}
          >
            {feature.complexity}
          </Badge>
          <Badge
            variant="outline"
            className={cn('text-[11px] max-md:text-xs px-1.5 py-0', ROADMAP_IMPACT_COLORS[feature.impact])}
          >
            {feature.impact}
          </Badge>
          {/* Show vote count if from external source */}
          {feature.votes !== undefined && feature.votes > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className="text-[11px] max-md:text-xs px-1.5 py-0 text-muted-foreground"
                >
                  <ThumbsUp className="h-2.5 w-2.5 mr-0.5" />
                  {feature.votes}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                {t('roadmap.card.votesTooltip', { count: feature.votes })}
              </TooltipContent>
            </Tooltip>
          )}
          {/* Show external source indicator */}
          {isExternal && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className="text-[11px] max-md:text-xs px-1.5 py-0 text-orange-500 border-orange-500/30"
                >
                  {feature.source?.provider === 'canny' ? 'Canny' : t('roadmap.card.external')}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                {t('roadmap.card.importedFrom', { provider: feature.source?.provider })}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </Card>
      )}
    </div>
  );
}

interface CompactFeatureCardBodyProps {
  feature: RoadmapFeature;
  phaseName?: string;
  projectId?: string;
  refining: boolean;
  onClick: () => void;
  moveTo?: MoveToConfig;
}

const tinyBadge = 'inline-flex shrink-0 items-center rounded px-1 text-xs leading-4';

/** Title (2 lines) + a single non-wrapping metadata row */
function CompactFeatureCardBody({
  feature,
  phaseName,
  projectId,
  refining,
  onClick,
  moveTo
}: CompactFeatureCardBodyProps) {
  const { t } = useTranslation('common');
  const directionRefs = resolveFeatureDirections(feature, useProjectDirections(projectId));

  return (
    <Card className="relative cursor-pointer px-3 py-2.5 transition-colors active:bg-muted/50" onClick={onClick}>
      <h3 className={cn('text-sm font-medium leading-snug line-clamp-2', moveTo && 'pr-7')}>{feature.title}</h3>
      {moveTo && <MoveToMenu {...moveTo} itemTitle={feature.title} className="absolute right-1 top-1 m-0" />}
      <div className="mt-1.5 flex min-w-0 items-center gap-1 overflow-hidden">
        {refining && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" aria-label={t('roadmap.refining')} />}
        {feature.taskOutcome ? (
          <Badge
            variant="outline"
            className={cn('shrink-0 px-1 py-0 text-xs', getTaskOutcomeColorClass(feature.taskOutcome))}
          >
            <TaskOutcomeBadge outcome={feature.taskOutcome} size="sm" />
          </Badge>
        ) : (
          feature.linkedSpecId && (
            <span className={cn(tinyBadge, 'gap-0.5 bg-primary/10 text-primary')} title={t('roadmap.viewTask')}>
              <ExternalLink className="h-2.5 w-2.5" />
              {t('roadmap.task')}
            </span>
          )
        )}
        {directionRefs.map(({ direction, rank }) => (
          <span
            key={direction.id}
            className={cn(
              tinyBadge,
              'rounded-full font-semibold tabular-nums',
              direction.avoid ? 'bg-muted text-muted-foreground line-through' : 'bg-primary/15 text-primary'
            )}
            title={
              direction.avoid
                ? t('roadmap.moscow.directions.avoidTooltip', { rank, title: direction.title })
                : t('roadmap.moscow.directions.tooltip', { rank, title: direction.title })
            }
          >
            {rank}
          </span>
        ))}
        <span
          className={cn(tinyBadge, ROADMAP_IMPACT_COLORS[feature.impact])}
          title={t('roadmap.moscow.compact.impactTitle', { level: feature.impact })}
        >
          {t('roadmap.moscow.compact.impact', { level: feature.impact })}
        </span>
        <span
          className={cn(tinyBadge, ROADMAP_COMPLEXITY_COLORS[feature.complexity])}
          title={t('roadmap.moscow.compact.complexityTitle', { level: feature.complexity })}
        >
          {t('roadmap.moscow.compact.complexity', { level: feature.complexity })}
        </span>
        {phaseName && (
          <span
            className={cn(tinyBadge, 'min-w-0 shrink gap-0.5 text-muted-foreground')}
            title={t('roadmap.moscow.compact.phaseTitle', { name: phaseName })}
          >
            <Layers className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">{phaseName}</span>
          </span>
        )}
      </div>
    </Card>
  );
}
