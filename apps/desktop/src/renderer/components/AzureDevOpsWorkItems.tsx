import { useState, useEffect } from 'react';
import { RefreshCw, Loader2, AlertCircle, Settings, CheckSquare, ChevronDown, ChevronRight, Download } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import { useProjectStore } from '../stores/project-store';
import { useProjectEnvStore } from '../stores/project-env-store';
import {
  useWorkItemsStore,
  loadAzureDevOpsWorkItems,
  importAzureDevOpsWorkItems,
  type AzureDevOpsWorkItem,
  type WorkItemFilterState
} from '../stores/azure-devops';

export interface AzureDevOpsWorkItemsProps {
  onOpenSettings: () => void;
  onNavigateToTask: (taskId: string) => void;
}

const FILTER_TABS: { label: string; value: WorkItemFilterState }[] = [
  { label: 'Active', value: 'active' },
  { label: 'All', value: 'all' },
  { label: 'Closed', value: 'closed' }
];

export function AzureDevOpsWorkItems({ onOpenSettings, onNavigateToTask: _onNavigateToTask }: AzureDevOpsWorkItemsProps) {
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId);
  const azureDevOpsEnabled = useProjectEnvStore((state) => state.envConfig?.azureDevOpsEnabled ?? false);

  const {
    isLoading,
    error,
    filterState,
    selectedWorkItemId,
    selectWorkItem,
    setFilterState,
    getFilteredWorkItems,
    getActiveWorkItemCount
  } = useWorkItemsStore();

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const filteredWorkItems = getFilteredWorkItems();
  const activeCount = getActiveWorkItemCount();

  // Load work items on mount and when project or filter changes
  useEffect(() => {
    if (!selectedProjectId || !azureDevOpsEnabled) return;
    loadAzureDevOpsWorkItems(selectedProjectId, filterState);
  }, [selectedProjectId, azureDevOpsEnabled, filterState]);

  if (!azureDevOpsEnabled) {
    return (
      <NotConnectedState onOpenSettings={onOpenSettings} />
    );
  }

  const handleFilterChange = (state: WorkItemFilterState) => {
    setFilterState(state);
    if (selectedProjectId) {
      loadAzureDevOpsWorkItems(selectedProjectId, state);
    }
  };

  const handleRefresh = () => {
    if (selectedProjectId) {
      loadAzureDevOpsWorkItems(selectedProjectId, filterState);
    }
  };

  const handleSelectItem = (id: number) => {
    selectWorkItem(id === selectedWorkItemId ? null : id);
  };

  const handleToggleCheckbox = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleToggleExpand = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedId(prev => (prev === id ? null : id));
  };

  const handleImport = async () => {
    if (!selectedProjectId || selectedIds.size === 0) return;
    setIsImporting(true);
    try {
      await importAzureDevOpsWorkItems(selectedProjectId, Array.from(selectedIds));
      setSelectedIds(new Set());
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <CheckSquare className="h-5 w-5 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold">Azure DevOps Work Items</h2>
            <p className="text-xs text-muted-foreground">
              {activeCount} active
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <Button
              size="sm"
              onClick={handleImport}
              disabled={isImporting}
              className="gap-1.5"
            >
              {isImporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Import {selectedIds.size} {selectedIds.size === 1 ? 'item' : 'items'}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={isLoading}
            aria-label="Refresh"
          >
            <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenSettings}
            aria-label="Open settings"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-border shrink-0">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => handleFilterChange(tab.value)}
            className={cn(
              'px-3 py-1 rounded-md text-xs font-medium transition-colors',
              filterState === tab.value
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && filteredWorkItems.length === 0 ? (
          <LoadingState />
        ) : error ? (
          <ErrorState error={error} onRetry={handleRefresh} />
        ) : filteredWorkItems.length === 0 ? (
          <EmptyState filterState={filterState} />
        ) : (
          <ul className="divide-y divide-border">
            {filteredWorkItems.map((item) => (
              <WorkItemRow
                key={item.id}
                item={item}
                isSelected={selectedWorkItemId === item.id}
                isChecked={selectedIds.has(item.id)}
                isExpanded={expandedId === item.id}
                onSelect={() => handleSelectItem(item.id)}
                onToggleCheckbox={(e) => handleToggleCheckbox(item.id, e)}
                onToggleExpand={(e) => handleToggleExpand(item.id, e)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// --- Sub-components ---

interface WorkItemRowProps {
  item: AzureDevOpsWorkItem;
  isSelected: boolean;
  isChecked: boolean;
  isExpanded: boolean;
  onSelect: () => void;
  onToggleCheckbox: (e: React.MouseEvent) => void;
  onToggleExpand: (e: React.MouseEvent) => void;
}

function WorkItemRow({
  item,
  isSelected,
  isChecked,
  isExpanded,
  onSelect,
  onToggleCheckbox,
  onToggleExpand
}: WorkItemRowProps) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'w-full flex items-start gap-3 px-4 py-3 text-left transition-colors',
          'hover:bg-accent/50',
          isSelected && 'bg-accent'
        )}
      >
        {/* Checkbox */}
        <div
          role="checkbox"
          aria-checked={isChecked}
          onClick={onToggleCheckbox}
          className={cn(
            'mt-0.5 h-4 w-4 shrink-0 rounded border border-input flex items-center justify-center cursor-pointer',
            isChecked && 'bg-primary border-primary'
          )}
        >
          {isChecked && (
            <svg className="h-2.5 w-2.5 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <span className="text-sm font-medium leading-snug truncate">{item.title}</span>
            <div className="flex items-center gap-1.5 shrink-0">
              <WorkItemTypeBadge type={item.workItemType} />
              <StateBadge state={item.state} />
            </div>
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
            <span>#{item.id}</span>
            {item.assignedTo && <span>Assigned: {item.assignedTo}</span>}
            <span>{formatDate(item.changedDate)}</span>
          </div>

          {/* Expand toggle */}
          {item.description && (
            <button
              type="button"
              onClick={onToggleExpand}
              className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {isExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              {isExpanded ? 'Hide details' : 'Show details'}
            </button>
          )}

          {/* Expanded description */}
          {isExpanded && item.description && (
            <div className="mt-2 text-xs text-muted-foreground bg-muted/50 rounded-md p-2 leading-relaxed whitespace-pre-wrap">
              {item.description}
            </div>
          )}
        </div>
      </button>
    </li>
  );
}

function WorkItemTypeBadge({ type }: { type: string }) {
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-blue-500/10 text-blue-500 border border-blue-500/20">
      {type}
    </span>
  );
}

function StateBadge({ state }: { state: string }) {
  const stateLower = state.toLowerCase();
  const isActive = !['done', 'closed', 'resolved', 'removed', 'completed'].includes(stateLower);

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border',
        isActive
          ? 'bg-green-500/10 text-green-600 border-green-500/20'
          : 'bg-muted text-muted-foreground border-border'
      )}
    >
      {state}
    </span>
  );
}

function NotConnectedState({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
      <CheckSquare className="h-12 w-12 text-muted-foreground/40" />
      <div className="space-y-1">
        <p className="text-sm font-medium">Azure DevOps not connected</p>
        <p className="text-xs text-muted-foreground">
          Enable the Azure DevOps integration in settings to view and import work items.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onOpenSettings} className="gap-2">
        <Settings className="h-3.5 w-3.5" />
        Open Settings
      </Button>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 px-8 text-center">
      <AlertCircle className="h-8 w-8 text-destructive" />
      <p className="text-sm text-destructive">{error}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function EmptyState({ filterState }: { filterState: WorkItemFilterState }) {
  const messages: Record<WorkItemFilterState, string> = {
    active: 'No active work items found.',
    closed: 'No closed work items found.',
    all: 'No work items found.'
  };

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-8">
      <CheckSquare className="h-8 w-8 text-muted-foreground/40 mb-3" />
      <p className="text-sm text-muted-foreground">{messages[filterState]}</p>
    </div>
  );
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
