import { useState, useEffect, useMemo, useCallback } from 'react';
import { FolderTree, Brain, BookOpen, Library } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { PageHeader, PAGE_ROOT, PAGE_BODY, PAGE_STICKY } from '../ui/page-header';
import { cn } from '../../lib/utils';
import {
  useContextStore,
  verifyMemory,
  pinMemory,
  deprecateMemory,
  loadDocs,
  loadPointers,
  loadBranches,
  loadProjectSummary,
  loadPendingDocsRun
} from '../../stores/context-store';
import { useProjectContext, useRefreshIndex, useMemorySearch } from './hooks';
import { ProjectIndexTab } from './ProjectIndexTab';
import { MemoriesTab } from './MemoriesTab';
import { DocsTab, type DocFocus } from './docs/DocsTab';
import type { BranchProgressEvent, DocPointer, DocsOptimizerResult } from '../../../shared/types';
import type { ContextProps } from './types';

export function Context({ projectId }: ContextProps) {
  const { t } = useTranslation(['common', 'context']);
  const {
    projectIndex,
    indexLoading,
    indexError,
    memoryStatus,
    memoryState,
    recentMemories,
    memoriesLoading,
    searchResults,
    searchLoading,
    docs,
    pointers,
    lastOptimizedAt
  } = useContextStore();

  const [activeTab, setActiveTab] = useState('index');
  const [docFocus, setDocFocus] = useState<DocFocus | null>(null);

  // Custom hooks
  useProjectContext(projectId);
  const handleRefreshIndex = useRefreshIndex(projectId);
  const handleSearch = useMemorySearch(projectId);

  const handleVerify = async (memoryId: string) => {
    await verifyMemory(memoryId);
  };

  const handlePin = async (memoryId: string, pinned: boolean) => {
    await pinMemory(memoryId, pinned);
  };

  const handleDeprecate = async (memoryId: string) => {
    await deprecateMemory(memoryId);
  };

  // Load docs tree, pointers, code branches and project summary for the project
  useEffect(() => {
    void loadDocs(projectId);
    void loadPointers(projectId);
    void loadBranches(projectId);
    void loadProjectSummary(projectId);
    void loadPendingDocsRun(projectId);
  }, [projectId]);

  // Docs optimizer events (registered here so they survive tab switches)
  useEffect(() => {
    const store = useContextStore.getState;
    const unsubChunk = window.electronAPI.onDocsOptimizerChunk((incomingProjectId: string, chunk: string) => {
      if (incomingProjectId === projectId) store().appendOptimizerStream(chunk);
    });
    const unsubProgress = window.electronAPI.onDocsOptimizerBranchProgress(
      (incomingProjectId: string, progress: BranchProgressEvent) => {
        if (incomingProjectId === projectId) store().setBranchProgress(progress);
      }
    );
    const unsubComplete = window.electronAPI.onDocsOptimizerComplete(
      (incomingProjectId: string, result: DocsOptimizerResult) => {
        if (incomingProjectId === projectId) {
          store().setOptimizerResult(result);
          // Skipped branches were recorded in .meta.json — refresh their status
          void loadBranches(projectId);
        }
      }
    );
    const unsubError = window.electronAPI.onDocsOptimizerError((incomingProjectId: string, error: string) => {
      if (incomingProjectId === projectId) {
        store().setOptimizerError(error);
        store().setOptimizerRunning(false);
      }
    });
    return () => {
      unsubChunk();
      unsubProgress();
      unsubComplete();
      unsubError();
    };
  }, [projectId]);

  const handleOpenDoc = useCallback((docPath: string) => {
    setDocFocus({ path: docPath });
    setActiveTab('docs');
  }, []);

  const handleReview = useCallback(() => setActiveTab('docs'), []);

  const handleOpenPointer = useCallback((pointer: DocPointer) => {
    if (!pointer.docPath) return;
    setDocFocus({ path: pointer.docPath, heading: pointer.heading });
    setActiveTab('docs');
  }, []);

  const docsSummary = useMemo(() => {
    let date = t('context:summary.never');
    if (lastOptimizedAt) {
      try {
        date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
          new Date(lastOptimizedAt)
        );
      } catch {
        date = lastOptimizedAt;
      }
    }
    return t('context:summary.line', { docs: docs.length, pointers: pointers.length, date });
  }, [t, docs.length, pointers.length, lastOptimizedAt]);

  // Desktop: tab panels fill and scroll on their own. Phone: the page root scrolls, panels grow to content.
  const panelClass = cn(PAGE_BODY, 'm-0 overflow-hidden max-md:overflow-visible');

  return (
    <div className={PAGE_ROOT}>
      <PageHeader icon={Library} title={t('context:title')} subtitle={docsSummary} />
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col max-md:flex-none">
        <div className={cn(PAGE_STICKY, 'shrink-0 border-b border-border px-6 py-3 max-md:px-3 max-md:py-2')}>
          <TabsList className="flex w-full max-w-2xl justify-start overflow-x-auto [scrollbar-width:none] max-md:max-w-none max-md:h-12 [&::-webkit-scrollbar]:hidden">
            <TabsTrigger value="index" className="flex-1 shrink-0 gap-2 max-md:min-h-10 max-md:min-w-0 max-md:shrink max-md:gap-1 max-md:px-1.5 max-md:text-xs">
              <FolderTree className="h-4 w-4 shrink-0" />
              <span className="truncate max-md:hidden">{t('common:context.tabs.projectIndex')}</span>
              <span className="truncate md:hidden">{t('context:tabs.indexShort')}</span>
            </TabsTrigger>
            <TabsTrigger value="docs" className="flex-1 shrink-0 gap-2 max-md:min-h-10 max-md:min-w-0 max-md:shrink max-md:gap-1 max-md:px-1.5 max-md:text-xs">
              <BookOpen className="h-4 w-4 shrink-0" />
              <span className="truncate">{t('context:tabs.docs')}</span>
            </TabsTrigger>
            <TabsTrigger value="memories" className="flex-1 shrink-0 gap-2 max-md:min-h-10 max-md:min-w-0 max-md:shrink max-md:gap-1 max-md:px-1.5 max-md:text-xs">
              <Brain className="h-4 w-4 shrink-0" />
              <span className="truncate">{t('common:context.tabs.memories')}</span>
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Project Index Tab */}
        <TabsContent value="index" className={panelClass}>
          <ProjectIndexTab
            projectId={projectId}
            onOpenDoc={handleOpenDoc}
            onReview={handleReview}
            projectIndex={projectIndex}
            indexLoading={indexLoading}
            indexError={indexError}
            onRefresh={handleRefreshIndex}
          />
        </TabsContent>

        {/* Docs Tab */}
        <TabsContent value="docs" className={panelClass}>
          <DocsTab projectId={projectId} focus={docFocus} />
        </TabsContent>

        {/* Memories Tab */}
        <TabsContent value="memories" className={panelClass}>
          <MemoriesTab
            projectId={projectId}
            pointers={pointers}
            onOpenPointer={handleOpenPointer}
            memoryStatus={memoryStatus}
            memoryState={memoryState}
            recentMemories={recentMemories}
            memoriesLoading={memoriesLoading}
            searchResults={searchResults}
            searchLoading={searchLoading}
            onSearch={handleSearch}
            onVerify={handleVerify}
            onPin={handlePin}
            onDeprecate={handleDeprecate}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
