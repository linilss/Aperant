import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, ArrowDownToLine, ChevronDown, ChevronUp, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import type { CompetitorProfile } from '../../../shared/types/competitors';

/** Opens in the desktop browser, or on the phone in the LAN web UI (electron-shim) */
export function openCompetitorUrl(url: string): void {
  if (!url) return;
  const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  window.electronAPI?.openExternal?.(href)?.catch(() => undefined);
}

const RELEVANCE_VARIANT = { high: 'success', medium: 'info', low: 'muted' } as const;

function DetailList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

interface CompetitorCardProps {
  competitor: CompetitorProfile;
  disabled: boolean;
  onRefresh: () => void;
  onMoveToPool: () => void;
}

export function CompetitorCard({ competitor: c, disabled, onRefresh, onMoveToPool }: CompetitorCardProps) {
  const { t } = useTranslation('common');
  const [expanded, setExpanded] = useState(false);
  const busy = c.status === 'queued' || c.status === 'running';
  const hasProfile = !!c.profiledAt;

  return (
    <Card className={cn('flex flex-col gap-2 p-4', busy && 'opacity-80')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-semibold">{c.name}</h3>
            {hasProfile && (
              <Badge variant={RELEVANCE_VARIANT[c.relevance]} className="text-xs">
                {t(`competitors.relevance.${c.relevance}`)}
              </Badge>
            )}
            {c.source === 'manual' && (
              <Badge variant="outline" className="text-xs">
                {t('competitors.manual')}
              </Badge>
            )}
          </div>
          {c.url && (
            <button
              type="button"
              onClick={() => openCompetitorUrl(c.url)}
              className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-xs text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3 shrink-0" />
              <span className="truncate">{c.url.replace(/^https?:\/\//, '')}</span>
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onRefresh}
            disabled={disabled || busy}
            aria-label={t('competitors.card.refresh')}
            title={t('competitors.card.refresh')}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onMoveToPool}
            disabled={disabled || busy}
            aria-label={t('competitors.card.moveToPool')}
            title={t('competitors.card.moveToPool')}
          >
            <ArrowDownToLine className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {busy ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {c.status === 'running' && <Loader2 className="h-4 w-4 animate-spin" />}
          {t(c.status === 'running' ? 'competitors.status.running' : 'competitors.status.queued')}
        </div>
      ) : (
        <p className="text-sm">{c.positioning || c.oneLiner}</p>
      )}

      {c.status === 'error' && (
        <div className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t('competitors.status.error', { error: c.error ?? '' })}</span>
        </div>
      )}

      {hasProfile && (
        <>
          {c.differentiator && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">{t('competitors.card.differentiator')}: </span>
              {c.differentiator}
            </p>
          )}
          {expanded && (
            <div className="space-y-2 border-t border-border pt-2">
              {c.targetAudience && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground">{t('competitors.card.audience')}</div>
                  <p className="text-sm">{c.targetAudience}</p>
                </div>
              )}
              <div>
                <div className="text-xs font-medium text-muted-foreground">{t('competitors.card.pricing')}</div>
                <p className="text-sm">{c.pricingModel || t('competitors.card.pricingUnknown')}</p>
              </div>
              <DetailList label={t('competitors.card.keyFeatures')} items={c.keyFeatures} />
              <DetailList label={t('competitors.card.strengths')} items={c.strengths} />
              <DetailList label={t('competitors.card.weaknesses')} items={c.weaknesses} />
              <DetailList
                label={t('competitors.card.painPoints')}
                items={c.painPoints.map((p) => (p.source ? `${p.description} (${p.source})` : p.description))}
              />
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="self-start px-1"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronUp className="mr-1 h-3.5 w-3.5" /> : <ChevronDown className="mr-1 h-3.5 w-3.5" />}
            {t(expanded ? 'competitors.card.less' : 'competitors.card.more')}
          </Button>
        </>
      )}
    </Card>
  );
}
