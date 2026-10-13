import { useTranslation } from 'react-i18next';
import { ExternalLink, Grid2x2, MapPlus, MoreHorizontal, Play, X, type LucideIcon } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Card } from '../ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { Checkbox } from '../ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../ui/dropdown-menu';
import { cn } from '../../lib/utils';
import {
  IDEATION_TYPE_LABELS,
  IDEATION_TYPE_COLORS,
  IDEATION_STATUS_COLORS,
  IDEATION_EFFORT_COLORS,
  IDEATION_IMPACT_COLORS,
  SECURITY_SEVERITY_COLORS,
  UIUX_CATEGORY_LABELS,
  DOCUMENTATION_CATEGORY_LABELS,
  CODE_QUALITY_SEVERITY_COLORS
} from '../../../shared/constants';
import type {
  Idea,
  CodeImprovementIdea,
  UIUXImprovementIdea,
  DocumentationGapIdea,
  SecurityHardeningIdea,
  PerformanceOptimizationIdea,
  CodeQualityIdea
} from '../../../shared/types';
import { TypeIcon } from './TypeIcon';
import { categoryLabel } from './constants';
import { DirectionTagChips } from '../competitors/DirectionTagChips';
import {
  isFeatureIdea,
  isCodeImprovementIdea,
  isUIUXIdea,
  isDocumentationGapIdea,
  isSecurityHardeningIdea,
  isPerformanceOptimizationIdea,
  isCodeQualityIdea
} from './type-guards';

interface CardAction {
  id: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  className?: string;
}

interface IdeaCardProps {
  idea: Idea;
  isSelected: boolean;
  onClick: () => void;
  onConvert: (idea: Idea) => void;
  onGoToTask?: (taskId: string) => void;
  onDismiss: (idea: Idea) => void;
  onToggleSelect: (ideaId: string) => void;
  /** Funnel: add the idea as a roadmap feature */
  onAddToRoadmap?: (idea: Idea) => void;
  /** Open MoSCoW (for ideas already on the roadmap) */
  onGoToMoscow?: () => void;
  /** For direction tag chips */
  projectId?: string;
}

export function IdeaCard({
  idea,
  isSelected,
  onClick,
  onConvert,
  onGoToTask,
  onDismiss,
  onToggleSelect,
  onAddToRoadmap,
  onGoToMoscow,
  projectId,
}: IdeaCardProps) {
  const { t } = useTranslation('common');
  const isDismissed = idea.status === 'dismissed';
  const isArchived = idea.status === 'archived';
  const isConverted = idea.status === 'converted';
  const isInactive = isDismissed || isArchived;

  const actions: CardAction[] = [];
  if (!isInactive && !isConverted) {
    actions.push({
      id: 'convert',
      label: t('accessibility.convertToTaskAriaLabel'),
      icon: Play,
      onSelect: () => onConvert(idea)
    });
    if (onAddToRoadmap) {
      actions.push({
        id: 'roadmap',
        label: t('ideation.addToRoadmap'),
        icon: MapPlus,
        onSelect: () => onAddToRoadmap(idea)
      });
    }
    actions.push({
      id: 'dismiss',
      label: t('accessibility.dismissAriaLabel'),
      icon: X,
      onSelect: () => onDismiss(idea),
      className: 'text-muted-foreground hover:text-destructive'
    });
  } else if (idea.taskId && onGoToTask && (isArchived || isConverted)) {
    // Archived / legacy converted ideas link to their task
    const taskId = idea.taskId;
    actions.push({
      id: 'go-to-task',
      label: t('accessibility.goToTaskAriaLabel'),
      icon: ExternalLink,
      onSelect: () => onGoToTask(taskId),
      className: 'text-primary'
    });
  } else if (isConverted && !idea.taskId && idea.roadmapFeatureId && onGoToMoscow) {
    // Added to the roadmap: link to MoSCoW
    actions.push({
      id: 'moscow',
      label: t('ideation.viewInMoscow'),
      icon: Grid2x2,
      onSelect: onGoToMoscow,
      className: 'text-primary'
    });
  }

  const uiuxCategory = isUIUXIdea(idea)
    ? categoryLabel(UIUX_CATEGORY_LABELS, (idea as UIUXImprovementIdea).category)
    : null;
  const docsCategory = isDocumentationGapIdea(idea)
    ? categoryLabel(DOCUMENTATION_CATEGORY_LABELS, (idea as DocumentationGapIdea).category)
    : null;

  const iconButton = (action: CardAction, className?: string) => (
    <Tooltip key={action.id}>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn('h-8 w-8 p-0', action.className, className)}
          onClick={(e) => {
            e.stopPropagation();
            action.onSelect();
          }}
          aria-label={action.label}
        >
          <action.icon className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{action.label}</TooltipContent>
    </Tooltip>
  );

  // Phone: one action stays an icon button, several fold into a "..." menu next to the badges
  const phoneActions =
    actions.length === 1 ? (
      iconButton(actions[0], 'h-10 w-10 shrink-0 -my-2 -mr-2')
    ) : actions.length > 1 ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="-my-2 -mr-2 h-10 w-10 shrink-0 p-0"
            onClick={(e) => e.stopPropagation()}
            aria-label={t('ideation.ideaActions')}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[12rem]" onClick={(e) => e.stopPropagation()}>
          {actions.map((action) => (
            <DropdownMenuItem key={action.id} onSelect={action.onSelect} className="min-h-10 gap-2">
              <action.icon className="h-4 w-4" />
              {action.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  return (
    <Card
      className={cn(
        'p-4 hover:bg-muted/50 cursor-pointer transition-colors max-md:p-3',
        isInactive && 'opacity-50',
        isSelected && 'ring-2 ring-primary bg-primary/5'
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        {/* Selection checkbox (padded hit area on touch) */}
        <div
          className="pt-0.5 max-md:-m-2 max-md:p-2"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(idea.id);
          }}
        >
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onToggleSelect(idea.id)}
            className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
            aria-label={t('accessibility.selectIdeaAriaLabel', { title: idea.title })}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              {typeof idea.score === 'number' && (
                <Badge
                  variant="outline"
                  className={cn(
                    'tabular-nums',
                    idea.score >= 8 ? 'border-success/40 text-success' : idea.score <= 5 ? 'text-muted-foreground' : undefined
                  )}
                  title={t('ideation.scoreTooltip')}
                >
                  {t('ideation.score', { score: idea.score })}
                </Badge>
              )}
              <Badge variant="outline" className={IDEATION_TYPE_COLORS[idea.type]}>
                <TypeIcon type={idea.type} />
                <span className="ml-1">{IDEATION_TYPE_LABELS[idea.type]}</span>
              </Badge>
              {idea.status !== 'draft' && (
                <Badge variant="outline" className={IDEATION_STATUS_COLORS[idea.status]}>
                  {idea.status}
                </Badge>
              )}
              {isFeatureIdea(idea) && typeof idea.impact === 'string' && (
                <Badge variant="outline" className={IDEATION_IMPACT_COLORS[idea.impact]}>
                  {t(`ideation.feature.impactBadge.${idea.impact}`)}
                </Badge>
              )}
              {isCodeImprovementIdea(idea) && typeof (idea as CodeImprovementIdea).estimatedEffort === 'string' && (
                <Badge variant="outline" className={IDEATION_EFFORT_COLORS[(idea as CodeImprovementIdea).estimatedEffort]}>
                  {(idea as CodeImprovementIdea).estimatedEffort}
                </Badge>
              )}
              {uiuxCategory && <Badge variant="outline">{uiuxCategory}</Badge>}
              {docsCategory && <Badge variant="outline">{docsCategory}</Badge>}
              {isSecurityHardeningIdea(idea) && typeof (idea as SecurityHardeningIdea).severity === 'string' && (
                <Badge variant="outline" className={SECURITY_SEVERITY_COLORS[(idea as SecurityHardeningIdea).severity]}>
                  {(idea as SecurityHardeningIdea).severity}
                </Badge>
              )}
              {isPerformanceOptimizationIdea(idea) && typeof (idea as PerformanceOptimizationIdea).impact === 'string' && (
                <Badge variant="outline" className={IDEATION_IMPACT_COLORS[(idea as PerformanceOptimizationIdea).impact]}>
                  {(idea as PerformanceOptimizationIdea).impact} impact
                </Badge>
              )}
              {isCodeQualityIdea(idea) && typeof (idea as CodeQualityIdea).severity === 'string' && (
                <Badge variant="outline" className={CODE_QUALITY_SEVERITY_COLORS[(idea as CodeQualityIdea).severity]}>
                  {(idea as CodeQualityIdea).severity}
                </Badge>
              )}
            </div>
            {phoneActions && <div className="md:hidden">{phoneActions}</div>}
          </div>
          <h3 className={cn('font-medium break-words', isInactive && 'line-through')}>{idea.title}</h3>
          <p className="text-sm text-muted-foreground line-clamp-2">{idea.description}</p>
          {idea.whyNow && <p className="mt-1 text-xs text-muted-foreground/80 italic line-clamp-1">{idea.whyNow}</p>}
          <DirectionTagChips feature={idea} projectId={projectId} />
        </div>

        {/* Desktop: icon buttons beside the content */}
        {actions.length > 0 && (
          <div className="ml-2 flex shrink-0 items-center gap-1 max-md:hidden">
            {actions.map((action) => iconButton(action))}
          </div>
        )}
      </div>
    </Card>
  );
}
