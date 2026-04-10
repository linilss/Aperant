import { useState, useEffect } from 'react';
import {
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertCircle,
  GitBranch,
  ChevronDown
} from 'lucide-react';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Switch } from '../../ui/switch';
import { Separator } from '../../ui/separator';
import { Button } from '../../ui/button';
import { PasswordInput } from '../../project-settings/PasswordInput';
import { cn } from '../../../lib/utils';
import type { ProjectEnvConfig, ProjectSettings } from '@shared/types';
import type { AzureDevOpsSyncStatus } from '../../../stores/azure-devops';

interface AzureDevOpsIntegrationProps {
  envConfig: ProjectEnvConfig | null;
  updateEnvConfig: (updates: Partial<ProjectEnvConfig>) => void;
  azureDevOpsConnectionStatus: AzureDevOpsSyncStatus | null;
  isCheckingAzureDevOps: boolean;
  projectPath?: string;
  settings?: ProjectSettings;
  setSettings?: React.Dispatch<React.SetStateAction<ProjectSettings>>;
}

/**
 * Azure DevOps integration settings component.
 * Manages PAT authentication, org URL, project configuration, branch selection,
 * and connection status. PAT-only auth (no OAuth/CLI required).
 */
export function AzureDevOpsIntegration({
  envConfig,
  updateEnvConfig,
  azureDevOpsConnectionStatus,
  isCheckingAzureDevOps,
  projectPath,
  settings,
  setSettings
}: AzureDevOpsIntegrationProps) {
  const [branches, setBranches] = useState<string[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [isBranchDropdownOpen, setIsBranchDropdownOpen] = useState(false);

  /**
   * Handler for branch selection changes.
   * Updates BOTH project.settings.mainBranch (primary source for the Electron app)
   * and envConfig.defaultBranch (for CLI backward compatibility).
   */
  const handleBranchChange = (branch: string) => {
    if (setSettings) {
      setSettings((prev: ProjectSettings) => ({ ...prev, mainBranch: branch }));
    }
    updateEnvConfig({ defaultBranch: branch });
    setIsBranchDropdownOpen(false);
  };

  // Auto-detect Azure DevOps repo and pre-fill org URL / project when integration is enabled
  useEffect(() => {
    if (!envConfig?.azureDevOpsEnabled || !projectPath) return;

    const detectAndFetchBranches = async () => {
      // Try to auto-detect repo details if fields are not yet populated
      if (!envConfig.azureDevOpsOrgUrl || !envConfig.azureDevOpsProject) {
        try {
          const result = await window.electronAPI.detectAzureDevOpsRepo(projectPath);
          if (result.success && result.data) {
            if (!envConfig.azureDevOpsOrgUrl && result.data.orgUrl) {
              updateEnvConfig({ azureDevOpsOrgUrl: result.data.orgUrl });
            }
            if (!envConfig.azureDevOpsProject && result.data.project) {
              updateEnvConfig({ azureDevOpsProject: result.data.project });
            }
          }
        } catch {
          // Detection failure is non-fatal
        }
      }

      // Fetch branches via Azure DevOps API (requires projectId, uses projectPath as fallback)
      await fetchBranches();
    };

    detectAndFetchBranches();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envConfig?.azureDevOpsEnabled, projectPath]);

  const fetchBranches = async () => {
    if (!projectPath) return;

    setIsLoadingBranches(true);
    setBranchesError(null);

    try {
      // Use projectPath as the projectId for branch fetching — matches how GitLab does it
      const result = await window.electronAPI.getAzureDevOpsBranches(projectPath);

      if (result.success && result.data) {
        setBranches(result.data);

        // Auto-detect default branch if none is set
        if (!settings?.mainBranch && !envConfig?.defaultBranch && result.data.length > 0) {
          const detectResult = await window.electronAPI.detectMainBranch(projectPath);
          if (detectResult.success && detectResult.data) {
            handleBranchChange(detectResult.data);
          }
        }
      } else {
        setBranchesError(result.error ?? 'Failed to load branches');
      }
    } catch (err) {
      setBranchesError(err instanceof Error ? err.message : 'Failed to load branches');
    } finally {
      setIsLoadingBranches(false);
    }
  };

  if (!envConfig) return null;

  const selectedBranch = settings?.mainBranch || envConfig.defaultBranch || '';
  const hasCredentials = !!(envConfig.azureDevOpsToken && envConfig.azureDevOpsOrgUrl && envConfig.azureDevOpsProject);

  return (
    <div className="space-y-4">
      {/* Enable toggle */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="font-normal text-foreground">Enable Azure DevOps Integration</Label>
          <p className="text-xs text-muted-foreground">
            Import work items as tasks and view pull requests from Azure DevOps.
          </p>
        </div>
        <Switch
          checked={envConfig.azureDevOpsEnabled}
          onCheckedChange={(checked) => updateEnvConfig({ azureDevOpsEnabled: checked })}
        />
      </div>

      {envConfig.azureDevOpsEnabled && (
        <>
          {/* PAT Token */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">Personal Access Token</Label>
            <p className="text-xs text-muted-foreground">
              Create a PAT with <code className="px-1 bg-muted rounded">Work Items (Read)</code> and{' '}
              <code className="px-1 bg-muted rounded">Code (Read)</code> scopes in your{' '}
              <a
                href="https://dev.azure.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-info hover:underline"
              >
                Azure DevOps settings
              </a>.
            </p>
            <PasswordInput
              value={envConfig.azureDevOpsToken ?? ''}
              onChange={(value) => updateEnvConfig({ azureDevOpsToken: value })}
              placeholder="Personal Access Token"
            />
          </div>

          {/* Organization URL */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">Organization URL</Label>
            <p className="text-xs text-muted-foreground">
              The URL of your Azure DevOps organization.
            </p>
            <Input
              placeholder="https://dev.azure.com/myorg"
              value={envConfig.azureDevOpsOrgUrl ?? ''}
              onChange={(e) => updateEnvConfig({ azureDevOpsOrgUrl: e.target.value })}
            />
          </div>

          {/* Project name */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">Project Name</Label>
            <p className="text-xs text-muted-foreground">
              The name of the Azure DevOps project containing your work items and repositories.
            </p>
            <Input
              placeholder="MyProject"
              value={envConfig.azureDevOpsProject ?? ''}
              onChange={(e) => updateEnvConfig({ azureDevOpsProject: e.target.value })}
            />
          </div>

          {/* Connection status */}
          {hasCredentials && (
            <ConnectionStatus
              isChecking={isCheckingAzureDevOps}
              connectionStatus={azureDevOpsConnectionStatus}
            />
          )}

          <Separator />

          {/* Default Branch Selector */}
          {projectPath && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-muted-foreground" />
                  <Label className="text-sm font-medium text-foreground">Default Branch</Label>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={fetchBranches}
                  disabled={isLoadingBranches}
                  className="h-7 px-2"
                >
                  <RefreshCw className={cn('h-3 w-3', isLoadingBranches && 'animate-spin')} />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                The main branch used as the base for worktrees and task isolation.
              </p>

              {branchesError && (
                <div className="flex items-center gap-2 text-xs text-destructive">
                  <AlertCircle className="h-3 w-3" />
                  {branchesError}
                </div>
              )}

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsBranchDropdownOpen(!isBranchDropdownOpen)}
                  disabled={isLoadingBranches || branches.length === 0}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm border border-input rounded-md bg-background hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                >
                  {isLoadingBranches ? (
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading branches...
                    </span>
                  ) : selectedBranch ? (
                    <span className="flex items-center gap-2">
                      <GitBranch className="h-3 w-3 text-muted-foreground" />
                      {selectedBranch}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      {branches.length === 0 ? 'No branches found' : 'Select a branch'}
                    </span>
                  )}
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 text-muted-foreground transition-transform',
                      isBranchDropdownOpen && 'rotate-180'
                    )}
                  />
                </button>

                {isBranchDropdownOpen && branches.length > 0 && (
                  <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
                    {branches.map((branch) => (
                      <button
                        key={branch}
                        type="button"
                        onClick={() => handleBranchChange(branch)}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-2 text-sm text-left',
                          'hover:bg-accent hover:text-accent-foreground',
                          selectedBranch === branch && 'bg-accent text-accent-foreground'
                        )}
                      >
                        <GitBranch className="h-3 w-3 text-muted-foreground shrink-0" />
                        {branch}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface ConnectionStatusProps {
  isChecking: boolean;
  connectionStatus: AzureDevOpsSyncStatus | null;
}

function ConnectionStatus({ isChecking, connectionStatus }: ConnectionStatusProps) {
  if (isChecking) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Testing connection...
      </div>
    );
  }

  if (!connectionStatus) return null;

  if (connectionStatus.connected) {
    return (
      <div className="rounded-lg border border-success/30 bg-success/10 p-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <div className="flex-1">
            <p className="text-sm font-medium text-success">Connected</p>
            {connectionStatus.projectName && (
              <p className="text-xs text-success/80 mt-0.5">
                Project: {connectionStatus.projectName}
                {connectionStatus.workItemCount !== undefined && (
                  <span className="ml-2">({connectionStatus.workItemCount} work items)</span>
                )}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
      <div className="flex items-center gap-2">
        <AlertCircle className="h-4 w-4 text-destructive" />
        <div>
          <p className="text-sm font-medium text-destructive">Connection failed</p>
          {connectionStatus.error && (
            <p className="text-xs text-destructive/80 mt-0.5">{connectionStatus.error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
