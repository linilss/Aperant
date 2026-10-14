import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  ArrowLeft,
  X,
  Lightbulb,
  Users,
  CheckCircle2,
  Circle,
  ArrowRight,
  Zap,
  ExternalLink,
  TrendingUp,
  Trash2,
  Archive,
  Wand2,
  Sparkles,
  Loader2,
} from 'lucide-react';
import { TaskOutcomeBadge } from './TaskOutcomeBadge';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { ScrollArea } from '../ui/scroll-area';
import { DialogOverlay, DialogPortal } from '../ui/dialog';
import {
  ROADMAP_PRIORITY_COLORS,
  ROADMAP_PRIORITY_LABELS,
  ROADMAP_COMPLEXITY_COLORS,
  ROADMAP_IMPACT_COLORS,
} from '../../../shared/constants';
import type { FeatureDetailPanelProps } from './types';
import { refineFeatureWithAI, useRoadmapStore } from '../../stores/roadmap-store';

export function FeatureDetailPanel({
  feature: selectedFeature,
  onClose,
  onConvertToSpec,
  onGoToTask,
  onRefine,
  onDelete,
  onArchive,
  competitorInsights = [],
}: FeatureDetailPanelProps) {
  const { t } = useTranslation('common');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  // Live copy from the store so an AI refinement shows up in place
  const feature =
    useRoadmapStore((state) => state.roadmap?.features.find((f) => f.id === selectedFeature.id)) ??
    selectedFeature;
  const projectId = useRoadmapStore((state) => state.roadmap?.projectId);
  const refining = useRoadmapStore((state) => !!state.refiningFeatureIds[selectedFeature.id]);
  const [refineError, setRefineError] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when another feature is shown
  useEffect(() => setRefineError(null), [selectedFeature.id]);

  const handleRefineWithAI = async () => {
    if (!projectId) return;
    setRefineError(null);
    const line =
      feature.description && feature.description !== feature.title
        ? `${feature.title}\n\n${feature.description}`
        : feature.title;
    // Explicit request: title/description may be rewritten; priority/phase stay
    const result = await refineFeatureWithAI(projectId, feature.id, line, { suggestPriority: false, explicit: true });
    if (!result.success && result.error) setRefineError(result.error);
  };

  const handleArchive = () => {
    onArchive?.(feature.id);
  };

  const handleDelete = () => {
    if (onDelete) {
      onDelete(feature.id);
      onClose();
    }
  };

  // Desktop: centered dialog over a backdrop; phone: full screen. Esc / backdrop click close it.
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogPortal>
        <DialogOverlay className="bg-black/50 backdrop-blur-none max-md:hidden" />
        <DialogPrimitive.Content
          ref={contentRef}
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            // Focus the sheet itself rather than (and ringing) the first header button
            e.preventDefault();
            contentRef.current?.focus();
          }}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[42rem] max-w-[calc(100vw-4rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl outline-none max-md:inset-0 max-md:max-h-none max-md:w-full max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none max-md:border-0 max-md:pt-[env(safe-area-inset-top)] max-md:pb-[env(safe-area-inset-bottom)]"
        >
      {/* Header */}
      <div className="shrink-0 p-4 border-b border-border electron-no-drag max-md:p-3">
        <div className="flex items-start justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="-ml-1 h-10 w-10 shrink-0 md:hidden"
            onClick={onClose}
            aria-label={t('roadmap.detail.back')}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <Badge variant="outline" className={ROADMAP_PRIORITY_COLORS[feature.priority]}>
                {ROADMAP_PRIORITY_LABELS[feature.priority]}
              </Badge>
              <Badge
                variant="outline"
                className={`${ROADMAP_COMPLEXITY_COLORS[feature.complexity]}`}
              >
                {feature.complexity}
              </Badge>
            </div>
            <DialogPrimitive.Title className="font-semibold break-words">{feature.title}</DialogPrimitive.Title>
            {refineError && (
              <p className="mt-1 text-xs text-destructive" role="alert">
                {t('roadmap.refineFailed', { error: refineError })}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0 relative z-10 pointer-events-auto">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-muted-foreground"
              disabled={refining || !projectId}
              onClick={(e) => {
                e.stopPropagation();
                void handleRefineWithAI();
              }}
              title={refining ? t('roadmap.refining') : t('roadmap.refineWithAI')}
              aria-label={refining ? t('roadmap.refining') : t('roadmap.refineWithAI')}
            >
              {refining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              onClick={(e) => {
                e.stopPropagation();
                setShowDeleteConfirm(true);
              }}
              aria-label={t('accessibility.deleteFeatureAriaLabel')}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="max-md:hidden"
              onClick={onClose}
              aria-label={t('accessibility.closeFeatureDetailsAriaLabel')}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4 space-y-6">
          {/* Description */}
          <div>
            <h3 className="text-sm font-medium mb-2">{t('roadmap.detail.description')}</h3>
            <p className="text-sm text-muted-foreground">{feature.description}</p>
          </div>

        {/* Rationale */}
        <div>
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <Lightbulb className="h-4 w-4" />
            {t('roadmap.detail.rationale')}
          </h3>
          <p className="text-sm text-muted-foreground">{feature.rationale}</p>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-3 gap-2">
          <Card className="p-3 text-center">
            <div
              className={`text-lg font-semibold ${ROADMAP_COMPLEXITY_COLORS[feature.complexity]}`}
            >
              {feature.complexity}
            </div>
            <div className="text-xs text-muted-foreground">{t('roadmap.detail.complexity')}</div>
          </Card>
          <Card className="p-3 text-center">
            <div className={`text-lg font-semibold ${ROADMAP_IMPACT_COLORS[feature.impact]}`}>
              {feature.impact}
            </div>
            <div className="text-xs text-muted-foreground">{t('roadmap.detail.impact')}</div>
          </Card>
          <Card className="p-3 text-center">
            <div className="text-lg font-semibold">{feature.dependencies.length}</div>
            <div className="text-xs text-muted-foreground truncate">{t('roadmap.detail.dependencies')}</div>
          </Card>
        </div>

        {/* User Stories */}
        {feature.userStories.length > 0 && (
          <div>
            <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
              <Users className="h-4 w-4" />
              {t('roadmap.detail.userStories')}
            </h3>
            <div className="space-y-2">
              {feature.userStories.map((story, i) => (
                <div key={i} className="text-sm p-2 bg-muted/50 rounded-md italic">
                  "{story}"
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Acceptance Criteria */}
        {feature.acceptanceCriteria.length > 0 && (
          <div>
            <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              {t('roadmap.detail.acceptanceCriteria')}
            </h3>
            <ul className="space-y-1">
              {feature.acceptanceCriteria.map((criterion, i) => (
                <li key={i} className="text-sm flex items-start gap-2">
                  <Circle className="h-3 w-3 mt-1.5 shrink-0" />
                  <span>{criterion}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Dependencies */}
        {feature.dependencies.length > 0 && (
          <div>
            <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
              <ArrowRight className="h-4 w-4" />
              {t('roadmap.detail.dependencies')}
            </h3>
            <div className="flex flex-wrap gap-1">
              {feature.dependencies.map((dep) => (
                <Badge key={dep} variant="outline" className="text-xs">
                  {dep}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Competitor Insights */}
        {competitorInsights.length > 0 && (
          <div>
            <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              {t('roadmap.detail.competitorPainPoints')}
            </h3>
            <div className="space-y-2">
              {competitorInsights.map((insight) => (
                <div
                  key={insight.id}
                  className="p-2 bg-primary/5 border border-primary/20 rounded-md"
                >
                  <p className="text-sm text-foreground">{insight.description}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className="text-xs">
                      {insight.source}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={`text-xs ${
                        insight.severity === 'high'
                          ? 'text-red-500 border-red-500/50'
                          : insight.severity === 'medium'
                          ? 'text-yellow-500 border-yellow-500/50'
                          : 'text-green-500 border-green-500/50'
                      }`}
                    >
                      {t('roadmap.detail.severity', { severity: insight.severity })}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        </div>
      </ScrollArea>

      {/* Actions */}
      {(() => {
        const archiveButton = feature.status === 'done' && (
          <Button
            variant="outline"
            className="w-full"
            onClick={handleArchive}
            aria-label={t('accessibility.archiveFeatureAriaLabel')}
          >
            <Archive className="h-4 w-4 mr-2" />
            {t('roadmap.archiveFeature')}
          </Button>
        );

        if (feature.taskOutcome) return (
          <div className="shrink-0 p-4 border-t border-border space-y-3">
            <div className="flex items-center justify-center gap-2 py-2">
              <TaskOutcomeBadge outcome={feature.taskOutcome} size="lg" />
            </div>
            {archiveButton}
          </div>
        );

        if (feature.linkedSpecId) return (
          <div className="shrink-0 p-4 border-t border-border space-y-2">
            <Button className="w-full" onClick={() => onGoToTask(feature.linkedSpecId!)}>
              <ExternalLink className="h-4 w-4 mr-2" />
              {t('roadmap.goToTask')}
            </Button>
            {archiveButton}
          </div>
        );

        if (feature.status === 'done') return (
          <div className="shrink-0 p-4 border-t border-border">
            {archiveButton}
          </div>
        );

        return (
          <div className="shrink-0 p-4 border-t border-border space-y-2">
            {onRefine && (
              <Button variant="outline" className="w-full" onClick={() => onRefine(feature)}>
                <Wand2 className="h-4 w-4 mr-2" />
                {t('roadmap.detail.refine')}
              </Button>
            )}
            <Button className="w-full" onClick={() => onConvertToSpec(feature)}>
              <Zap className="h-4 w-4 mr-2" />
              {t('roadmap.convertToTask')}
            </Button>
          </div>
        );
      })()}

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <div className="absolute inset-0 bg-background/95 flex items-center justify-center p-6 z-10">
          <div className="text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
              <Trash2 className="h-6 w-6 text-destructive" />
            </div>
            <div>
              <h3 className="font-semibold">{t('roadmap.detail.deleteTitle')}</h3>
              <p className="text-sm text-muted-foreground mt-1 break-words">
                {t('roadmap.detail.deleteDescription', { title: feature.title })}
              </p>
            </div>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
                {t('roadmap.detail.cancel')}
              </Button>
              <Button variant="destructive" onClick={handleDelete}>
                {t('roadmap.detail.delete')}
              </Button>
            </div>
          </div>
        </div>
      )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}
