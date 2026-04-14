import { useEffect } from 'react';
import { useTestsStore, loadSavedSolution, discoverProjects, runTests, stopTests, setupTestsListeners } from '../../stores/tests-store';
import { ScrollArea } from '../ui/scroll-area';
import { TestsHeader } from './TestsHeader';
import { TestsTree } from './TestsTree';
import { TestsResults } from './TestsResults';
import { TestsEmptyState } from './TestsEmptyState';
import type { TestCategory } from '../../../shared/types/tests';

interface TestsProps {
  projectId: string;
}

export function Tests({ projectId }: TestsProps) {
  const projects = useTestsStore((state) => state.projects);
  const selectedProjectId = useTestsStore((state) => state.selectedProjectId);
  const selectedCategory = useTestsStore((state) => state.selectedCategory);
  const isRunning = useTestsStore((state) => state.isRunning);
  const isLoading = useTestsStore((state) => state.isLoading);
  const runningTestId = useTestsStore((state) => state.runningTestId);
  const setSelectedProjectId = useTestsStore((state) => state.setSelectedProjectId);
  const setSelectedCategory = useTestsStore((state) => state.setSelectedCategory);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;

  // Set up IPC listeners and load persisted results (without re-discovering)
  useEffect(() => {
    loadSavedSolution(projectId);
    const cleanup = setupTestsListeners(projectId);
    return cleanup;
  }, [projectId]);

  const handleDiscover = () => {
    discoverProjects(projectId);
  };

  const handleRunAll = () => {
    const cat = selectedCategory === 'all' ? undefined : selectedCategory;
    runTests(projectId, cat);
  };

  const handleStop = () => {
    if (selectedProjectId) {
      stopTests(projectId, selectedProjectId);
    }
  };

  const handleSelectCategory = (cat: TestCategory | 'all') => {
    setSelectedCategory(cat);
  };

  return (
    <div className="flex h-full flex-col">
      <TestsHeader
        isRunning={isRunning}
        isLoading={isLoading}
        hasProjects={projects.length > 0}
        selectedProjectId={selectedProjectId}
        onDiscover={handleDiscover}
        onRunAll={handleRunAll}
        onStop={handleStop}
      />

      {projects.length === 0 ? (
        <TestsEmptyState onDiscover={handleDiscover} isLoading={isLoading} />
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Left panel: project tree */}
          <div className="w-64 shrink-0 border-r border-border">
            <ScrollArea className="h-full">
              <TestsTree
                projects={projects}
                selectedProjectId={selectedProjectId}
                selectedCategory={selectedCategory}
                onSelectProject={setSelectedProjectId}
                onSelectCategory={handleSelectCategory}
              />
            </ScrollArea>
          </div>

          {/* Right panel: results */}
          <div className="flex-1 overflow-hidden">
            <TestsResults
              project={selectedProject}
              selectedCategory={selectedCategory}
              runningTestId={runningTestId}
            />
          </div>
        </div>
      )}
    </div>
  );
}
