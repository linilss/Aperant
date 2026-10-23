import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Compass, Globe, ListOrdered, Plus, Swords, X } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { addManualCompetitor, useCompetitorStore } from '../stores/competitor-store';

interface CompetitorAnalysisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** Generate with competitor analysis: reuse the existing one, or run it now (it lands on the Competitors page) */
  onAccept: () => void;
  /** Generate the roadmap without competitor analysis */
  onDecline: () => void;
  /** Open the Competitors page */
  onGoToCompetitors?: () => void;
}

/** How many ranked, non-avoided directions guide the roadmap (matches competitors/guidance.ts) */
const PURSUE_COUNT = 3;

/**
 * Shown before generating a roadmap. With an existing analysis it previews the
 * competitors and ranked directions the roadmap will follow; without one it offers
 * to run the analysis now — the result is saved to the Competitors page.
 */
export function CompetitorAnalysisDialog({
  open,
  onOpenChange,
  projectId,
  onAccept,
  onDecline,
  onGoToCompetitors,
}: CompetitorAnalysisDialogProps) {
  const { t } = useTranslation(['dialogs']);
  const storeProjectId = useCompetitorStore((s) => s.projectId);
  const data = useCompetitorStore((s) => s.data);
  const state = storeProjectId === projectId ? data : null;

  const analyzed = state?.competitors.filter((c) => c.analyzed) ?? [];
  const pool = state?.competitors.filter((c) => !c.analyzed) ?? [];
  const hasAnalysis = analyzed.length > 0;
  const pursue = (state?.directions ?? []).filter((d) => !d.avoid).slice(0, PURSUE_COUNT);
  const avoided = (state?.directions ?? []).filter((d) => d.avoid);

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setUrl('');
    }
  }, [open]);

  const close = (action: () => void) => {
    action();
    onOpenChange(false);
  };

  const addKnown = async () => {
    if (!name.trim()) return;
    setAdding(true);
    // Lands in the Competitors pool; the analysis below profiles it
    await addManualCompetitor(projectId, name.trim(), url.trim());
    setName('');
    setUrl('');
    setAdding(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-[560px]">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-foreground">
            <Swords className="h-5 w-5 text-primary" />
            {hasAnalysis ? t('dialogs:competitorAnalysis.previewTitle') : t('dialogs:competitorAnalysis.title')}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-muted-foreground">
            {hasAnalysis
              ? t('dialogs:competitorAnalysis.previewDescription', {
                  count: analyzed.length,
                  date: state?.analyzedAt ? new Date(state.analyzedAt).toLocaleDateString() : '—',
                })
              : t('dialogs:competitorAnalysis.description')}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="max-h-[55vh] space-y-4 overflow-y-auto py-2">
          {hasAnalysis ? (
            <>
              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('dialogs:competitorAnalysis.competitorsHeading')}
                </h4>
                <ul className="space-y-1.5">
                  {analyzed.map((c) => (
                    <li key={c.id} className="text-sm">
                      <span className="font-medium text-foreground">{c.name}</span>
                      {(c.positioning || c.oneLiner) && (
                        <span className="text-muted-foreground"> — {c.positioning || c.oneLiner}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('dialogs:competitorAnalysis.directionsHeading')}
                </h4>
                {pursue.length === 0 && avoided.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('dialogs:competitorAnalysis.noDirections')}</p>
                ) : (
                  <ol className="space-y-1.5">
                    {pursue.map((d, i) => (
                      <li key={d.id} className="flex items-start gap-2 text-sm">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                          {i + 1}
                        </span>
                        <span className="text-foreground">{d.title}</span>
                      </li>
                    ))}
                    {avoided.map((d) => (
                      <li key={d.id} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <X className="mt-0.5 h-4 w-4 shrink-0" />
                        <span className="line-through">{d.title}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {!state?.rankingSavedAt && pursue.length > 0 && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {t('dialogs:competitorAnalysis.notRanked')}
                  </p>
                )}
              </section>
            </>
          ) : (
            <>
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                <h4 className="mb-2 text-sm font-medium text-foreground">{t('dialogs:competitorAnalysis.whatItDoes')}</h4>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <Globe className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                    <span>{t('dialogs:competitorAnalysis.stepAnalyze')}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <ListOrdered className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                    <span>{t('dialogs:competitorAnalysis.stepRank')}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Compass className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                    <span>{t('dialogs:competitorAnalysis.stepGuide')}</span>
                  </li>
                </ul>
              </div>

              <section>
                <h4 className="mb-1 text-sm font-medium text-foreground">{t('dialogs:competitorAnalysis.knowYourCompetitors')}</h4>
                <p className="mb-2 text-xs text-muted-foreground">{t('dialogs:competitorAnalysis.addThemDirectly')}</p>
                <div className="flex gap-2 max-md:flex-col">
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('dialogs:competitorAnalysis.namePlaceholder')}
                    className="h-9"
                  />
                  <Input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder={t('dialogs:competitorAnalysis.urlPlaceholder')}
                    className="h-9"
                  />
                  <Button variant="outline" size="sm" className="h-9 shrink-0" onClick={addKnown} disabled={!name.trim() || adding}>
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    {t('dialogs:competitorAnalysis.add')}
                  </Button>
                </div>
                {pool.length > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t('dialogs:competitorAnalysis.added', { names: pool.map((c) => c.name).join(', ') })}
                  </p>
                )}
              </section>

              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                {t('dialogs:competitorAnalysis.webSearches')}
              </p>
            </>
          )}
        </div>

        <AlertDialogFooter className="gap-2 max-md:flex-col-reverse">
          {onGoToCompetitors && (
            <Button variant="ghost" onClick={() => close(onGoToCompetitors)}>
              {hasAnalysis ? t('dialogs:competitorAnalysis.editInCompetitors') : t('dialogs:competitorAnalysis.goToCompetitors')}
            </Button>
          )}
          <Button variant="outline" onClick={() => close(onDecline)}>
            {t('dialogs:competitorAnalysis.skipAnalysis')}
          </Button>
          <Button onClick={() => close(onAccept)}>
            {hasAnalysis ? t('dialogs:competitorAnalysis.generateWithAnalysis') : t('dialogs:competitorAnalysis.analyzeAndGenerate')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
