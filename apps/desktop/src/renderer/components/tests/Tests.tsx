import { useEffect, useState } from 'react';
import { useTestsStore, loadSavedSolution, discoverProjects, runTests, stopTests, setupTestsListeners } from '../../stores/tests-store';
import { ScrollArea } from '../ui/scroll-area';
import { PAGE_BODY, PAGE_ROOT, PAGE_STICKY } from '../ui/page-header';
import { cn } from '../../lib/utils';
import { MobileBackBar } from '../MobileNav';
import { useIsMobile } from '../../hooks/useIsMobile';
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

  // Phone: tree and results are shown one at a time (list → detail)
  const isMobile = useIsMobile();
  const [showMobileResults, setShowMobileResults] = useState(false);

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
    setShowMobileResults(true);
  };

  return (
    <div className={PAGE_ROOT}>
      <TestsHeader
        isRunning={isRunning}
        isLoading={isLoading}
        projects={projects}
        selectedProjectId={selectedProjectId}
        onDiscover={handleDiscover}
        onRunAll={handleRunAll}
        onStop={handleStop}
      />

      {projects.length === 0 ? (
        <TestsEmptyState onDiscover={handleDiscover} isLoading={isLoading} />
      ) : (
        <div className={cn(PAGE_BODY, 'flex overflow-hidden max-md:overflow-visible')}>
          {/* Left panel: project tree */}
          <div className={isMobile ? (showMobileResults ? 'hidden' : 'flex-1') : 'w-64 shrink-0 border-r border-border'}>
            <ScrollArea className="h-full max-md:h-auto">
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
          <div className={isMobile ? (showMobileResults ? 'flex min-w-0 flex-1 flex-col' : 'hidden') : 'min-w-0 flex-1 overflow-hidden'}>
            {isMobile && (
              <div className={PAGE_STICKY}>
                <MobileBackBar onBack={() => setShowMobileResults(false)} title={selectedProject?.name} />
              </div>
            )}
            <div className={isMobile ? undefined : 'h-full'}>
              <TestsResults
                project={selectedProject}
                selectedCategory={selectedCategory}
                runningTestId={runningTestId}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
