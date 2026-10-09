import { useState, type ReactNode } from 'react';
import { Check, Copy, FileText, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import type { ProjectSummary } from '../../../../shared/types';

function CopyableCommand({ command, description }: { command: string; description: string }) {
  const { t } = useTranslation('context');
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — nothing to do
    }
  };

  return (
    <li className="flex items-center gap-2 max-md:flex-wrap max-md:gap-1">
      <button
        type="button"
        onClick={copy}
        title={copied ? t('index.summary.copied') : t('index.summary.copy')}
        className="group flex min-w-0 items-center gap-1.5 rounded bg-muted px-2 py-1 font-mono text-xs text-foreground hover:bg-muted/70"
      >
        <code className="truncate">{command}</code>
        {copied ? (
          <Check className="h-3 w-3 shrink-0 text-success" />
        ) : (
          <Copy className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 max-md:opacity-100" />
        )}
      </button>
      {description && <span className="truncate text-xs text-muted-foreground">{description}</span>}
    </li>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h4>
      {children}
    </div>
  );
}

interface ProjectSummaryContentProps {
  summary: ProjectSummary;
  /** Resolve a key module path to the code branch it belongs to (enables the link) */
  branchFor?: (path: string) => string | null;
  onShowBranch?: (branch: string) => void;
}

/** Summary body; also used to review a proposed summary */
export function ProjectSummaryContent({ summary, branchFor, onShowBranch }: ProjectSummaryContentProps) {
  const { t } = useTranslation('context');
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-foreground">{summary.overview}</p>

      {summary.stack.length > 0 && (
        <Section title={t('index.summary.stack')}>
          <div className="flex flex-wrap gap-1">
            {summary.stack.map((item) => (
              <Badge key={item} variant="secondary" className="text-xs">
                {item}
              </Badge>
            ))}
          </div>
        </Section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {summary.commands.length > 0 && (
          <Section title={t('index.summary.commands')}>
            <ul className="space-y-1">
              {summary.commands.map((c) => (
                <CopyableCommand key={c.command} command={c.command} description={c.description} />
              ))}
            </ul>
          </Section>
        )}
        {summary.entryPoints.length > 0 && (
          <Section title={t('index.summary.entryPoints')}>
            <ul className="space-y-1">
              {summary.entryPoints.map((e) => (
                <li key={e.path} className="flex min-w-0 items-baseline gap-2 text-xs">
                  <code className="shrink-0 font-mono text-foreground">{e.path}</code>
                  <span className="truncate text-muted-foreground">{e.description}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>

      {summary.keyModules.length > 0 && (
        <Section title={t('index.summary.keyModules')}>
          <ul className="grid gap-1 md:grid-cols-2">
            {summary.keyModules.map((m) => {
              const branch = branchFor?.(m.path) ?? null;
              return (
                <li key={m.path} className="flex min-w-0 items-baseline gap-2 text-xs">
                  {branch !== null && onShowBranch ? (
                    <button
                      type="button"
                      onClick={() => onShowBranch(branch)}
                      title={t('index.summary.showBranch')}
                      className="shrink-0 font-mono text-primary hover:underline"
                    >
                      {m.path}
                    </button>
                  ) : (
                    <code className="shrink-0 font-mono text-foreground">{m.path}</code>
                  )}
                  <span className="truncate text-muted-foreground" title={m.summary}>
                    {m.summary}
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
    </div>
  );
}

interface ProjectSummaryCardProps {
  summary: ProjectSummary | null;
  optimizerRunning: boolean;
  onOptimize: () => void;
  branchFor: (path: string) => string | null;
  onShowBranch: (branch: string) => void;
}

export function ProjectSummaryCard({
  summary,
  optimizerRunning,
  onOptimize,
  branchFor,
  onShowBranch,
}: ProjectSummaryCardProps) {
  const { t } = useTranslation('context');

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4 text-muted-foreground" />
          {t('index.summary.title')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {summary ? (
          <ProjectSummaryContent summary={summary} branchFor={branchFor} onShowBranch={onShowBranch} />
        ) : (
          <div className="flex flex-col items-center py-6 text-center">
            <h3 className="text-sm font-medium text-foreground">{t('index.summary.empty')}</h3>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">{t('index.summary.emptyHint')}</p>
            <Button size="sm" className="mt-4" onClick={onOptimize} disabled={optimizerRunning}>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              {t('index.summary.optimize')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
