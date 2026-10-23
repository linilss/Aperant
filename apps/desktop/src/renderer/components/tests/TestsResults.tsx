import { useTranslation } from 'react-i18next';
import { AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '../../lib/utils';
import { TestStatusBadge } from './TestStatusBadge';
import type { TestProject, TestResult, TestCategory } from '../../../shared/types/tests';

interface TestsResultsProps {
  project: TestProject | null;
  selectedCategory: TestCategory | 'all';
  runningTestId: string | null;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

interface TestRowProps {
  result: TestResult;
  isRunning: boolean;
}

function TestRow({ result, isRunning }: TestRowProps) {
  const { t } = useTranslation('tests');
  const [expanded, setExpanded] = useState(false);
  const hasError = !!result.errorMessage || !!result.stackTrace;
  const status = isRunning ? 'running' : result.status;

  return (
    <>
      <tr
        className={cn(
          'border-b border-border transition-colors max-md:grid max-md:grid-cols-[1fr_auto] max-md:items-center',
          hasError && 'cursor-pointer hover:bg-muted/50',
          status === 'failed' && 'bg-red-500/5',
        )}
        onClick={() => hasError && setExpanded((e) => !e)}
      >
        <td className="px-4 py-2.5 max-md:col-span-2 max-md:block max-md:px-3 max-md:pb-1">
          <div className="flex min-w-0 items-center gap-2">
            {hasError && (
              <span className="shrink-0 text-muted-foreground">
                {expanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </span>
            )}
            <span className="min-w-0 break-words text-sm text-foreground">{result.name}</span>
          </div>
        </td>
        <td className="px-4 py-2.5 text-xs text-muted-foreground max-md:hidden">{result.category}</td>
        <td className="px-4 py-2.5 max-md:block max-md:px-3 max-md:pt-0">
          <TestStatusBadge status={status} />
        </td>
        <td className="px-4 py-2.5 text-right text-xs text-muted-foreground max-md:block max-md:whitespace-nowrap max-md:px-3 max-md:pt-0">
          {result.durationMs !== undefined ? formatDuration(result.durationMs) : '—'}
        </td>
      </tr>
      {expanded && hasError && (
        <tr className="border-b border-border bg-destructive/5 max-md:block">
          <td colSpan={4} className="px-6 py-3 max-md:block max-md:px-3">
            <div className="space-y-2 max-md:min-w-0">
              {result.errorMessage && (
                <div className="flex items-start gap-2 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0 break-words">
                    <span className="font-medium">{t('results.errorMessage')}: </span>
                    {result.errorMessage}
                  </div>
                </div>
              )}
              {result.stackTrace && (
                <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">
                  {result.stackTrace}
                </pre>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function TestsResults({ project, selectedCategory, runningTestId }: TestsResultsProps) {
  const { t } = useTranslation('tests');

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">{t('results.noResults')}</p>
      </div>
    );
  }

  const filtered =
    selectedCategory === 'all'
      ? project.tests
      : project.tests.filter((r) => r.category === selectedCategory);

  const passed = filtered.filter((r) => r.status === 'passed').length;
  const failed = filtered.filter((r) => r.status === 'failed').length;
  const skipped = filtered.filter((r) => r.status === 'skipped').length;

  return (
    <div className="flex h-full flex-col max-md:h-auto">
      {/* Summary bar */}
      {filtered.length > 0 && (
        <div className="flex items-center gap-4 border-b border-border px-6 py-2 text-xs max-md:flex-wrap max-md:gap-x-3 max-md:gap-y-1 max-md:px-4">
          {passed > 0 && (
            <span className="text-green-600 dark:text-green-400">
              {t('results.passed', { count: passed })}
            </span>
          )}
          {failed > 0 && (
            <span className="text-red-600 dark:text-red-400">
              {t('results.failed', { count: failed })}
            </span>
          )}
          {skipped > 0 && (
            <span className="text-yellow-600 dark:text-yellow-400">
              {t('results.skipped', { count: skipped })}
            </span>
          )}
          <span className="ml-auto text-muted-foreground">{t('results.total', { count: filtered.length })}</span>
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1 max-md:flex-none">
        {filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8">
            <p className="text-sm text-muted-foreground">{t('results.noResults')}</p>
          </div>
        ) : (
          <table className="w-full text-left max-md:block">
            <thead className="max-md:hidden">
              <tr className="border-b border-border bg-muted/30 text-xs font-medium text-muted-foreground">
                <th className="px-4 py-2.5">{t('results.columns.test')}</th>
                <th className="px-4 py-2.5">{t('results.columns.category')}</th>
                <th className="px-4 py-2.5">{t('results.columns.status')}</th>
                <th className="px-4 py-2.5 text-right">{t('results.duration')}</th>
              </tr>
            </thead>
            <tbody className="max-md:block">
              {filtered.map((result: TestResult) => (
                <TestRow
                  key={result.id}
                  result={result}
                  isRunning={result.id === runningTestId}
                />
              ))}
            </tbody>
          </table>
        )}
      </ScrollArea>
    </div>
  );
}
