import { useEffect, useState } from 'react';
import { useRoadmapStore, loadRoadmap, generateRoadmap, refreshRoadmap, stopRoadmap } from '../../stores/roadmap-store';
import { useTaskStore } from '../../stores/task-store';
import { loadCompetitors } from '../../stores/competitor-store';
import type { RoadmapFeature } from '../../../shared/types';

/**
 * Hook to manage roadmap data and loading
 *
 * When the projectId changes, this hook:
 * 1. Loads the new project's roadmap data
 * 2. Queries the backend to check if generation is running for this project
 * 3. Restores the generation status UI state accordingly
 *
 * NOTE: Generation continues in the background when switching projects.
 * The loadRoadmap function queries the backend to restore the correct UI state.
 */
export function useRoadmapData(projectId: string) {
  const roadmap = useRoadmapStore((state) => state.roadmap);
  const competitorAnalysis = useRoadmapStore((state) => state.competitorAnalysis);
  const generationStatus = useRoadmapStore((state) => state.generationStatus);

  useEffect(() => {
    // Load roadmap data and query generation status for this project
    // The loadRoadmap function handles checking if generation is running
    // and restores the UI state accordingly
    loadRoadmap(projectId);
  }, [projectId]);

  return {
    roadmap,
    competitorAnalysis,
    generationStatus,
  };
}

/**
 * Hook to manage feature actions (convert, link, etc.)
 */
export function useFeatureActions() {
  const updateFeatureLinkedSpec = useRoadmapStore((state) => state.updateFeatureLinkedSpec);
  const addTask = useTaskStore((state) => state.addTask);

  const convertFeatureToSpec = async (
    projectId: string,
    feature: RoadmapFeature,
    selectedFeature: RoadmapFeature | null,
    setSelectedFeature: (feature: RoadmapFeature | null) => void
  ) => {
    const result = await window.electronAPI.convertFeatureToSpec(projectId, feature.id);
    if (result.success && result.data) {
      // Add the created task to the task store so it appears in the kanban immediately
      addTask(result.data);

      // Update the roadmap feature with the linked spec
      updateFeatureLinkedSpec(feature.id, result.data.specId);
      if (selectedFeature?.id === feature.id) {
        setSelectedFeature({
          ...feature,
          linkedSpecId: result.data.specId,
          status: 'in_progress',
        });
      }
    }
  };

  return {
    convertFeatureToSpec,
  };
}

/**
 * Hook to save roadmap changes to disk
 *
 * NOTE: Gets roadmap from store at call time (not render time) to ensure
 * we save the latest state after Zustand updates (e.g., after drag-drop status change)
 */
export function useRoadmapSave(projectId: string) {
  const saveRoadmap = async () => {
    // Get current state at call time to avoid stale closure issues
    const roadmap = useRoadmapStore.getState().roadmap;
    if (!roadmap) return;

    try {
      await window.electronAPI.saveRoadmap(projectId, roadmap);
    } catch (error) {
      console.error('Failed to save roadmap:', error);
    }
  };

  return { saveRoadmap };
}

/**
 * Hook to delete features from roadmap
 */
export function useFeatureDelete(projectId: string) {
  const deleteFeature = useRoadmapStore((state) => state.deleteFeature);

  const handleDeleteFeature = async (featureId: string) => {
    // Delete from store
    deleteFeature(featureId);

    // Persist to file
    const roadmap = useRoadmapStore.getState().roadmap;
    if (roadmap) {
      try {
        await window.electronAPI.saveRoadmap(projectId, roadmap);
      } catch (error) {
        console.error('Failed to save roadmap after delete:', error);
      }
    }
  };

  /** Delete several features and save once */
  const handleDeleteFeatures = async (featureIds: string[]) => {
    for (const id of featureIds) deleteFeature(id);
    const roadmap = useRoadmapStore.getState().roadmap;
    if (roadmap) {
      await window.electronAPI.saveRoadmap(projectId, roadmap);
    }
  };

  return { deleteFeature: handleDeleteFeature, deleteFeatures: handleDeleteFeatures };
}


/**
 * Hook to manage roadmap generation as a step of the Plan funnel.
 *
 * Competitor analysis lives on the Competitors page (Competitors → Roadmap → MoSCoW).
 * Generate/Regenerate always open a dialog first: with an analysis it previews the
 * competitors and ranked directions the roadmap will follow; without one it offers to
 * run it now — the roadmap's competitor phase uses the Competitors pipeline, so the
 * result is saved back to the Competitors page.
 */
export function useRoadmapGeneration(projectId: string, onGoToCompetitors?: () => void) {
  const [pendingAction, setPendingAction] = useState<'generate' | 'refresh' | null>(null);
  const [showCompetitorDialog, setShowCompetitorDialog] = useState(false);
  const [showGuidanceDialog, setShowGuidanceDialog] = useState(false);
  // Kept after a regenerate so the next one starts from the last direction given
  const [guidance, setGuidance] = useState('');

  useEffect(() => {
    void loadCompetitors(projectId);
  }, [projectId]);

  const run = (action: 'generate' | 'refresh', withCompetitors: boolean) => {
    // refreshCompetitorAnalysis=false: reuse an existing analysis, run one only if missing
    if (action === 'generate') {
      generateRoadmap(projectId, withCompetitors, false);
    } else {
      refreshRoadmap(projectId, withCompetitors, false, guidance);
    }
  };

  const openPreview = (action: 'generate' | 'refresh') => {
    setPendingAction(action);
    // Fresh state so the preview shows the latest ranking from the Competitors page
    void loadCompetitors(projectId, { force: true });
    setShowCompetitorDialog(true);
  };

  const handleGenerate = () => openPreview('generate');

  // Regenerate first asks for optional direction, then continues as generate
  const handleRefresh = () => {
    setShowGuidanceDialog(true);
  };

  const handleGuidanceConfirm = (text: string) => {
    setGuidance(text);
    setShowGuidanceDialog(false);
    openPreview('refresh');
  };

  // "Generate roadmap" / "Analyze & generate"
  const handleCompetitorDialogAccept = () => {
    if (pendingAction) run(pendingAction, true);
    setPendingAction(null);
  };

  // "Generate without"
  const handleCompetitorDialogDecline = () => {
    if (pendingAction) run(pendingAction, false);
    setPendingAction(null);
  };

  // "Edit in Competitors" / "Open Competitors"
  const handleGoToCompetitors = () => {
    setPendingAction(null);
    onGoToCompetitors?.();
  };

  const handleStop = async () => {
    await stopRoadmap(projectId);
  };

  return {
    pendingAction,
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
  };
}
