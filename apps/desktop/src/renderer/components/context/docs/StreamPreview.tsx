import { useEffect, useMemo, useRef } from 'react';
import { Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Tail of a streaming AI run with the most recent tool call highlighted.
 * Tool calls arrive as `[Tool: Name] input` lines, optionally prefixed with `[branch] `.
 */
export function StreamPreview({ chunk }: { chunk: string }) {
  const { t } = useTranslation('context');
  const containerRef = useRef<HTMLPreElement>(null);

  // Show last ~30 lines
  const visibleLines = useMemo(() => {
    const lines = chunk.split('\n');
    return lines.slice(Math.max(0, lines.length - 30)).join('\n');
  }, [chunk]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to bottom whenever new lines arrive
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [visibleLines]);

  const recentTool = useMemo(() => {
    const lines = chunk.split('\n');
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 5); i--) {
      const match = lines[i]?.match(/\[Tool:\s*([^\]]+)\]/);
      if (match) return match[1].trim();
    }
    return null;
  }, [chunk]);

  return (
    <div className="space-y-2">
      {recentTool && (
        <div className="flex items-center gap-1.5">
          <Wrench className="h-3 w-3 text-primary" />
          <span className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary rounded-full px-2 py-0.5 font-mono">
            {recentTool}
          </span>
        </div>
      )}
      <pre
        ref={containerRef}
        className="text-xs font-mono bg-card border border-border rounded-lg p-4 overflow-auto max-h-72 text-muted-foreground whitespace-pre-wrap leading-relaxed"
      >
        {visibleLines || t('optimizer.starting')}
      </pre>
    </div>
  );
}
