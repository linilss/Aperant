import { useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, Loader2, Upload } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../ui/dialog';
import { cn } from '../../../lib/utils';
import type { DesignPublishPlan, DesignSystemState } from '../../../../shared/types';

// =============================================================================
// Link / source form
// =============================================================================

interface SourceFormProps {
  projectId: string;
  state: DesignSystemState | null;
  onSaved: (state: DesignSystemState) => void;
  onCancel?: () => void;
}

/** Edit the artifact link and source folder override (`.malvy/design-system.json`) */
export function DesignSourceForm({ projectId, state, onSaved, onCancel }: SourceFormProps) {
  const { t } = useTranslation('context');
  const config = state?.config ?? {};
  const detection = state?.detection;
  const [url, setUrl] = useState(config.artifactUrl ?? '');
  const [sourceDir, setSourceDir] = useState(config.sourceDir ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detectedUrl = detection && !detection.overridden.artifactUrl ? detection.artifactUrl : null;
  const detectedSource = detection && !detection.overridden.sourceDir ? detection.sourceDir : null;

  const save = async () => {
    setSaving(true);
    setError(null);
    const result = await window.electronAPI.saveDesignSystemOverrides(projectId, {
      artifactUrl: url.trim(),
      sourceDir: sourceDir.trim(),
    });
    setSaving(false);
    if (result.success && result.data) onSaved(result.data);
    else setError(t('design.form.saveError', { error: result.error ?? '' }));
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="design-url">{t('design.form.url')}</Label>
        <Input
          id="design-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={detectedUrl ?? t('design.form.urlPlaceholder')}
          className="font-mono text-xs max-md:h-10"
          inputMode="url"
          autoComplete="off"
        />
        {detectedUrl && <p className="break-all text-xs text-muted-foreground">{t('design.form.detected', { value: detectedUrl })}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="design-source">{t('design.form.sourceDir')}</Label>
        <Input
          id="design-source"
          value={sourceDir}
          onChange={(e) => setSourceDir(e.target.value)}
          placeholder={detectedSource ?? t('design.form.sourceDirPlaceholder')}
          className="font-mono text-xs max-md:h-10"
          autoComplete="off"
        />
        {detectedSource && (
          <p className="break-all text-xs text-muted-foreground">{t('design.form.detected', { value: detectedSource })}</p>
        )}
      </div>
      {error && (
        <p className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 max-md:flex-col-reverse">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} className="max-md:h-10">
            {t('design.form.cancel')}
          </Button>
        )}
        <Button type="submit" disabled={saving} className="max-md:h-10">
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('design.form.save')}
        </Button>
      </div>
    </form>
  );
}

export function DesignSourceDialog({ open, onOpenChange, ...props }: SourceFormProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation('context');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('design.form.title')}</DialogTitle>
          <DialogDescription>{t('design.form.description')}</DialogDescription>
        </DialogHeader>
        {open && <DesignSourceForm {...props} onCancel={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// Publish confirm
// =============================================================================

interface PublishDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs the publish for exactly these artifact paths */
  onConfirm: (paths: string[]) => void;
}

/** Shows the changed files and the target, then hands the confirmed list to the publish runner */
export function DesignPublishDialog({ projectId, open, onOpenChange, onConfirm }: PublishDialogProps) {
  const { t } = useTranslation('context');
  const [plan, setPlan] = useState<DesignPublishPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPlan(null);
    window.electronAPI.getDesignPublishPlan(projectId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (result.success) setPlan(result.data ?? null);
      else setError(result.error ?? t('design.publishDisabled'));
    });
    return () => {
      cancelled = true;
    };
  }, [open, projectId, t]);

  const files = plan?.files ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            {t('design.publishDialog.title')}
          </DialogTitle>
          <DialogDescription>{t('design.publishDialog.description')}</DialogDescription>
        </DialogHeader>

        {loading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('design.publishDialog.loading')}
          </p>
        )}
        {(error || (!loading && !plan)) && (
          <p className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error ?? t('design.publishDisabled')}
          </p>
        )}

        {plan && (
          <div className="min-w-0 space-y-3 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">{t('design.publishDialog.target')}</dt>
              <dd className="min-w-0 break-all font-mono">{plan.artifactUrl}</dd>
              <dt className="text-muted-foreground">{t('design.publishDialog.root')}</dt>
              <dd className="min-w-0 break-all font-mono">{plan.publishRoot || '.'}</dd>
            </dl>
            {plan.noBaseline && (
              <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {t('design.publishDialog.noBaseline')}
              </p>
            )}
            {files.length === 0 ? (
              <p className="text-muted-foreground">{t('design.publishDialog.noChanges')}</p>
            ) : (
              <>
                <p className="font-medium text-foreground">{t('design.publishDialog.changed', { count: files.length })}</p>
                <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-lg border border-border max-md:max-h-72">
                  {files.map((f) => (
                    <li key={f.path} className="flex items-center gap-2 px-3 py-1.5">
                      <span className="min-w-0 flex-1 break-all font-mono text-xs">{f.path}</span>
                      <Badge variant={f.change === 'added' ? 'success' : 'info'} className="shrink-0">
                        {t(`design.publishDialog.${f.change}`)}
                      </Badge>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">{t('design.publishDialog.indexLast')}</p>
              </>
            )}
          </div>
        )}

        <DialogFooter className="max-md:flex-col-reverse max-md:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="max-md:h-10">
            {t('design.publishDialog.cancel')}
          </Button>
          <Button
            disabled={files.length === 0}
            onClick={() => {
              onConfirm(files.map((f) => f.path));
              onOpenChange(false);
            }}
            className="max-md:h-10"
          >
            <Upload className="mr-2 h-4 w-4" />
            {t('design.publishDialog.confirm', { count: files.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// File viewer (component README / preview, docs)
// =============================================================================

export interface DesignFileView {
  title: string;
  /** Candidate files; the first is shown first (README before preview) */
  files: Array<{ label: string; path: string }>;
}

export function DesignFileDialog({
  projectId,
  view,
  onClose,
}: {
  projectId: string;
  view: DesignFileView | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('context');
  // Selected file index, reset whenever another view opens
  const [selection, setSelection] = useState<{ view: DesignFileView | null; index: number }>({ view: null, index: 0 });
  const active = selection.view === view ? selection.index : 0;
  const setActive = (index: number) => setSelection({ view, index });
  const [content, setContent] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const file = view?.files[active];

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setContent(null);
    setFailed(false);
    window.electronAPI.readDesignSystemFile(projectId, file.path).then((result) => {
      if (cancelled) return;
      if (result.success && typeof result.data === 'string') setContent(result.data);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, file]);

  const isMarkdown = file?.path.toLowerCase().endsWith('.md');

  return (
    <Dialog open={!!view} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>{view?.title}</DialogTitle>
          {file && <DialogDescription className="break-all font-mono text-xs">{file.path}</DialogDescription>}
        </DialogHeader>
        {view && view.files.length > 1 && (
          <div className="flex gap-2">
            {view.files.map((f, i) => (
              <Button
                key={f.path}
                size="sm"
                variant={i === active ? 'default' : 'outline'}
                onClick={() => setActive(i)}
                className="max-md:h-10"
              >
                {f.label}
              </Button>
            ))}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-card p-4 max-md:p-3">
          {failed ? (
            <p className="text-sm text-destructive">{t('design.loadError')}</p>
          ) : content === null ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : isMarkdown ? (
            <div className="prose prose-sm dark:prose-invert min-w-0 max-w-none text-foreground prose-headings:text-foreground prose-p:text-foreground/90 prose-li:text-foreground/90 prose-strong:text-foreground prose-code:text-foreground prose-td:text-foreground/90 prose-th:text-foreground [&_pre_code]:text-xs [&_table]:block [&_table]:overflow-x-auto">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          ) : (
            <pre className={cn('whitespace-pre-wrap break-all font-mono text-xs text-foreground')}>{content}</pre>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
