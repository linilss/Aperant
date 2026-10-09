import { useEffect, useState } from 'react';
import { useRoadmapStore, loadRoadmap, generateRoadmap, refreshRoadmap, stopRoadmap } from '../../stores/roadmap-store';
import { useTaskStore } from '../../stores/task-store';
import { loadCompetitors, useCompetitorStore } from '../../stores/competitor-store';
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

  return { deleteFeature: handleDeleteFeature };
}


/**
 * Hook to manage roadmap generation as a step of the Plan funnel.
 *
 * Competitor analysis lives on the Competitors page (Competitors → Roadmap → MoSCoW).
 * When it has analyzed competitors, the roadmap reuses that analysis and the saved
 * direction ranking without asking. Otherwise a dialog offers to go there first or to
 * generate without competitor analysis.
 */
export function useRoadmapGeneration(projectId: string, onGoToCompetitors?: () => void) {
  const roadmapAnalysis = useRoadmapStore((state) => state.competitorAnalysis);
  const competitorProjectId = useCompetitorStore((state) => state.projectId);
  const competitorData = useCompetitorStore((state) => state.data);
  const [pendingAction, setPendingAction] = useState<'generate' | 'refresh' | null>(null);
  const [showCompetitorDialog, setShowCompetitorDialog] = useState(false);
  const [showGuidanceDialog, setShowGuidanceDialog] = useState(false);
  // Kept after a regenerate so the next one starts from the last direction given
  const [guidance, setGuidance] = useState('');

  useEffect(() => {
    void loadCompetitors(projectId);
  }, [projectId]);

  const hasPageAnalysis =
    competitorProjectId === projectId && (competitorData?.competitors.some((c) => c.analyzed) ?? false);
  const hasExistingAnalysis = hasPageAnalysis || !!roadmapAnalysis;

  const run = (action: 'generate' | 'refresh', withCompetitors: boolean, text = guidance) => {
    // refreshCompetitorAnalysis=false: reuse the Competitors page analysis
    if (action === 'generate') {
      generateRoadmap(projectId, withCompetitors, false);
    } else {
      refreshRoadmap(projectId, withCompetitors, false, text);
    }
  };

  const startOrAsk = (action: 'generate' | 'refresh', text?: string) => {
    if (hasExistingAnalysis) {
      run(action, true, text);
    } else {
      setPendingAction(action);
      setShowCompetitorDialog(true);
    }
  };

  const handleGenerate = () => startOrAsk('generate');

  // Regenerate first asks for optional direction, then continues as generate
  const handleRefresh = () => {
    setShowGuidanceDialog(true);
  };

  const handleGuidanceConfirm = (text: string) => {
    setGuidance(text);
    setShowGuidanceDialog(false);
    startOrAsk('refresh', text);
  };

  // "Go to Competitors": run the funnel step first
  const handleCompetitorDialogAccept = () => {
    setPendingAction(null);
    if (onGoToCompetitors) {
      onGoToCompetitors();
    } else if (pendingAction) {
      run(pendingAction, true);
    }
  };

  // "Generate without"
  const handleCompetitorDialogDecline = () => {
    if (pendingAction) run(pendingAction, false);
    setPendingAction(null);
  };

  const handleStop = async () => {
    await stopRoadmap(projectId);
  };

  return {
    pendingAction,
    hasExistingAnalysis,
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
    handleStop,
  };
}
