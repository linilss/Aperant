import { useRef, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Wrench } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTaskStore } from '../../stores/task-store';
import { estimateCost, formatCost } from '../../shared/lib/estimateCost';
import type { TraceEntry } from '../../../shared/types/trace-types';
import type { Task } from '../../../shared/types';

interface AgentTracePanelProps {
  task: Task;
  modelId?: string;
}

interface TraceEntryRowProps {
  entry: TraceEntry;
  modelId?: string;
}

function TraceEntryRow({ entry, modelId }: TraceEntryRowProps) {
  const cost = modelId ? estimateCost(entry.usage, modelId) : undefined;
  const tokens = entry.usage.promptTokens + entry.usage.completionTokens;

  return (
    <div className="flex items-start gap-2 py-1.5 px-3 hover:bg-muted/30 border-b border-border/30 last:border-0">
      <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
        <span className="text-xs text-muted-foreground font-mono w-6 text-right">{entry.stepNumber}</span>
        <Wrench className="h-3 w-3 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground truncate">{entry.toolName}</span>
          {tokens > 0 && (
            <span className="text-xs text-muted-foreground shrink-0">
              {tokens.toLocaleString()}t
            </span>
          )}
          {cost !== undefined && (
            <span className="text-xs text-muted-foreground shrink-0">{formatCost(cost)}</span>
          )}
        </div>
        {entry.argsSummary && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">{entry.argsSummary}</p>
        )}
      </div>
    </div>
  );
}

export function AgentTracePanel({ task, modelId }: AgentTracePanelProps) {
  const { t } = useTranslation(['tasks']);
  const agentTrace = useTaskStore((state) => state.agentTraces[task.id]);
  const entries = agentTrace?.entries ?? [];
  const cumulativeUsage = agentTrace?.cumulativeUsage;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const isRunning = task.status === 'in_progress';

  useEffect(() => {
    if (!autoScroll || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [entries.length, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(atBottom);
  };

  if (entries.length === 0) {
    if (!isRunning) return null;
    return (
      <div className="px-3 py-4 text-xs text-muted-foreground text-center">
        {t('tasks:trace.noEntries')}
      </div>
    );
  }

  const totalCost = cumulativeUsage && modelId
    ? estimateCost(cumulativeUsage, modelId)
    : undefined;

  return (
    <div className="flex flex-col h-full">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto min-h-0"
      >
        {entries.map((entry) => (
          <TraceEntryRow key={`${entry.stepNumber}-${entry.timestamp}`} entry={entry} modelId={modelId} />
        ))}
      </div>

      {cumulativeUsage && (
        <div className="border-t border-border px-3 py-2 shrink-0 flex items-center gap-4 text-xs text-muted-foreground bg-muted/20">
          <span>
            <span className="font-medium text-foreground">{(cumulativeUsage.promptTokens).toLocaleString()}</span>
            {' '}{t('tasks:trace.promptTokens')}
          </span>
          <span>
            <span className="font-medium text-foreground">{(cumulativeUsage.completionTokens).toLocaleString()}</span>
            {' '}{t('tasks:trace.completionTokens')}
          </span>
          {(cumulativeUsage.cacheReadTokens ?? 0) > 0 && (
            <span>
              <span className="font-medium text-foreground">{(cumulativeUsage.cacheReadTokens ?? 0).toLocaleString()}</span>
              {' '}{t('tasks:trace.cacheReadTokens')}
            </span>
          )}
          {totalCost !== undefined && (
            <span className="ml-auto font-medium text-foreground">{formatCost(totalCost)}</span>
          )}
        </div>
      )}
    </div>
  );
}

interface CollapsibleTraceSectionProps {
  task: Task;
  modelId?: string;
}

export function CollapsibleTraceSection({ task, modelId }: CollapsibleTraceSectionProps) {
  const { t } = useTranslation(['tasks']);
  const [expanded, setExpanded] = useState(false);
  const agentTrace = useTaskStore((state) => state.agentTraces[task.id]);
  const entryCount = agentTrace?.entries.length ?? 0;

  if (entryCount === 0 && task.status !== 'in_progress') return null;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-muted/30 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <span>{t('tasks:trace.title')}</span>
        {entryCount > 0 && (
          <span className="text-xs text-muted-foreground">
            ({entryCount} {t('tasks:trace.steps')})
          </span>
        )}
      </button>
      {expanded && (
        <div className="h-72 border-t border-border">
          <AgentTracePanel task={task} modelId={modelId} />
        </div>
      )}
    </div>
  );
}
