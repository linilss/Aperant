import { useState, useEffect } from 'react';
import { RefreshCw, Loader2, AlertCircle, Settings, GitPullRequest, ArrowRight, ExternalLink } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import { useProjectStore } from '../stores/project-store';
import { useProjectEnvStore } from '../stores/project-env-store';
import type { AzureDevOpsPullRequest } from '../stores/azure-devops';

type PRFilterState = 'active' | 'completed' | 'all';

const FILTER_TABS: { label: string; value: PRFilterState }[] = [
  { label: 'Active', value: 'active' },
  { label: 'All', value: 'all' },
  { label: 'Completed', value: 'completed' }
];

export interface AzureDevOpsPRsProps {
  onOpenSettings: () => void;
}

export function AzureDevOpsPRs({ onOpenSettings }: AzureDevOpsPRsProps) {
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId);
  const azureDevOpsEnabled = useProjectEnvStore((state) => state.envConfig?.azureDevOpsEnabled ?? false);

  const [pullRequests, setPullRequests] = useState<AzureDevOpsPullRequest[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterState, setFilterState] = useState<PRFilterState>('active');

  const fetchPRs = async (state: PRFilterState) => {
    if (!selectedProjectId) return;
    setIsLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI.getAzureDevOpsPullRequests(selectedProjectId, state);
      if (result.success && result.data) {
        setPullRequests(result.data);
      } else {
        setError(result.error ?? 'Failed to load pull requests');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedProjectId || !azureDevOpsEnabled) return;
    fetchPRs(filterState);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, azureDevOpsEnabled, filterState]);

  if (!azureDevOpsEnabled) {
    return <NotConnectedState onOpenSettings={onOpenSettings} />;
  }

  const handleFilterChange = (state: PRFilterState) => {
    setFilterState(state);
  };

  const handleRefresh = () => {
    fetchPRs(filterState);
  };

  const handleOpenPR = (webUrl: string) => {
    window.electronAPI.openExternal(webUrl);
  };

  const filteredPRs = filterState === 'all'
    ? pullRequests
    : pullRequests.filter((pr) => pr.status === filterState);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <GitPullRequest className="h-5 w-5 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold">Azure DevOps Pull Requests</h2>
            <p className="text-xs text-muted-foreground">
              {filteredPRs.length} {filterState === 'all' ? 'total' : filterState}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
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
        {isLoading && filteredPRs.length === 0 ? (
          <LoadingState />
        ) : error ? (
          <ErrorState error={error} onRetry={handleRefresh} />
        ) : filteredPRs.length === 0 ? (
          <EmptyState filterState={filterState} />
        ) : (
          <ul className="divide-y divide-border">
            {filteredPRs.map((pr) => (
              <PRRow key={pr.pullRequestId} pr={pr} onOpen={() => handleOpenPR(pr.webUrl)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// --- Sub-components ---

function PRRow({ pr, onOpen }: { pr: AzureDevOpsPullRequest; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50 group"
      >
        <GitPullRequest className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <span className="text-sm font-medium leading-snug">{pr.title}</span>
            <div className="flex items-center gap-1.5 shrink-0">
              <PRStatusBadge status={pr.status} />
              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>

          {/* Branch info */}
          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-mono truncate max-w-[120px]">{stripRefPrefix(pr.sourceBranch)}</span>
            <ArrowRight className="h-3 w-3 shrink-0" />
            <span className="font-mono truncate max-w-[120px]">{stripRefPrefix(pr.targetBranch)}</span>
          </div>

          {/* Meta */}
          <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
            <span>#{pr.pullRequestId}</span>
            <span>{pr.repositoryName}</span>
            <span>by {pr.createdBy}</span>
            <span>{formatDate(pr.creationDate)}</span>
            {pr.reviewers.length > 0 && (
              <span>{pr.reviewers.length} reviewer{pr.reviewers.length !== 1 ? 's' : ''}</span>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

function PRStatusBadge({ status }: { status: AzureDevOpsPullRequest['status'] }) {
  const config: Record<AzureDevOpsPullRequest['status'], { label: string; className: string }> = {
    active: {
      label: 'Active',
      className: 'bg-green-500/10 text-green-600 border-green-500/20'
    },
    completed: {
      label: 'Completed',
      className: 'bg-blue-500/10 text-blue-500 border-blue-500/20'
    },
    abandoned: {
      label: 'Abandoned',
      className: 'bg-muted text-muted-foreground border-border'
    }
  };

  const { label, className } = config[status];

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border',
        className
      )}
    >
      {label}
    </span>
  );
}

function NotConnectedState({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
      <GitPullRequest className="h-12 w-12 text-muted-foreground/40" />
      <div className="space-y-1">
        <p className="text-sm font-medium">Azure DevOps not connected</p>
        <p className="text-xs text-muted-foreground">
          Enable the Azure DevOps integration in settings to view pull requests.
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

function EmptyState({ filterState }: { filterState: PRFilterState }) {
  const messages: Record<PRFilterState, string> = {
    active: 'No active pull requests found.',
    completed: 'No completed pull requests found.',
    all: 'No pull requests found.'
  };

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-8">
      <GitPullRequest className="h-8 w-8 text-muted-foreground/40 mb-3" />
      <p className="text-sm text-muted-foreground">{messages[filterState]}</p>
    </div>
  );
}

/** Strip the Azure DevOps `refs/heads/` prefix from branch names. */
function stripRefPrefix(branch: string): string {
  return branch.replace(/^refs\/heads\//, '');
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
