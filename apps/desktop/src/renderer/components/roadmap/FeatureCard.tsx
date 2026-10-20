import { Archive, Ban, ExternalLink, Loader2, RotateCcw, Sparkles, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TaskOutcomeBadge, getTaskOutcomeColorClass } from './TaskOutcomeBadge';
import { moveFeatureToStatus, planFeature, useRoadmapStore } from '../../stores/roadmap-store';
import { useIsOverviewProject } from '../../stores/project-store';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import {
  ROADMAP_PRIORITY_COLORS,
  ROADMAP_PRIORITY_LABELS,
  ROADMAP_COMPLEXITY_COLORS,
  ROADMAP_IMPACT_COLORS,
} from '../../../shared/constants';
import type { FeatureCardProps } from './types';

export function FeatureCard({
  feature,
  onClick,
  onGoToTask,
  onArchive,
  hasCompetitorInsight = false,
}: FeatureCardProps) {
  const { t } = useTranslation('common');
  const refining = useRoadmapStore((state) => !!state.refiningFeatureIds[feature.id]);
  const projectId = useRoadmapStore((state) => state.roadmap?.projectId);
  const overviewOnly = useIsOverviewProject(projectId);
  const open = !feature.linkedSpecId && !feature.taskOutcome;

  return (
    <Card className="p-4 hover:bg-muted/50 cursor-pointer transition-colors max-md:p-3" onClick={onClick}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Badge variant="outline" className={ROADMAP_PRIORITY_COLORS[feature.priority]}>
              {ROADMAP_PRIORITY_LABELS[feature.priority]}
            </Badge>
            <Badge
              variant="outline"
              className={`text-xs ${ROADMAP_COMPLEXITY_COLORS[feature.complexity]}`}
            >
              {feature.complexity}
            </Badge>
            <Badge
              variant="outline"
              className={`text-xs ${ROADMAP_IMPACT_COLORS[feature.impact]}`}
            >
              {t('roadmap.card.impact', { level: feature.impact })}
            </Badge>
            {refining && (
              <Badge
                variant="outline"
                className="text-xs text-muted-foreground border-muted-foreground/30"
                title={t('roadmap.refiningTooltip')}
              >
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                {t('roadmap.refining')}
              </Badge>
            )}
            {hasCompetitorInsight && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="text-xs text-primary border-primary/50">
                    <TrendingUp className="h-3 w-3 mr-1" />
                    {t('roadmap.card.competitorInsight')}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>{t('roadmap.card.competitorTooltip')}</TooltipContent>
              </Tooltip>
            )}
          </div>
          <h3 className="font-medium break-words">{feature.title}</h3>
          <p className="text-sm text-muted-foreground line-clamp-2">{feature.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1 max-md:[&>button]:h-10">
          {feature.taskOutcome ? (
            <Badge variant="outline" className={`text-xs ${getTaskOutcomeColorClass(feature.taskOutcome)}`}>
              <TaskOutcomeBadge outcome={feature.taskOutcome} size="md" />
            </Badge>
          ) : feature.linkedSpecId ? (
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onGoToTask(feature.linkedSpecId!);
              }}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              {t('roadmap.goToTask')}
            </Button>
          ) : feature.status === 'dismissed' ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={!projectId}
              onClick={(e) => {
                e.stopPropagation();
                if (projectId) void moveFeatureToStatus(projectId, feature.id, 'under_review');
              }}
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              {t('roadmap.restore')}
            </Button>
          ) : (
            feature.status !== 'done' && (
              <>
                {/* Promote: proofread, then its task lands in the Board's Planning column */}
                {!overviewOnly && <Button
                  variant="outline"
                  size="sm"
                  disabled={refining || !projectId}
                  title={t('roadmap.planAll.tooltip')}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (projectId) void planFeature(projectId, feature.id);
                  }}
                >
                  <Sparkles className="h-3 w-3 mr-1" />
                  {t('roadmap.plan')}
                </Button>}
                {open && (feature.status === 'under_review' || feature.status === 'planned') && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={refining || !projectId}
                    title={t('roadmap.dismissFeature')}
                    aria-label={t('roadmap.dismissFeature')}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (projectId) void moveFeatureToStatus(projectId, feature.id, 'dismissed');
                    }}
                  >
                    <Ban className="h-3 w-3" />
                  </Button>
                )}
              </>
            )
          )}
          {feature.status === 'done' && onArchive && (
            <Button
              variant="ghost"
              size="sm"
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
    </Card>
  );
}
