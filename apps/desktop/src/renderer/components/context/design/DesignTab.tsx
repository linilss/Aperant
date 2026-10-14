import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, Palette, Pencil, RefreshCw, Sparkles, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/button';
import { ScrollArea } from '../../ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip';
import { formatRelativeTime } from '../../../lib/utils';
import type {
  DesignComponentInfo,
  DesignDocInfo,
  DesignSystemOperation,
  DesignSystemState,
} from '../../../../shared/types';
import {
  ColorsSection,
  ComponentsSection,
  DocsSection,
  RadiiSpacingSection,
  Section,
  TypographySection,
} from './DesignSections';
import {
  DesignFileDialog,
  type DesignFileView,
  DesignPublishDialog,
  DesignSourceDialog,
  DesignSourceForm,
} from './DesignDialogs';

const PROGRESS_MAX_CHARS = 6_000;

interface DesignTabProps {
  projectId: string;
}

/**
 * Design view: the project's Claude Design System (artifact link + local source),
 * its tokens, components and docs. Sync is read-only; Publish only runs from the button
 * after a confirm dialog (task agents can't publish).
 */
export function DesignTab({ projectId }: DesignTabProps) {
  const { t } = useTranslation(['context', 'common']);
  const [state, setState] = useState<DesignSystemState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [running, setRunning] = useState<DesignSystemOperation | null>(null);
  const [progress, setProgress] = useState('');
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [fileView, setFileView] = useState<DesignFileView | null>(null);
  const progressRef = useRef<HTMLPreElement>(null);

  const load = useCallback(async () => {
    const result = await window.electronAPI.getDesignSystem(projectId);
    setLoading(false);
    if (result.success && result.data) {
      setState(result.data);
      setRunning(result.data.running);
      setLoadError(null);
    } else {
      setLoadError(result.error ?? t('context:design.loadError'));
    }
  }, [projectId, t]);

  useEffect(() => {
    setLoading(true);
    setState(null);
    setProgress('');
    setNotice(null);
    void load();
  }, [load]);

  useEffect(
    () =>
      window.electronAPI.onDesignSystemProgress((incomingProjectId, text) => {
        if (incomingProjectId !== projectId) return;
        setProgress((prev) => (prev + text).slice(-PROGRESS_MAX_CHARS));
        // Follow the output
        requestAnimationFrame(() => {
          const el = progressRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        });
      }),
    [projectId]
  );

  const run = async (operation: DesignSystemOperation, paths: string[] = []) => {
    setRunning(operation);
    setProgress('');
    setNotice(null);
    const result =
      operation === 'sync'
        ? await window.electronAPI.syncDesignSystem(projectId)
        : operation === 'generate'
          ? await window.electronAPI.generateDesignSystem(projectId)
          : await window.electronAPI.publishDesignSystem(projectId, paths);
    setRunning(null);
    if (result.success && result.data) {
      const count = result.data.files.length;
      setNotice({
        kind: 'success',
        text: t(
          operation === 'sync'
            ? 'context:design.syncDone'
            : operation === 'generate'
              ? 'context:design.generateDone'
              : 'context:design.publishDone',
          { count }
        ),
      });
    } else {
      setNotice({ kind: 'error', text: result.error ?? '' });
    }
    await load();
  };

  const openExternal = (url: string) => {
    void window.electronAPI.openExternal(url);
  };

  const openComponent = (c: DesignComponentInfo) => {
    const files = [
      ...(c.path ? [{ label: t('context:design.readme'), path: c.path }] : []),
      ...(c.previewPath ? [{ label: t('context:design.preview'), path: c.previewPath }] : []),
    ];
    if (files.length > 0) setFileView({ title: c.name, files });
  };

  const openDoc = (doc: DesignDocInfo) => setFileView({ title: doc.title, files: [{ label: doc.title, path: doc.path }] });

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const detection = state?.detection;
  const data = state?.data;
  const config = state?.config ?? {};
  const nothingFound = !detection?.artifactUrl && !detection?.sourceDir && (!data || data.origin === 'none');

  const runFeedback = (
    <>
      {notice && (
        <p className={`flex items-start gap-2 text-sm ${notice.kind === 'success' ? 'text-success' : 'text-destructive'}`}>
          {notice.kind === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span className="min-w-0 break-words">{notice.text}</span>
        </p>
      )}
      {(running || progress) && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{t('context:design.progress')}</p>
          <pre
            ref={progressRef}
            className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-[11px] text-muted-foreground"
          >
            {progress || '…'}
          </pre>
        </div>
      )}
    </>
  );

  const body = (() => {
    if (loadError || !state || !detection || !data) {
      return (
        <p className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {loadError}
        </p>
      );
    }

    if (nothingFound) {
      return (
        <div className="mx-auto max-w-xl space-y-4 rounded-xl border border-dashed border-border p-6 max-md:p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Palette className="h-5 w-5 text-primary" />
            </div>
            <h3 className="text-base font-semibold text-foreground">{t('context:design.empty.title')}</h3>
          </div>
          <p className="text-sm text-muted-foreground">{t('context:design.empty.description')}</p>
          <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <p className="text-sm text-foreground">{t('context:design.generateDescription')}</p>
            <Button size="sm" onClick={() => void run('generate')} disabled={running !== null} className="max-md:h-10 max-md:w-full">
              {running === 'generate' ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-1.5 h-4 w-4" />
              )}
              {running === 'generate' ? t('context:design.generating') : t('context:design.generate')}
            </Button>
            {runFeedback}
          </div>
          <p className="text-xs text-muted-foreground">{t('context:design.empty.hint')}</p>
          <DesignSourceForm projectId={projectId} state={state} onSaved={setState} />
        </div>
      );
    }

    const name = detection.name ?? (data.name ? `${data.name}` : t('context:design.fallbackName'));
    const canPublish = Boolean(detection.sourceDir && detection.artifactUrl);
    const parsedSomething =
      data.colors.length + data.typography.length + data.radii.length + data.spacing.length + data.components.length + data.docs.length > 0;

    return (
      <div className="space-y-6">
        {/* Header card */}
        <div className="space-y-4 rounded-xl border border-border bg-card p-4 max-md:p-3">
          <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
            <div className="flex min-w-0 flex-[1_1_16rem] items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Palette className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold text-foreground">{name}</h3>
                <p className="text-xs text-muted-foreground">{t(`context:design.origin.${data.origin}`)}</p>
              </div>
            </div>
            <div className="ml-auto flex flex-wrap gap-2 max-md:ml-0 max-md:w-full">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!detection.artifactUrl || running !== null}
                    onClick={() => void run('sync')}
                    className="max-md:h-10 max-md:flex-1"
                  >
                    <RefreshCw className={`mr-1.5 h-4 w-4 ${running === 'sync' ? 'animate-spin' : ''}`} />
                    {running === 'sync' ? t('context:design.syncing') : t('context:design.sync')}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('context:design.syncHint')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="max-md:flex-1">
                    <Button
                      size="sm"
                      // Neutral when publishing isn't possible, so it doesn't read as the main action
                      variant={canPublish ? 'default' : 'outline'}
                      disabled={!canPublish || running !== null}
                      onClick={() => setPublishOpen(true)}
                      className="max-md:h-10 max-md:w-full"
                    >
                      {running === 'publish' ? (
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="mr-1.5 h-4 w-4" />
                      )}
                      {running === 'publish' ? t('context:design.publishing') : t('context:design.publish')}
                    </Button>
                  </span>
                </TooltipTrigger>
                {!canPublish && <TooltipContent>{t('context:design.publishDisabled')}</TooltipContent>}
              </Tooltip>
              <Button size="sm" variant="ghost" onClick={() => setEditOpen(true)} className="max-md:h-10 max-md:flex-1">
                <Pencil className="mr-1.5 h-4 w-4" />
                {t('context:design.edit')}
              </Button>
            </div>
          </div>

          <dl className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm max-md:grid-cols-1 max-md:gap-y-0.5">
            <dt className="text-muted-foreground">{t('context:design.artifact')}</dt>
            <dd className="min-w-0 max-md:mb-2">
              {detection.artifactUrl ? (
                <button
                  type="button"
                  onClick={() => openExternal(detection.artifactUrl as string)}
                  className="inline-flex max-w-full items-center gap-1.5 text-left font-mono text-xs text-primary hover:underline"
                >
                  <span className="min-w-0 break-all">{detection.artifactUrl}</span>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                </button>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
              <p className="text-[11px] text-muted-foreground">
                {detection.overridden.artifactUrl
                  ? t('context:design.overridden')
                  : detection.docFile && t('context:design.detectedIn', { file: detection.docFile })}
              </p>
            </dd>
            <dt className="text-muted-foreground">{t('context:design.source')}</dt>
            <dd className="min-w-0 break-all font-mono text-xs max-md:mb-2">
              {detection.sourceDir ?? <span className="font-sans text-muted-foreground">{t('context:design.noSource')}</span>}
              {detection.overridden.sourceDir && (
                <span className="ml-2 font-sans text-[11px] text-muted-foreground">{t('context:design.overridden')}</span>
              )}
            </dd>
            {detection.tokenFiles.length > 0 && (
              <>
                <dt className="text-muted-foreground">{t('context:design.tokenFiles')}</dt>
                <dd className="min-w-0 space-y-0.5 break-all font-mono text-xs max-md:mb-2">
                  {detection.tokenFiles.map((f) => (
                    <p key={f}>{f}</p>
                  ))}
                </dd>
              </>
            )}
          </dl>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              {config.syncedAt
                ? t('context:design.lastSynced', { time: formatRelativeTime(new Date(config.syncedAt)) })
                : t('context:design.neverSynced')}
            </span>
            <span>
              {config.publishedAt
                ? t('context:design.lastPublished', { time: formatRelativeTime(new Date(config.publishedAt)) })
                : t('context:design.neverPublished')}
            </span>
          </div>

          {notice && (
            <p
              className={`flex items-start gap-2 text-sm ${notice.kind === 'success' ? 'text-success' : 'text-destructive'}`}
            >
              {notice.kind === 'success' ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span className="min-w-0 break-words">{notice.text}</span>
            </p>
          )}

          {(running || progress) && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">{t('context:design.progress')}</p>
              <pre
                ref={progressRef}
                className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-[11px] text-muted-foreground"
              >
                {progress || '…'}
              </pre>
            </div>
          )}
        </div>

        {data.colors.length > 0 && <ColorsSection colors={data.colors} />}
        {data.typography.length > 0 && <TypographySection styles={data.typography} />}
        {(data.radii.length > 0 || data.spacing.length > 0) && (
          <RadiiSpacingSection radii={data.radii} spacing={data.spacing} />
        )}
        {data.components.length > 0 && <ComponentsSection components={data.components} onOpen={openComponent} />}
        {data.docs.length > 0 && <DocsSection docs={data.docs} onOpen={openDoc} />}

        {!parsedSomething && data.rawFiles.length > 0 && (
          <Section title={t('context:design.sections.files')} count={data.rawFiles.length}>
            <p className="text-xs text-muted-foreground">{t('context:design.rawHint')}</p>
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {data.rawFiles.map((f) => (
                <li key={f} className="break-all px-3 py-1.5 font-mono text-xs">
                  {f}
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    );
  })();

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-5xl p-6 max-md:p-3">{body}</div>
      <DesignSourceDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        projectId={projectId}
        state={state}
        onSaved={(next) => {
          setState(next);
          setEditOpen(false);
        }}
      />
      <DesignPublishDialog
        projectId={projectId}
        open={publishOpen}
        onOpenChange={setPublishOpen}
        onConfirm={(paths) => void run('publish', paths)}
      />
      <DesignFileDialog projectId={projectId} view={fileView} onClose={() => setFileView(null)} />
    </ScrollArea>
  );
}
