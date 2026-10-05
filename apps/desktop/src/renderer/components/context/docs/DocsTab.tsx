import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Loader2, RefreshCw, Sparkles, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/button';
import { ScrollArea } from '../../ui/scroll-area';
import { cn } from '../../../lib/utils';
import {
  applyProposals,
  createPointer,
  deletePointer,
  loadDocs,
  rejectProposal,
  startDocsOptimizer,
  stopDocsOptimizer,
  updatePointer,
  useContextStore,
} from '../../../stores/context-store';
import type { DocProposal } from '../../../../shared/types';
import { DocTree } from './DocTree';
import { DocViewer } from './DocViewer';
import { ProposalReview } from './ProposalReview';
import { StreamPreview } from './StreamPreview';

export interface DocFocus {
  path: string;
  heading?: string;
}

interface DocsTabProps {
  projectId: string;
  /** File/heading to open (e.g. when jumping from a pointer in the Memories tab) */
  focus: DocFocus | null;
}

export function DocsTab({ projectId, focus }: DocsTabProps) {
  const { t } = useTranslation('context');
  const docs = useContextStore((s) => s.docs);
  const docsLoading = useContextStore((s) => s.docsLoading);
  const pointers = useContextStore((s) => s.pointers);
  const optimizerRunning = useContextStore((s) => s.optimizerRunning);
  const optimizerStream = useContextStore((s) => s.optimizerStream);
  const optimizerError = useContextStore((s) => s.optimizerError);
  const proposals = useContextStore((s) => s.proposals);
  const setProposals = useContextStore((s) => s.setProposals);
  const branchProgress = useContextStore((s) => s.branchProgress);
  const passes = Object.values(branchProgress);
  const finishedPasses = passes.filter((p) => p.status !== 'queued' && p.status !== 'running').length;

  const [selectedPath, setSelectedPath] = useState<string | null>(focus?.path ?? null);
  const [focusHeading, setFocusHeading] = useState<string | undefined>(focus?.heading);
  const [content, setContent] = useState<string | null>(null);
  const [contentError, setContentError] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  // Follow external focus requests
  useEffect(() => {
    if (focus) {
      setSelectedPath(focus.path);
      setFocusHeading(focus.heading);
    }
  }, [focus]);

  // Default to the first doc; drop a selection that no longer exists
  useEffect(() => {
    if (docs.length === 0) return;
    if (!selectedPath || !docs.some((d) => d.relativePath === selectedPath)) {
      setSelectedPath(docs[0].relativePath);
    }
  }, [docs, selectedPath]);

  const selectedDoc = useMemo(
    () => docs.find((d) => d.relativePath === selectedPath) ?? null,
    [docs, selectedPath]
  );

  // Load the selected file (reloads when the docs list changes, e.g. after apply)
  useEffect(() => {
    if (!selectedDoc) {
      setContent(null);
      return;
    }
    let cancelled = false;
    setContentError(false);
    window.electronAPI
      .readClaudeDoc(projectId, selectedDoc.relativePath)
      .then((result) => {
        if (cancelled) return;
        if (result.success && typeof result.data === 'string') {
          setContent(result.data);
        } else {
          setContent(null);
          setContentError(true);
        }
      })
      .catch(() => {
        if (!cancelled) setContentError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, selectedDoc]);

  const docPointers = useMemo(
    () => pointers.filter((p) => p.docPath && p.docPath === selectedDoc?.relativePath),
    [pointers, selectedDoc]
  );

  const handleCreatePointer = useCallback(
    (heading: string | undefined, value: string) =>
      createPointer(projectId, { content: value, docPath: selectedDoc?.relativePath, heading }),
    [projectId, selectedDoc]
  );
  const handleUpdatePointer = useCallback(
    (id: string, value: string) => updatePointer(projectId, id, value),
    [projectId]
  );
  const handleDeletePointer = useCallback(
    (id: string) => {
      void deletePointer(projectId, id);
    },
    [projectId]
  );

  const handleApprove = async (items: DocProposal[]) => {
    setApplyError(null);
    const result = await applyProposals(projectId, items);
    if (!result) {
      setApplyError(t('review.applyError', { errors: items.map((p) => p.path).join(', ') }));
    } else if (result.errors.length > 0) {
      setApplyError(
        t('review.applyError', { errors: result.errors.map((e) => `${e.path} (${e.error})`).join(', ') })
      );
    }
  };

  const select = (path: string) => {
    setSelectedPath(path);
    setFocusHeading(undefined);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-6 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{t('docs.title')}</h2>
          <p className="truncate text-xs text-muted-foreground">{t('docs.subtitle')}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => loadDocs(projectId)}
            disabled={docsLoading}
            title={t('docs.refresh')}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', docsLoading && 'animate-spin')} />
          </Button>
          {optimizerRunning ? (
            <Button variant="outline" size="sm" onClick={() => stopDocsOptimizer(projectId)}>
              <Square className="mr-1.5 h-3.5 w-3.5" />
              {t('docs.stop')}
            </Button>
          ) : (
            <Button size="sm" onClick={() => startDocsOptimizer(projectId)}>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              {t('docs.optimize')}
            </Button>
          )}
        </div>
      </div>

      {optimizerError && !optimizerRunning && (
        <div className="mx-6 mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          <p className="font-medium">{t('optimizer.failed')}</p>
          <p className="whitespace-pre-line break-words text-xs text-destructive/80">{optimizerError}</p>
        </div>
      )}

      {proposals && proposals.length === 0 && !optimizerRunning && (
        <div className="mx-6 mt-3 flex items-center justify-between rounded-md border border-border bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
          <span>{t('optimizer.noChanges')}</span>
          <Button variant="ghost" size="sm" onClick={() => setProposals(null)}>
            {t('review.close')}
          </Button>
        </div>
      )}

      {/* Body */}
      {optimizerRunning ? (
        <div className="flex-1 overflow-auto p-6">
          <div className="mb-3 flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-sm font-medium text-foreground">{t('optimizer.running')}</span>
            {passes.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {t('optimizer.progress', { done: finishedPasses, total: passes.length })}
              </span>
            )}
          </div>
          <StreamPreview chunk={optimizerStream} />
        </div>
      ) : proposals && proposals.length > 0 ? (
        <ScrollArea className="flex-1">
          <ProposalReview
            proposals={proposals}
            onApprove={handleApprove}
            onReject={rejectProposal}
            onClose={() => setProposals(null)}
            error={applyError}
          />
        </ScrollArea>
      ) : docs.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <BookOpen className="mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="mb-2 text-lg font-semibold text-foreground">{t('docs.empty')}</h3>
          <p className="max-w-sm text-sm text-muted-foreground">{t('docs.emptyHint')}</p>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <ScrollArea className="w-72 shrink-0 border-r border-border">
            <DocTree docs={docs} pointers={pointers} selectedPath={selectedPath} onSelect={select} />
          </ScrollArea>
          <ScrollArea className="flex-1">
            {selectedDoc && content !== null ? (
              <DocViewer
                doc={selectedDoc}
                content={content}
                pointers={docPointers}
                focusHeading={focusHeading}
                onCreatePointer={handleCreatePointer}
                onUpdatePointer={handleUpdatePointer}
                onDeletePointer={handleDeletePointer}
              />
            ) : (
              <p className="p-6 text-sm text-muted-foreground">
                {contentError ? t('docs.loadError') : t('docs.selectFile')}
              </p>
            )}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
