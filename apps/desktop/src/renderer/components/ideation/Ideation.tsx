import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TabsContent } from '../ui/tabs';
import { IDEATION_TYPE_DESCRIPTIONS } from '../../../shared/constants';
import { IdeationEmptyState } from './IdeationEmptyState';
import { IdeationHeader } from './IdeationHeader';
import { IdeationFilters } from './IdeationFilters';
import { IdeationDialogs } from './IdeationDialogs';
import { GenerationProgressScreen } from './GenerationProgressScreen';
import { IdeaCard } from './IdeaCard';
import { IdeaDetailPanel } from './IdeaDetailPanel';
import { useIdeation } from './hooks/useIdeation';
import { useViewState } from '../../contexts/ViewStateContext';
import { ALL_IDEATION_TYPES } from './constants';
import { StrategyGuidanceBar, StrategyGuidanceChip } from '../competitors/StrategyGuidanceChip';
import { useProjectDirections } from '../competitors/DirectionTagChips';
import { DirectionFilterBar } from '../competitors/DirectionFilterBar';
import { filterFeaturesByDirection, hasDirectionTagging } from '../moscow/direction-filter';
import { loadCompetitors } from '../../stores/competitor-store';
import { useAddIdeaToRoadmap } from './hooks/useAddIdeaToRoadmap';
import type { Idea } from '../../../shared/types';

const NO_IDEAS: Idea[] = [];

interface IdeationProps {
  projectId: string;
  onGoToTask?: (taskId: string) => void;
  /** Back to Plan → Competitors (from the "Guided by" chip) */
  onGoToCompetitors?: () => void;
  /** Plan → MoSCoW (after "Add to roadmap") */
  onGoToMoscow?: () => void;
}

export function Ideation({ projectId, onGoToTask, onGoToCompetitors, onGoToMoscow }: IdeationProps) {
  const { t } = useTranslation('common');
  // Get showArchived from shared context for cross-page sync
  const { showArchived } = useViewState();

  // Pass showArchived directly to the hook to avoid render lag from useEffect sync
  const {
    session,
    generationStatus,
    isGenerating,
    config,
    logs,
    typeStates,
    selectedIdea,
    activeTab,
    showConfigDialog,
    showDismissed,
    showAddMoreDialog,
    typesToAdd,
    hasToken,
    isCheckingToken,
    summary,
    activeIdeas,
    selectedIds,
    convertingIdeas,
    setSelectedIdea,
    setActiveTab,
    setShowConfigDialog,
    setShowDismissed,
    setShowAddMoreDialog,
    setTypesToAdd,
    setConfig,
    handleGenerate,
    handleRefresh,
    handleStop,
    handleDismissAll,
    handleDeleteSelected,
    handleSelectAll,
    getAvailableTypesToAdd,
    handleAddMoreIdeas,
    toggleTypeToAdd,
    handleConvertToTask,
    handleGoToTask,
    handleDismiss,
    toggleIdeationType,
    toggleSelectIdea,
    clearSelection,
    getIdeasByType
  } = useIdeation(projectId, { onGoToTask, showArchived });

  const { handleAddToRoadmap, addingIdeas } = useAddIdeaToRoadmap(projectId, onGoToMoscow);

  // Direction tags + filter (directions come from the Competitors ranking)
  /** Selected direction ids / UNTAGGED_FILTER; empty = all directions */
  const [directionFilter, setDirectionFilter] = useState<string[]>([]);
  const directions = useProjectDirections(projectId);
  useEffect(() => {
    void loadCompetitors(projectId);
    setDirectionFilter([]);
  }, [projectId]);
  const allIdeas = session?.ideas ?? NO_IDEAS;
  const isDirectionTagged = useMemo(() => hasDirectionTagging(allIdeas), [allIdeas]);
  const filterActive = isDirectionTagged && directions.length > 0;
  const byDirection = (ideas: Idea[]) =>
    filterActive ? filterFeaturesByDirection(ideas, directionFilter, directions) : ideas;
  const visibleIdeas = byDirection(activeIdeas);
  // Fresh copy from the store so the panel reflects conversions made while it is open
  const panelIdea = selectedIdea ? (allIdeas.find((i) => i.id === selectedIdea.id) ?? selectedIdea) : null;

  // Show generation progress with streaming ideas (use isGenerating flag for reliable state)
  if (isGenerating) {
    return (
      <GenerationProgressScreen
        generationStatus={generationStatus}
        logs={logs}
        typeStates={typeStates}
        enabledTypes={config.enabledTypes}
        session={session}
        onSelectIdea={setSelectedIdea}
        selectedIdea={selectedIdea}
        onConvert={handleConvertToTask}
        onGoToTask={handleGoToTask}
        onDismiss={handleDismiss}
        onStop={handleStop}
      />
    );
  }

  // Show empty state only when no session exists (first run)
  if (!session) {
    return (
      <>
        <div className="relative h-full">
          <div className="absolute left-0 right-0 top-0 z-10 flex justify-center p-3">
            <StrategyGuidanceChip projectId={projectId} onClick={onGoToCompetitors} />
          </div>
          <IdeationEmptyState
            config={config}
            hasToken={hasToken}
            isCheckingToken={isCheckingToken}
            onGenerate={handleGenerate}
            onOpenConfig={() => setShowConfigDialog(true)}
            onToggleIdeationType={toggleIdeationType}
          />
        </div>

        <IdeationDialogs
          showConfigDialog={showConfigDialog}
          showAddMoreDialog={false}
          config={config}
          typesToAdd={[]}
          availableTypesToAdd={[]}
          onToggleIdeationType={toggleIdeationType}
          onToggleTypeToAdd={() => {}}
          onSetConfig={setConfig}
          onCloseConfigDialog={() => setShowConfigDialog(false)}
          onCloseAddMoreDialog={() => {}}
          onConfirmAddMore={() => {}}
        />
      </>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Funnel handoff from Plan → Competitors */}
      <StrategyGuidanceBar projectId={projectId} onClick={onGoToCompetitors} />

      {/* Header */}
      <IdeationHeader
        totalIdeas={summary.totalIdeas}
        ideaCountByType={summary.byType}
        showDismissed={showDismissed}
        selectedCount={selectedIds.size}
        onToggleShowDismissed={() => setShowDismissed(!showDismissed)}
        onOpenConfig={() => setShowConfigDialog(true)}
        onOpenAddMore={() => {
          setTypesToAdd([]);
          setShowAddMoreDialog(true);
        }}
        onDismissAll={handleDismissAll}
        onDeleteSelected={handleDeleteSelected}
        onSelectAll={() => handleSelectAll(activeIdeas)}
        onClearSelection={clearSelection}
        onRefresh={handleRefresh}
        hasActiveIdeas={activeIdeas.length > 0}
        canAddMore={getAvailableTypesToAdd().length > 0}
      />

      <DirectionFilterBar
        directions={directions}
        selected={directionFilter}
        onChange={setDirectionFilter}
        isTagged={isDirectionTagged}
        untaggedHint={t('ideation.directions.untaggedHint')}
        ariaLabel={t('ideation.directions.filterLabel')}
        className="border-b border-border px-4 py-2"
      />

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <IdeationFilters activeTab={activeTab} onTabChange={setActiveTab}>
          {/* All Ideas View */}
          <TabsContent value="all" className="flex-1 overflow-auto p-4">
            <div className="grid gap-3">
              {visibleIdeas.map((idea) => (
                <IdeaCard
                  key={idea.id}
                  idea={idea}
                  isSelected={selectedIds.has(idea.id)}
                  onClick={() => setSelectedIdea(selectedIdea?.id === idea.id ? null : idea)}
                  onConvert={handleConvertToTask}
                  onGoToTask={handleGoToTask}
                  onDismiss={handleDismiss}
                  onToggleSelect={toggleSelectIdea}
                  onAddToRoadmap={handleAddToRoadmap}
                  onGoToMoscow={onGoToMoscow}
                  projectId={projectId}
                />
              ))}
              {visibleIdeas.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  {t('ideation.noIdeasToDisplay')}
                </div>
              )}
            </div>
          </TabsContent>

          {/* Type-specific Views */}
          {ALL_IDEATION_TYPES.map((type) => {
            const typeIdeas = byDirection(
              getIdeasByType(type).filter((idea) => {
                if (!showDismissed && idea.status === 'dismissed') return false;
                if (!showArchived && idea.status === 'archived') return false;
                return true;
              })
            );
            return (
              <TabsContent key={type} value={type} className="flex-1 overflow-auto p-4">
                <div className="mb-4 p-3 bg-muted/50 rounded-lg">
                  <p className="text-sm text-muted-foreground">
                    {IDEATION_TYPE_DESCRIPTIONS[type]}
                  </p>
                </div>
                <div className="grid gap-3">
                  {typeIdeas.map((idea) => (
                    <IdeaCard
                      key={idea.id}
                      idea={idea}
                      isSelected={selectedIds.has(idea.id)}
                      onClick={() => setSelectedIdea(selectedIdea?.id === idea.id ? null : idea)}
                      onConvert={handleConvertToTask}
                      onGoToTask={handleGoToTask}
                      onDismiss={handleDismiss}
                      onToggleSelect={toggleSelectIdea}
                      onAddToRoadmap={handleAddToRoadmap}
                      onGoToMoscow={onGoToMoscow}
                      projectId={projectId}
                    />
                  ))}
                </div>
              </TabsContent>
            );
          })}
        </IdeationFilters>
      </div>

      {/* Idea Detail Panel */}
      {panelIdea && (
        <IdeaDetailPanel
          idea={panelIdea}
          onClose={() => setSelectedIdea(null)}
          onConvert={handleConvertToTask}
          onGoToTask={handleGoToTask}
          onDismiss={handleDismiss}
          isConverting={convertingIdeas.has(panelIdea.id)}
          onAddToRoadmap={handleAddToRoadmap}
          isAddingToRoadmap={addingIdeas.has(panelIdea.id)}
          onGoToMoscow={onGoToMoscow}
          projectId={projectId}
        />
      )}

      {/* Dialogs */}
      <IdeationDialogs
        showConfigDialog={showConfigDialog}
        showAddMoreDialog={showAddMoreDialog}
        config={config}
        typesToAdd={typesToAdd}
        availableTypesToAdd={getAvailableTypesToAdd()}
        onToggleIdeationType={toggleIdeationType}
        onToggleTypeToAdd={toggleTypeToAdd}
        onSetConfig={setConfig}
        onCloseConfigDialog={() => setShowConfigDialog(false)}
        onCloseAddMoreDialog={() => setShowAddMoreDialog(false)}
        onConfirmAddMore={handleAddMoreIdeas}
      />
    </div>
  );
}
