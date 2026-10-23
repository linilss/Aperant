import { useEffect, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Lightbulb, Loader2, RefreshCw, Save, Search, Sparkles, Square, Swords } from 'lucide-react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Input } from '../ui/input';
import { PageHeader, PAGE_BODY, PAGE_ROOT } from '../ui/page-header';
import { cn } from '../../lib/utils';
import {
  COMPETITOR_COUNT_MAX,
  COMPETITOR_COUNT_MIN,
} from '../../../shared/types/competitors';
import {
  addManualCompetitor,
  analyzeCompetitors,
  loadCompetitors,
  moveCompetitorToPool,
  profileCompetitor,
  resynthesizeDirections,
  saveDirectionRanking,
  setupCompetitorListeners,
  stopCompetitors,
  useCompetitorStore,
} from '../../stores/competitor-store';
import { CompetitorCard } from './CompetitorCard';
import { CompetitorPool } from './CompetitorPool';
import { CoreValuesBar } from './CoreValuesBar';
import { DirectionsList } from './DirectionsList';

interface CompetitorAnalysisProps {
  projectId: string;
  onGoToRoadmap: () => void;
  onGoToIdeation?: () => void;
  /** Open the Core values view, where the values are edited */
  onEditCoreValues?: () => void;
}

function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function CompetitorAnalysis({ projectId, onGoToRoadmap, onGoToIdeation, onEditCoreValues }: CompetitorAnalysisProps) {
  const { t, i18n } = useTranslation('common');
  const data = useCompetitorStore((s) => (s.projectId === projectId ? s.data : null));
  const isRunning = useCompetitorStore((s) => s.isRunning);
  const phase = useCompetitorStore((s) => s.phase);
  const isLoading = useCompetitorStore((s) => s.isLoading);
  const error = useCompetitorStore((s) => s.error);
  const focus = useCompetitorStore((s) => s.focus);
  const count = useCompetitorStore((s) => s.count);
  const draftDirections = useCompetitorStore((s) => s.draftDirections);
  const rankingDirty = useCompetitorStore((s) => s.rankingDirty);
  const isSavingRanking = useCompetitorStore((s) => s.isSavingRanking);
  const { setFocus, setCount, setError, moveDirection, toggleAvoid, setNote } = useCompetitorStore.getState();

  useEffect(() => {
    const cleanup = setupCompetitorListeners(projectId);
    void loadCompetitors(projectId, { force: true });
    return cleanup;
  }, [projectId]);

  const competitors = data?.competitors ?? [];
  const analyzed = useMemo(() => competitors.filter((c) => c.analyzed), [competitors]);
  const pool = useMemo(
    () => competitors.filter((c) => !c.analyzed).sort((a, b) => b.relevanceScore - a.relevanceScore),
    [competitors],
  );
  const profiled = analyzed.filter((c) => c.status === 'done' || c.status === 'error').length;
  const singleRunning = competitors.some((c) => c.status === 'running') && !isRunning;
  const hasDirections = draftDirections.length > 0;
  const canSynthesize = analyzed.some((c) => c.status === 'done');
  const rankingSaved = !!data?.rankingSavedAt && !rankingDirty;

  const statusText = (() => {
    if (!isRunning) return null;
    if (phase === 'discovering') return t('competitors.progress.discovering');
    if (phase === 'profiling') return t('competitors.progress.profiling', { done: profiled, total: analyzed.length });
    if (phase === 'synthesizing') return t('competitors.progress.synthesizing');
    return t('competitors.progress.starting');
  })();

  const analyzedAtText = data?.analyzedAt
    ? t('competitors.analyzedAt', {
        date: new Date(data.analyzedAt).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
      })
    : null;

  const header = (
    <PageHeader
      icon={Swords}
      title={t('competitors.title')}
      subtitle={analyzedAtText ?? t('competitors.subtitle')}
      extra={
        statusText && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            {statusText}
          </div>
        )
      }
      actions={[
        isRunning
          ? { id: 'stop', label: t('competitors.stop'), icon: Square, onClick: () => stopCompetitors(projectId), primary: true, variant: 'outline' }
          : {
              id: 'analyze',
              label: t(data ? 'competitors.refreshAll' : 'competitors.analyze'),
              icon: data ? RefreshCw : Search,
              onClick: () => analyzeCompetitors(projectId),
              disabled: singleRunning,
              primary: true,
            },
      ]}
    >
      <CoreValuesBar projectId={projectId} onEditCoreValues={onEditCoreValues} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Input
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          placeholder={t('competitors.focusPlaceholder')}
          aria-label={t('competitors.focusLabel')}
          className="h-9 min-w-0 flex-1 basis-64 max-md:h-10"
          maxLength={500}
          disabled={isRunning}
        />
        <label className="flex items-center gap-2 text-sm max-md:w-full">
          <span className="whitespace-nowrap text-muted-foreground">{t('competitors.countLabel', { count })}</span>
          <input
            type="range"
            min={COMPETITOR_COUNT_MIN}
            max={COMPETITOR_COUNT_MAX}
            step={1}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            disabled={isRunning}
            className="w-28 accent-primary max-md:h-10 max-md:min-w-0 max-md:flex-1"
            aria-valuetext={t('competitors.countLabel', { count })}
          />
        </label>
      </div>
      {error && (
        <div className="flex items-start justify-between gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span className="min-w-0 break-words">{t('competitors.errorPrefix', { error })}</span>
          <button type="button" className="shrink-0 text-xs underline max-md:min-h-10" onClick={() => setError(null)}>
            {t('competitors.dismiss')}
          </button>
        </div>
      )}
    </PageHeader>
  );

  if (!data && !isRunning) {
    return (
      <div className={PAGE_ROOT}>
        {header}
        <div className={cn(PAGE_BODY, 'flex items-center justify-center overflow-y-auto p-6 max-md:overflow-visible max-md:p-3')}>
          {isLoading ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : (
            <Card className="w-full max-w-xl p-8 max-md:p-5">
              <Swords className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
              <h2 className="mb-2 text-center text-xl font-semibold">{t('competitors.empty.title')}</h2>
              <p className="mb-4 text-center text-muted-foreground">{t('competitors.empty.description')}</p>
              <ol className="mb-6 list-decimal space-y-1 pl-5 text-sm">
                <li>{t('competitors.empty.step1')}</li>
                <li>{t('competitors.empty.step2')}</li>
                <li>{t('competitors.empty.step3')}</li>
                <li>{t('competitors.empty.step4')}</li>
              </ol>
              <div className="flex justify-center">
                <Button size="lg" onClick={() => analyzeCompetitors(projectId)}>
                  <Search className="mr-2 h-4 w-4" />
                  {t('competitors.analyze')}
                </Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={PAGE_ROOT}>
      {header}
      <div className={cn(PAGE_BODY, 'space-y-8 overflow-y-auto p-6 max-md:space-y-6 max-md:overflow-visible max-md:p-3')}>
        <Section title={t('competitors.sections.analyzed', { count: analyzed.length })}>
          {analyzed.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {isRunning ? t('competitors.progress.discovering') : t('competitors.noneAnalyzed')}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {analyzed.map((c) => (
                <CompetitorCard
                  key={c.id}
                  competitor={c}
                  disabled={isRunning}
                  onRefresh={() => profileCompetitor(projectId, c.id)}
                  onMoveToPool={() => void moveCompetitorToPool(projectId, c.id)}
                />
              ))}
            </div>
          )}
        </Section>

        <Section title={t('competitors.sections.pool', { count: pool.length })}>
          <p className="text-xs text-muted-foreground">{t('competitors.pool.hint')}</p>
          <CompetitorPool
            pool={pool}
            disabled={isRunning}
            onDeepDive={(id) => profileCompetitor(projectId, id)}
            onAdd={(name, url) => addManualCompetitor(projectId, name, url)}
          />
        </Section>

        <Section
          title={t('competitors.sections.directions')}
          actions={
            hasDirections && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => resynthesizeDirections(projectId)}
                disabled={isRunning || !canSynthesize}
              >
                <Sparkles className="mr-1 h-4 w-4" />
                {t('competitors.directions.resynthesize')}
              </Button>
            )
          }
        >
          {data?.directionsStale && hasDirections && !isRunning && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
              <span>{t('competitors.directions.stale')}</span>
              <Button size="sm" variant="outline" onClick={() => resynthesizeDirections(projectId)} disabled={!canSynthesize}>
                <Sparkles className="mr-1 h-4 w-4" />
                {t('competitors.directions.resynthesize')}
              </Button>
            </div>
          )}
          {data?.directionsError && !isRunning && (
            <p className="text-sm text-destructive">{t('competitors.errorPrefix', { error: data.directionsError })}</p>
          )}
          {!hasDirections ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {isRunning ? t('competitors.directions.pending') : t('competitors.directions.none')}
              </p>
              {!isRunning && canSynthesize && (
                <Button size="sm" variant="outline" onClick={() => resynthesizeDirections(projectId)}>
                  <Sparkles className="mr-1 h-4 w-4" />
                  {t('competitors.directions.synthesize')}
                </Button>
              )}
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">{t('competitors.directions.hint')}</p>
              <DirectionsList
                directions={draftDirections}
                disabled={isRunning && phase === 'synthesizing'}
                onMove={moveDirection}
                onToggleAvoid={toggleAvoid}
                onNote={setNote}
              />
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <Button
                  onClick={() => void saveDirectionRanking(projectId)}
                  disabled={!rankingDirty || isSavingRanking}
                  variant={rankingDirty ? 'default' : 'outline'}
                >
                  {isSavingRanking ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
                  {t('competitors.directions.saveRanking')}
                </Button>
                {rankingSaved && (
                  <>
                    <Button onClick={onGoToRoadmap}>
                      {t('competitors.next.roadmap')}
                      <ArrowRight className="ml-1 h-4 w-4" />
                    </Button>
                    {onGoToIdeation && (
                      <Button variant="ghost" onClick={onGoToIdeation}>
                        <Lightbulb className="mr-1 h-4 w-4" />
                        {t('competitors.next.ideation')}
                      </Button>
                    )}
                  </>
                )}
              </div>
              {rankingSaved && <p className="text-xs text-muted-foreground">{t('competitors.next.hint')}</p>}
            </>
          )}
        </Section>
      </div>
    </div>
  );
}
