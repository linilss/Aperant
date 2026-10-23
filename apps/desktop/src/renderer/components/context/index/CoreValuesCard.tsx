import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Gem, Loader2, Pencil, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Textarea } from '../../ui/textarea';
import { cn } from '../../../lib/utils';
import {
  draftCoreValues,
  loadCoreValues,
  saveCoreValues,
  selectCoreValues,
  useCoreValuesStore,
} from '../../../stores/core-values-store';

/** Rendered core values markdown (also used read-only on the Competitors page) */
export function CoreValuesMarkdown({ text, large = false }: { text: string; large?: boolean }) {
  return (
    <div
      className={cn(
        'prose dark:prose-invert max-w-none break-words text-foreground',
        'prose-headings:text-foreground prose-p:text-foreground/90 prose-li:text-foreground/90 prose-strong:text-foreground prose-code:text-foreground',
        large ? 'prose-base' : 'prose-sm'
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

interface CoreValuesCardProps {
  projectId: string;
  /** Full-page use (Core values view): larger editor and text */
  large?: boolean;
}

/** Core values: view, edit, AI draft */
export function CoreValuesCard({ projectId, large = false }: CoreValuesCardProps) {
  const { t, i18n } = useTranslation('context');
  const values = useCoreValuesStore((s) => selectCoreValues(s, projectId));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleNotice, setStaleNotice] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void loadCoreValues(projectId);
    setEditing(false);
    setError(null);
    setStaleNotice(false);
  }, [projectId]);

  // Autosize the textarea to its content
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the text changes
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!editing || !el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, editing]);

  const text = values?.text ?? '';

  const startEdit = () => {
    setDraft(text);
    setError(null);
    setStaleNotice(false);
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setError(null);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const result = await saveCoreValues(projectId, draft);
    setSaving(false);
    if (result.error) {
      setError(t('index.coreValues.saveError', { error: result.error }));
      return;
    }
    setStaleNotice(result.directionsMarkedStale === true);
    setEditing(false);
  };

  const runDraft = async () => {
    setDrafting(true);
    setError(null);
    const result = await draftCoreValues(projectId);
    setDrafting(false);
    if (result.text) {
      setDraft(result.text);
      setEditing(true);
      textareaRef.current?.focus();
    } else {
      setError(t('index.coreValues.draftError', { error: result.error ?? '' }));
    }
  };

  const updatedAt = values?.updatedAt
    ? t('index.coreValues.updatedAt', {
        date: new Date(values.updatedAt).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
      })
    : null;

  const draftButton = (
    <Button variant="outline" size="sm" className="max-md:h-10" onClick={runDraft} disabled={drafting || saving}>
      {drafting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
      {drafting ? t('index.coreValues.drafting') : t('index.coreValues.draft')}
    </Button>
  );

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2 max-md:flex-wrap">
          <div className="min-w-0 space-y-1">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <Gem className="h-4 w-4 text-primary" />
              {t('index.coreValues.title')}
              <Badge variant="info" className="text-xs">
                {t('index.coreValues.badge')}
              </Badge>
            </CardTitle>
            {/* The Core values page says this in its header */}
            {!large && <p className="text-xs text-muted-foreground">{t('index.coreValues.description')}</p>}
          </div>
          {!editing && text && (
            <Button variant="ghost" size="sm" className="shrink-0 max-md:h-10" onClick={startEdit}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              {t('index.coreValues.edit')}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {editing ? (
          <div className="space-y-2">
            <Textarea
              ref={textareaRef}
              autoFocus
              value={draft}
              aria-label={t('index.coreValues.label')}
              placeholder={t('index.coreValues.placeholder')}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void save();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  cancel();
                }
              }}
              className={cn('overflow-hidden', large ? 'min-h-[18rem] text-base max-md:min-h-[12rem]' : 'min-h-[96px] text-sm')}
              maxLength={8000}
              disabled={saving}
            />
            <p className="text-xs text-muted-foreground">{t('index.coreValues.hint')}</p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {draftButton}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground max-md:hidden">{t('index.coreValues.shortcut')}</span>
                <Button variant="ghost" size="sm" className="max-md:h-10" onClick={cancel} disabled={saving}>
                  {t('index.coreValues.cancel')}
                </Button>
                <Button size="sm" className="max-md:h-10" onClick={() => void save()} disabled={saving}>
                  {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  {t('index.coreValues.save')}
                </Button>
              </div>
            </div>
          </div>
        ) : text ? (
          <>
            <CoreValuesMarkdown text={text} large={large} />
            {updatedAt && <p className="text-xs text-muted-foreground">{updatedAt}</p>}
          </>
        ) : (
          <div className="flex flex-col items-center py-4 text-center">
            <h3 className="text-sm font-medium text-foreground">{t('index.coreValues.empty')}</h3>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">{t('index.coreValues.emptyHint')}</p>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">{t('index.coreValues.hint')}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button size="sm" className="max-md:h-10" onClick={startEdit} disabled={!values || drafting}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                {t('index.coreValues.add')}
              </Button>
              {draftButton}
            </div>
          </div>
        )}
        {staleNotice && !editing && <p className="text-xs text-muted-foreground">{t('index.coreValues.staleNotice')}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
