import { useState, useEffect, useCallback } from 'react';
import { FolderTree, Brain, BookOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { useContextStore } from '../../stores/context-store';
import { verifyMemory, pinMemory, deprecateMemory } from '../../stores/context-store';
import { useProjectContext, useRefreshIndex, useMemorySearch } from './hooks';
import { ProjectIndexTab } from './ProjectIndexTab';
import { MemoriesTab } from './MemoriesTab';
import { DocumentationTab } from './DocumentationTab';
import type { ProjectDocumentation } from './DocumentationTab';
import type { ContextProps } from './types';

export function Context({ projectId }: ContextProps) {
  const { t } = useTranslation('common');
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
    documentation,
    documentationLoading,
    documentationError,
    documentationStreamChunk,
    setDocumentation,
    setDocumentationLoading,
    setDocumentationError,
    appendDocumentationChunk,
    clearDocumentationChunk,
  } = useContextStore();

  const [activeTab, setActiveTab] = useState('index');

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

  // Load existing documentation on mount
  useEffect(() => {
    let cancelled = false;
    async function loadDocumentation() {
      try {
        const result = await window.electronAPI.getProjectDocumentation(projectId);
        if (!cancelled && result.success && result.data) {
          setDocumentation(result.data as ProjectDocumentation);
        }
      } catch {
        // Silently ignore — documentation is optional
      }
    }
    void loadDocumentation();
    return () => {
      cancelled = true;
    };
  }, [projectId, setDocumentation]);

  // Register IPC listeners for streaming documentation events
  useEffect(() => {
    const unsubChunk = window.electronAPI.onDocumentationChunk(
      (incomingProjectId: string, chunk: string) => {
        if (incomingProjectId === projectId) {
          appendDocumentationChunk(chunk);
        }
      }
    );

    const unsubComplete = window.electronAPI.onDocumentationComplete(
      (incomingProjectId: string, doc: ProjectDocumentation) => {
        if (incomingProjectId === projectId) {
          setDocumentation(doc);
          setDocumentationLoading(false);
          clearDocumentationChunk();
        }
      }
    );

    const unsubError = window.electronAPI.onDocumentationError(
      (incomingProjectId: string, error: string) => {
        if (incomingProjectId === projectId) {
          setDocumentationError(error);
          setDocumentationLoading(false);
        }
      }
    );

    // onDocumentationToolUse — no store update needed, tool indication is
    // derived from streamChunk inside DocumentationTab
    const unsubToolUse = window.electronAPI.onDocumentationToolUse(
      (_incomingProjectId: string, _toolName: string) => {
        // intentional no-op
      }
    );

    return () => {
      unsubChunk();
      unsubComplete();
      unsubError();
      unsubToolUse();
    };
  }, [
    projectId,
    appendDocumentationChunk,
    setDocumentation,
    setDocumentationLoading,
    setDocumentationError,
    clearDocumentationChunk,
  ]);

  const handleGenerate = useCallback(() => {
    setDocumentationLoading(true);
    setDocumentationError(null);
    clearDocumentationChunk();
    window.electronAPI.generateProjectDocumentation(projectId);
  }, [projectId, setDocumentationLoading, setDocumentationError, clearDocumentationChunk]);

  const handleStop = useCallback(() => {
    window.electronAPI.stopProjectDocumentation(projectId);
    setDocumentationLoading(false);
  }, [projectId, setDocumentationLoading]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
        <div className="border-b border-border px-6 py-3">
          <TabsList className="grid w-full max-w-lg grid-cols-3">
            <TabsTrigger value="index" className="gap-2">
              <FolderTree className="h-4 w-4" />
              {t('context.tabs.projectIndex')}
            </TabsTrigger>
            <TabsTrigger value="documentation" className="gap-2">
              <BookOpen className="h-4 w-4" />
              {t('context.tabs.documentation')}
            </TabsTrigger>
            <TabsTrigger value="memories" className="gap-2">
              <Brain className="h-4 w-4" />
              {t('context.tabs.memories')}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Project Index Tab */}
        <TabsContent value="index" className="flex-1 overflow-hidden m-0">
          <ProjectIndexTab
            projectIndex={projectIndex}
            indexLoading={indexLoading}
            indexError={indexError}
            onRefresh={handleRefreshIndex}
          />
        </TabsContent>

        {/* Documentation Tab */}
        <TabsContent value="documentation" className="flex-1 overflow-hidden m-0">
          <DocumentationTab
            projectId={projectId}
            documentation={documentation}
            isGenerating={documentationLoading}
            streamChunk={documentationStreamChunk}
            error={documentationError}
            onGenerate={handleGenerate}
            onStop={handleStop}
          />
        </TabsContent>

        {/* Memories Tab */}
        <TabsContent value="memories" className="flex-1 overflow-hidden m-0">
          <MemoriesTab
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
