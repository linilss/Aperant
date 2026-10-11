import { useTranslation } from 'react-i18next';
import { ChevronRight, ExternalLink, Grid2x2, Lightbulb, Loader2, MapPlus, Play, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  IDEATION_TYPE_LABELS,
  IDEATION_TYPE_COLORS,
  IDEATION_STATUS_COLORS
} from '../../../shared/constants';
import type { Idea } from '../../../shared/types';
import { TypeIcon } from './TypeIcon';
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
import { FeatureDetails } from './details/FeatureDetails';
import { CodeImprovementDetails } from './details/CodeImprovementDetails';
import { UIUXDetails } from './details/UIUXDetails';
import { DocumentationGapDetails } from './details/DocumentationGapDetails';
import { SecurityHardeningDetails } from './details/SecurityHardeningDetails';
import { PerformanceOptimizationDetails } from './details/PerformanceOptimizationDetails';
import { CodeQualityDetails } from './details/CodeQualityDetails';

interface IdeaDetailPanelProps {
  idea: Idea;
  onClose: () => void;
  onConvert: (idea: Idea) => void;
  onGoToTask?: (taskId: string) => void;
  onDismiss: (idea: Idea) => void;
  isConverting?: boolean;
  /** Funnel: add the idea as a roadmap feature */
  onAddToRoadmap?: (idea: Idea) => void;
  isAddingToRoadmap?: boolean;
  /** Open MoSCoW (for ideas already on the roadmap) */
  onGoToMoscow?: () => void;
  /** For direction tag chips */
  projectId?: string;
}

export function IdeaDetailPanel({
  idea,
  onClose,
  onConvert,
  onGoToTask,
  onDismiss,
  isConverting,
  onAddToRoadmap,
  isAddingToRoadmap,
  onGoToMoscow,
  projectId,
}: IdeaDetailPanelProps) {
  const { t } = useTranslation('common');
  const isDismissed = idea.status === 'dismissed';
  const isConverted = idea.status === 'converted';
  const isArchived = idea.status === 'archived';

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-card border-l border-border shadow-lg flex flex-col z-50 max-md:inset-x-0 max-md:w-full max-md:border-l-0 max-md:pt-[env(safe-area-inset-top)] max-md:pb-[env(safe-area-inset-bottom)]">
      {/* Header */}
      <div className="shrink-0 p-4 border-b border-border electron-no-drag">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <Badge variant="outline" className={IDEATION_TYPE_COLORS[idea.type]}>
                <TypeIcon type={idea.type} />
                <span className="ml-1">{IDEATION_TYPE_LABELS[idea.type]}</span>
              </Badge>
              {idea.status !== 'draft' && (
                <Badge variant="outline" className={IDEATION_STATUS_COLORS[idea.status]}>
                  {idea.status}
                </Badge>
              )}
            </div>
            <h2 className="font-semibold">{idea.title}</h2>
            <DirectionTagChips feature={idea} projectId={projectId} />
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={t('accessibility.closePanelAriaLabel')}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-6">
        {/* Description */}
        <div>
          <h3 className="text-sm font-medium mb-2">{t('common:ideation.description')}</h3>
          <p className="text-sm text-muted-foreground">{idea.description}</p>
        </div>

        {/* Rationale */}
        <div>
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <Lightbulb className="h-4 w-4" />
            {t('common:ideation.rationale')}
          </h3>
          <p className="text-sm text-muted-foreground">{idea.rationale}</p>
        </div>

        {/* Type-specific content */}
        {isFeatureIdea(idea) && <FeatureDetails idea={idea} />}
        {isCodeImprovementIdea(idea) && <CodeImprovementDetails idea={idea} />}
        {isUIUXIdea(idea) && <UIUXDetails idea={idea} />}
        {isDocumentationGapIdea(idea) && <DocumentationGapDetails idea={idea} />}
        {isSecurityHardeningIdea(idea) && <SecurityHardeningDetails idea={idea} />}
        {isPerformanceOptimizationIdea(idea) && <PerformanceOptimizationDetails idea={idea} />}
        {isCodeQualityIdea(idea) && <CodeQualityDetails idea={idea} />}
      </div>

      {/* Actions */}
      {!isDismissed && !isConverted && !isArchived && (
        <div className="shrink-0 p-4 border-t border-border space-y-2">
          <Button className="w-full" onClick={() => onConvert(idea)} disabled={isConverting}>
            {isConverting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            {isConverting ? t('common:ideation.converting') : t('common:ideation.convertToTask')}
          </Button>
          {onAddToRoadmap && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => onAddToRoadmap(idea)}
              disabled={isAddingToRoadmap}
            >
              {isAddingToRoadmap ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <MapPlus className="h-4 w-4 mr-2" />
              )}
              {isAddingToRoadmap ? t('common:ideation.addingToRoadmap') : t('common:ideation.addToRoadmap')}
            </Button>
          )}
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              onDismiss(idea);
              onClose();
            }}
          >
            <X className="h-4 w-4 mr-2" />
            {t('common:ideation.dismissIdea')}
          </Button>
        </div>
      )}
      {isConverted && !idea.taskId && idea.roadmapFeatureId && onGoToMoscow && (
        <div className="shrink-0 p-4 border-t border-border">
          <Button className="w-full" onClick={onGoToMoscow}>
            <Grid2x2 className="h-4 w-4 mr-2" />
            {t('common:ideation.viewInMoscow')}
          </Button>
        </div>
      )}
      {(isConverted || isArchived) && idea.taskId && onGoToTask && (
        <div className="shrink-0 p-4 border-t border-border">
          <Button className="w-full" onClick={() => onGoToTask(idea.taskId!)}>
            <ExternalLink className="h-4 w-4 mr-2" />
            {t('common:ideation.goToTask')}
          </Button>
        </div>
      )}
    </div>
  );
}
