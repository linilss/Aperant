import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, ExternalLink, Loader2, Plus, ScanSearch } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import type { CompetitorProfile } from '../../../shared/types/competitors';
import { openCompetitorUrl } from './CompetitorCard';

interface CompetitorPoolProps {
  pool: CompetitorProfile[];
  disabled: boolean;
  onDeepDive: (competitorId: string) => void;
  /** Resolves to an error code/message, or null on success */
  onAdd: (name: string, url: string) => Promise<string | null>;
}

export function CompetitorPool({ pool, disabled, onDeepDive, onAdd }: CompetitorPoolProps) {
  const { t } = useTranslation('common');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setAdding(true);
    const error = await onAdd(name.trim(), url.trim());
    setAdding(false);
    if (error) {
      setAddError(error === 'duplicate' ? t('competitors.pool.duplicate') : error);
      return;
    }
    setAddError(null);
    setName('');
    setUrl('');
  };

  return (
    <div className="space-y-2">
      {pool.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('competitors.pool.empty')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {pool.map((c) => {
            const running = c.status === 'running' || c.status === 'queued';
            return (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-medium">{c.name}</span>
                    {c.source === 'manual' && (
                      <Badge variant="outline" className="text-xs">
                        {t('competitors.manual')}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {t('competitors.pool.score', { score: c.relevanceScore })}
                    </span>
                    {c.url && (
                      <button
                        type="button"
                        onClick={() => openCompetitorUrl(c.url)}
                        className="inline-flex min-w-0 items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <ExternalLink className="h-3 w-3 shrink-0" />
                        <span className="truncate">{c.url.replace(/^https?:\/\//, '')}</span>
                      </button>
                    )}
                  </div>
                  {running ? (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {t('competitors.status.running')}
                    </div>
                  ) : c.status === 'error' ? (
                    <div className="flex items-center gap-1.5 text-xs text-destructive">
                      <AlertCircle className="h-3 w-3 shrink-0" />
                      <span className="truncate">{t('competitors.status.error', { error: c.error ?? '' })}</span>
                    </div>
                  ) : (
                    c.oneLiner && <p className="truncate text-xs text-muted-foreground">{c.oneLiner}</p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 max-md:h-10 max-md:w-10"
                  onClick={() => onDeepDive(c.id)}
                  disabled={disabled || running}
                  aria-label={t('competitors.pool.deepDive', { name: c.name })}
                  title={t('competitors.pool.deepDive', { name: c.name })}
                >
                  {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={handleAdd} className="flex flex-wrap items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('competitors.pool.namePlaceholder')}
          aria-label={t('competitors.pool.namePlaceholder')}
          className="h-9 min-w-0 flex-1 basis-40 max-md:h-10"
          maxLength={120}
        />
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t('competitors.pool.urlPlaceholder')}
          aria-label={t('competitors.pool.urlPlaceholder')}
          className="h-9 min-w-0 flex-1 basis-40 max-md:h-10"
          maxLength={500}
        />
        <Button type="submit" variant="outline" size="sm" className="h-9 max-md:h-10" disabled={!name.trim() || adding}>
          <Plus className="mr-1 h-4 w-4" />
          {t('competitors.pool.add')}
        </Button>
      </form>
      {addError && <p className="text-xs text-destructive">{addError}</p>}
    </div>
  );
}
