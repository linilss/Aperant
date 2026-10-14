import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, Trash2 } from 'lucide-react';
import { RoadmapGenerationProgress } from './RoadmapGenerationProgress';
import { CompetitorAnalysisDialog } from './CompetitorAnalysisDialog';
import { RegenerateGuidanceDialog } from './roadmap/RegenerateGuidanceDialog';
import { CompetitorAnalysisViewer } from './CompetitorAnalysisViewer';
import { AddFeatureDialog } from './AddFeatureDialog';
import { RoadmapHeader } from './roadmap/RoadmapHeader';
import { RoadmapEmptyState } from './roadmap/RoadmapEmptyState';
import { RoadmapTabs } from './roadmap/RoadmapTabs';
import { FeatureDetailPanel } from './roadmap/FeatureDetailPanel';
import { RefineFeaturePanel } from './roadmap/RefineFeaturePanel';
import { StrategyGuidanceBar, StrategyGuidanceChip } from './competitors/StrategyGuidanceChip';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from './ui/alert-dialog';
import { useRoadmapData, useFeatureActions, useRoadmapGeneration, useRoadmapSave, useFeatureDelete } from './roadmap/hooks';
import { getCompetitorInsightsForFeature } from './roadmap/utils';
import { useFeatureRefineStore } from '../stores/feature-refine-store';
import { useRoadmapStore } from '../stores/roadmap-store';
import { cn } from '../lib/utils';
import type { FeatureRefineResult } from '../stores/feature-refine-store';
import type { RoadmapFeature } from '../../shared/types';
import type { RoadmapProps } from './roadmap/types';
import { PAGE_ROOT, PAGE_BODY } from './ui/page-header';

export function Roadmap({ projectId, onGoToTask, onGoToCompetitors, initialTab, tabRequestId }: RoadmapProps) {
  const { t } = useTranslation('common');

  // Feature Refine session store
  const { isOpen: isRefineOpen, open: openRefine, close: closeRefine, featureContext } = useFeatureRefineStore();
  const { addFeature: addFeatureToStore, updateFeature: updateFeatureInStore } = useRoadmapStore();

  // State management
  const [selectedFeature, setSelectedFeature] = useState<RoadmapFeature | null>(null);
  const [activeTab, setActiveTab] = useState(initialTab ?? 'kanban');

  // Navigation from elsewhere (e.g. "View in MoSCoW") can ask for a specific tab
  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab, tabRequestId]);
  const [showAddFeatureDialog, setShowAddFeatureDialog] = useState(false);
  const [showCompetitorViewer, setShowCompetitorViewer] = useState(false);
  const [pendingArchiveFeatureId, setPendingArchiveFeatureId] = useState<string | null>(null);

  // Custom hooks
  const { roadmap, competitorAnalysis, generationStatus } = useRoadmapData(projectId);
  const { convertFeatureToSpec } = useFeatureActions();
  const { saveRoadmap } = useRoadmapSave(projectId);
  const { deleteFeature, deleteFeatures } = useFeatureDelete(projectId);
  const [showClearOpen, setShowClearOpen] = useState(false);
  const {
    showCompetitorDialog,
    setShowCompetitorDialog,
    handleGenerate,
    handleRefresh,
    showGuidanceDialog,
    setShowGuidanceDialog,
    guidance,
    handleGuidanceConfirm,
    handleCompetitorDialogAccept,
    handleCompetitorDialogDecline,
    handleGoToCompetitors,
    handleStop,
  } = useRoadmapGeneration(projectId, onGoToCompetitors);

  // Event handlers
  const handleConvertToSpec = async (feature: RoadmapFeature) => {
    await convertFeatureToSpec(projectId, feature, selectedFeature, setSelectedFeature);
  };

  const handleGoToTask = (specId: string) => {
    if (onGoToTask) {
      onGoToTask(specId);
    }
  };

  const handleArchiveFeature = (featureId: string) => {
    setPendingArchiveFeatureId(featureId);
  };

  const handleAddToRoadmap = async (result: FeatureRefineResult) => {
    if (!roadmap) return;

    if (featureContext) {
      // Refining an existing feature — update it in-place
      updateFeatureInStore(featureContext.id, {
        title: result.title,
        description: result.description,
        rationale: result.prd,
        acceptanceCriteria: result.acceptanceCriteria,
        userStories: result.userStories,
      });
      // Keep the panel's selected feature in sync
      if (selectedFeature?.id === featureContext.id) {
        setSelectedFeature((prev) =>
          prev
            ? {
                ...prev,
                title: result.title,
                description: result.description,
                rationale: result.prd,
                acceptanceCriteria: result.acceptanceCriteria,
                userStories: result.userStories,
              }
            : prev,
        );
      }
    } else {
      // Creating a new feature
      const firstPhaseId = roadmap.phases[0]?.id ?? '';
      addFeatureToStore({
        title: result.title,
        description: result.description,
        rationale: result.prd,
        priority: 'should',
        complexity: 'medium',
        impact: 'medium',
        phaseId: firstPhaseId,
        dependencies: [],
        status: 'planned',
        acceptanceCriteria: result.acceptanceCriteria,
        userStories: result.userStories,
      });
    }

    await saveRoadmap();
    closeRefine();
  };

  const handleRefineExistingFeature = (feature: RoadmapFeature) => {
    openRefine(projectId, undefined, feature);
  };

  // After adding: open the new feature and bring its card into view on the board
  const openAddedFeature = (featureId: string) => {
    const feature = useRoadmapStore.getState().roadmap?.features.find((f) => f.id === featureId);
    if (!feature) return;
    setSelectedFeature(feature);
    requestAnimationFrame(() => {
      const card = document.querySelector<HTMLElement>(`[data-feature-id="${CSS.escape(featureId)}"]`);
      if (!card) return;
      card.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      card.classList.add('ring-2', 'ring-primary', 'rounded-lg');
      setTimeout(() => card.classList.remove('ring-2', 'ring-primary', 'rounded-lg'), 2500);
    });
  };

  const confirmArchiveFeature = async () => {
    if (!pendingArchiveFeatureId) return;
    try {
      await deleteFeature(pendingArchiveFeatureId);
      if (selectedFeature?.id === pendingArchiveFeatureId) {
        setSelectedFeature(null);
      }
    } finally {
      setPendingArchiveFeatureId(null);
    }
  };

  // Dismissed ones stay: they steer future generations
  const openFeatures = roadmap?.features.filter((f) => f.status !== 'done' && f.status !== 'dismissed') ?? [];
  const confirmClearOpen = async () => {
    const ids = openFeatures.map((f) => f.id);
    setShowClearOpen(false);
    if (selectedFeature && ids.includes(selectedFeature.id)) setSelectedFeature(null);
    await deleteFeatures(ids);
  };

  // Show generation progress
  if (generationStatus.phase !== 'idle' && generationStatus.phase !== 'complete') {
    return (
      <div className="flex h-full items-center justify-center">
        <RoadmapGenerationProgress
          generationStatus={generationStatus}
          className="w-full max-w-md"
          onStop={handleStop}
        />
      </div>
    );
  }

  // Show empty state
  if (!roadmap) {
    return (
      <>
        <div className="relative h-full">
          <div className="absolute left-0 right-0 top-0 z-10 flex justify-center p-3">
            <StrategyGuidanceChip projectId={projectId} onClick={onGoToCompetitors} />
          </div>
          <RoadmapEmptyState onGenerate={handleGenerate} />
        </div>
        {/* Dialog for projects WITHOUT existing competitor analysis */}
        <CompetitorAnalysisDialog
          open={showCompetitorDialog}
          onOpenChange={setShowCompetitorDialog}
          onAccept={handleCompetitorDialogAccept}
          onDecline={handleCompetitorDialogDecline}
          onGoToCompetitors={onGoToCompetitors ? handleGoToCompetitors : undefined}
          projectId={projectId}
        />
      </>
    );
  }

  // Main roadmap view
  return (
    <div className={PAGE_ROOT}>
      {/* Funnel handoff from Plan → Competitors */}
      <StrategyGuidanceBar projectId={projectId} onClick={onGoToCompetitors} />

      {/* Header */}
      <RoadmapHeader
        roadmap={roadmap}
        competitorAnalysis={competitorAnalysis}
        onAddFeature={() => setShowAddFeatureDialog(true)}
        onRefresh={handleRefresh}
        onViewCompetitorAnalysis={() => setShowCompetitorViewer(true)}
        onRefineFeature={() => openRefine(projectId)}
        onClearOpen={() => setShowClearOpen(true)}
      />

      {/* Content: tab row stays pinned on phones, the rest scrolls with the page */}
      <div className={cn(PAGE_BODY, 'flex flex-col overflow-hidden max-md:overflow-visible')}>
        <RoadmapTabs
          roadmap={roadmap}
          projectId={projectId}
          onGoToCompetitors={onGoToCompetitors}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onFeatureSelect={setSelectedFeature}
          onConvertToSpec={handleConvertToSpec}
          onGoToTask={handleGoToTask}
          onSave={saveRoadmap}
          onArchive={handleArchiveFeature}
        />
      </div>

      {/* Refine Feature Panel */}
      {isRefineOpen && (
        <RefineFeaturePanel
          projectId={projectId}
          onAddToRoadmap={handleAddToRoadmap}
          onClose={closeRefine}
        />
      )}

      {/* Feature Detail Panel (modal; hidden while the non-modal Refine panel is open so that stays usable) */}
      {selectedFeature && !isRefineOpen && (
        <FeatureDetailPanel
          feature={selectedFeature}
          onClose={() => setSelectedFeature(null)}
          onConvertToSpec={handleConvertToSpec}
          onGoToTask={handleGoToTask}
          onRefine={handleRefineExistingFeature}
          onDelete={deleteFeature}
          onArchive={handleArchiveFeature}
          competitorInsights={getCompetitorInsightsForFeature(selectedFeature, competitorAnalysis)}
        />
      )}

      {/* Regenerate: optional direction, then the competitor-analysis choice */}
      <RegenerateGuidanceDialog
        open={showGuidanceDialog}
        onOpenChange={setShowGuidanceDialog}
        initialGuidance={guidance}
        onConfirm={handleGuidanceConfirm}
      />

      {/* Competitor Analysis Permission Dialog (no existing analysis) */}
      <CompetitorAnalysisDialog
        open={showCompetitorDialog}
        onOpenChange={setShowCompetitorDialog}
        onAccept={handleCompetitorDialogAccept}
        onDecline={handleCompetitorDialogDecline}
        onGoToCompetitors={onGoToCompetitors ? handleGoToCompetitors : undefined}
        projectId={projectId}
      />

      {/* Competitor Analysis Viewer */}
      <CompetitorAnalysisViewer
        analysis={competitorAnalysis}
        open={showCompetitorViewer}
        onOpenChange={setShowCompetitorViewer}
        projectId={projectId}
      />

      {/* Add Feature Dialog */}
      <AddFeatureDialog
        phases={roadmap.phases}
        open={showAddFeatureDialog}
        onOpenChange={setShowAddFeatureDialog}
        onOpenFeature={openAddedFeature}
      />

      {/* Clear open features confirmation */}
      <AlertDialog open={showClearOpen} onOpenChange={setShowClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              <AlertDialogTitle>{t('roadmap.clearOpen.title', { count: openFeatures.length })}</AlertDialogTitle>
            </div>
            <AlertDialogDescription>
              {t('roadmap.clearOpen.description', {
                done: roadmap.features.filter((f) => f.status === 'done').length,
                inProgress: openFeatures.filter((f) => f.status === 'in_progress').length
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('buttons.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmClearOpen}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('roadmap.clearOpen.confirm', { count: openFeatures.length })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Archive Confirmation Dialog */}
      <AlertDialog
        open={!!pendingArchiveFeatureId}
        onOpenChange={(open) => { if (!open) setPendingArchiveFeatureId(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-center gap-2">
              <Archive className="h-5 w-5 text-muted-foreground" />
              <AlertDialogTitle>{t('roadmap.archiveFeatureConfirmTitle')}</AlertDialogTitle>
            </div>
            <AlertDialogDescription>
              {t('roadmap.archiveFeatureConfirmDescription', {
                title: pendingArchiveFeatureId
                  ? roadmap.features.find((f) => f.id === pendingArchiveFeatureId)?.title ?? ''
                  : '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('buttons.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmArchiveFeature}>
              {t('roadmap.archiveFeature')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
