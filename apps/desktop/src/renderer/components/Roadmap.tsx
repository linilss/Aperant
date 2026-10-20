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
import { deleteMultipleIdeasForProject, loadIdeation, useIdeationStore } from '../stores/ideation-store';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import type { FeatureRefineResult } from '../stores/feature-refine-store';
import type { RoadmapFeature } from '../../shared/types';
import type { RoadmapProps } from './roadmap/types';
import { PAGE_ROOT, PAGE_BODY } from './ui/page-header';

export function Roadmap({ projectId, onGoToTask, onGoToCompetitors, initialTab, tabRequestId, onOpenIdeaSettings }: RoadmapProps) {
  const { t } = useTranslation('common');

  // Feature Refine session store
  const { isOpen: isRefineOpen, open: openRefine, close: closeRefine, featureContext } = useFeatureRefineStore();
  const { addFeature: addFeatureToStore, updateFeature: updateFeatureInStore } = useRoadmapStore();

  // State management
  const [selectedFeature, setSelectedFeature] = useState<RoadmapFeature | null>(null);
  const [activeTab, setActiveTab] = useState(initialTab && initialTab !== 'kanban' ? initialTab : 'features');

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

  // Backlog items without a task: open ones, plus dismissed ones and ideas for a full reset.
  // Features with a task (on the Board or done) always stay.
  const ideationSession = useIdeationStore((st) => st.session);
  const ideationProjectId = useIdeationStore((st) => st.currentProjectId);
  const allIdeas = ideationProjectId === projectId ? (ideationSession?.ideas ?? []) : [];
  const openIdeas = allIdeas.filter((i) => i.status !== 'dismissed' && i.status !== 'converted' && i.status !== 'archived' && !i.roadmapFeatureId);
  const openFeatures = roadmap?.features.filter((f) => !f.linkedSpecId && f.status !== 'done' && f.status !== 'dismissed') ?? [];
  const resetFeatures = roadmap?.features.filter((f) => !f.linkedSpecId && f.status !== 'done') ?? [];
  useEffect(() => {
    if (useIdeationStore.getState().currentProjectId !== projectId) void loadIdeation(projectId);
  }, [projectId]);
  const clearBacklog = async (mode: 'open' | 'reset') => {
    const features = mode === 'reset' ? resetFeatures : openFeatures;
    const ideas = mode === 'reset' ? allIdeas : openIdeas;
    const ids = features.map((f) => f.id);
    setShowClearOpen(false);
    if (selectedFeature && ids.includes(selectedFeature.id)) setSelectedFeature(null);
    if (ids.length > 0) await deleteFeatures(ids);
    if (ideas.length > 0) await deleteMultipleIdeasForProject(projectId, ideas.map((i) => i.id));
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
      <div className={cn(PAGE_BODY, 'flex flex-col overflow-hidden pagescroll:overflow-visible')}>
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
          onOpenIdeaSettings={onOpenIdeaSettings}
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
              <AlertDialogTitle>{t('roadmap.clearOpen.title')}</AlertDialogTitle>
            </div>
            <AlertDialogDescription>{t('roadmap.clearOpen.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Button
              variant="outline"
              className="h-auto w-full justify-start whitespace-normal py-3 text-left"
              disabled={openFeatures.length + openIdeas.length === 0}
              onClick={() => void clearBacklog('open')}
            >
              <div>
                <div className="font-medium">
                  {t('roadmap.clearOpen.open', { features: openFeatures.length, ideas: openIdeas.length })}
                </div>
                <div className="text-xs text-muted-foreground">{t('roadmap.clearOpen.openHint')}</div>
              </div>
            </Button>
            <Button
              variant="outline"
              className="h-auto w-full justify-start whitespace-normal border-destructive/40 py-3 text-left text-destructive hover:text-destructive"
              disabled={resetFeatures.length + allIdeas.length === 0}
              onClick={() => void clearBacklog('reset')}
            >
              <div>
                <div className="font-medium">
                  {t('roadmap.clearOpen.reset', { features: resetFeatures.length, ideas: allIdeas.length })}
                </div>
                <div className="text-xs text-muted-foreground">{t('roadmap.clearOpen.resetHint')}</div>
              </div>
            </Button>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('buttons.cancel')}</AlertDialogCancel>
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
