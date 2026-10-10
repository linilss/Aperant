import { useState, useEffect, useMemo, useCallback } from 'react';
import { FolderTree, Brain, BookOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
        <div className="border-b border-border px-6 py-3 max-md:px-4">
          <TabsList className="grid w-full max-w-lg grid-cols-3">
            <TabsTrigger value="index" className="gap-2">
              <FolderTree className="h-4 w-4" />
              {t('common:context.tabs.projectIndex')}
            </TabsTrigger>
            <TabsTrigger value="docs" className="gap-2">
              <BookOpen className="h-4 w-4" />
              {t('context:tabs.docs')}
            </TabsTrigger>
            <TabsTrigger value="memories" className="gap-2">
              <Brain className="h-4 w-4" />
              {t('common:context.tabs.memories')}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Project Index Tab */}
        <TabsContent value="index" className="flex-1 overflow-hidden m-0">
          <ProjectIndexTab
            projectId={projectId}
            onOpenDoc={handleOpenDoc}
            onReview={handleReview}
            projectIndex={projectIndex}
            indexLoading={indexLoading}
            indexError={indexError}
            onRefresh={handleRefreshIndex}
            docsSummary={docsSummary}
          />
        </TabsContent>

        {/* Docs Tab */}
        <TabsContent value="docs" className="flex-1 overflow-hidden m-0">
          <DocsTab projectId={projectId} focus={docFocus} />
        </TabsContent>

        {/* Memories Tab */}
        <TabsContent value="memories" className="flex-1 overflow-hidden m-0">
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
