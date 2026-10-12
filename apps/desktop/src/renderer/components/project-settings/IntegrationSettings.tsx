import {
  Zap,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Import,
  Github
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { Separator } from '../ui/separator';
import type { ProjectEnvConfig, LinearSyncStatus, GitHubSyncStatus, Project, ProjectSettings as ProjectSettingsType } from '../../../shared/types';

interface IntegrationSettingsProps {
  envConfig: ProjectEnvConfig | null;
  updateEnvConfig: (updates: Partial<ProjectEnvConfig>) => void;

  // Project settings (main branch moved to General settings)
  project: Project;
  settings: ProjectSettingsType;
  setSettings: React.Dispatch<React.SetStateAction<ProjectSettingsType>>;

  // Linear state
  showLinearKey: boolean;
  setShowLinearKey: React.Dispatch<React.SetStateAction<boolean>>;
  linearConnectionStatus: LinearSyncStatus | null;
  isCheckingLinear: boolean;
  linearExpanded: boolean;
  onLinearToggle: () => void;
  onOpenLinearImport: () => void;

  // GitHub state
  showGitHubToken: boolean;
  setShowGitHubToken: React.Dispatch<React.SetStateAction<boolean>>;
  gitHubConnectionStatus: GitHubSyncStatus | null;
  isCheckingGitHub: boolean;
  githubExpanded: boolean;
  onGitHubToggle: () => void;
}

export function IntegrationSettings({
  envConfig,
  updateEnvConfig,
  showLinearKey,
  setShowLinearKey,
  linearConnectionStatus,
  isCheckingLinear,
  linearExpanded,
  onLinearToggle,
  onOpenLinearImport,
  showGitHubToken,
  setShowGitHubToken,
  gitHubConnectionStatus,
  isCheckingGitHub,
  githubExpanded,
  onGitHubToggle
}: IntegrationSettingsProps) {
  if (!envConfig) return null;

  return (
    <>
      {/* Linear Integration Section */}
      <section className="space-y-3">
        <button
          onClick={onLinearToggle}
          className="w-full flex items-center justify-between text-sm font-semibold text-foreground hover:text-foreground/80"
        >
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4" />
            Linear Integration
            {envConfig.linearEnabled && (
              <span className="px-2 py-0.5 text-xs bg-success/10 text-success rounded-full">
                Enabled
              </span>
            )}
          </div>
          {linearExpanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>

        {linearExpanded && (
          <div className="space-y-4 pl-6 pt-2">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="font-normal text-foreground">Enable Linear Sync</Label>
                <p className="text-xs text-muted-foreground">
                  Create and update Linear issues automatically
                </p>
              </div>
              <Switch
                checked={envConfig.linearEnabled}
                onCheckedChange={(checked) => updateEnvConfig({ linearEnabled: checked })}
              />
            </div>

            {envConfig.linearEnabled && (
              <>
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-foreground">API Key</Label>
                  <p className="text-xs text-muted-foreground">
                    Get your API key from{' '}
                    <a
                      href="https://linear.app/settings/api"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-info hover:underline"
                    >
                      Linear Settings
                    </a>
                  </p>
                  <div className="relative">
                    <Input
                      type={showLinearKey ? 'text' : 'password'}
                      placeholder="lin_api_xxxxxxxx"
                      value={envConfig.linearApiKey || ''}
                      onChange={(e) => updateEnvConfig({ linearApiKey: e.target.value })}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLinearKey(!showLinearKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showLinearKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* Connection Status */}
                {envConfig.linearApiKey && (
                  <div className="rounded-lg border border-border bg-muted/30 p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-foreground">Connection Status</p>
                        <p className="text-xs text-muted-foreground">
                          {isCheckingLinear ? 'Checking...' :
                            linearConnectionStatus?.connected
                              ? `Connected${linearConnectionStatus.teamName ? ` to ${linearConnectionStatus.teamName}` : ''}`
                              : linearConnectionStatus?.error || 'Not connected'}
                        </p>
                        {linearConnectionStatus?.connected && linearConnectionStatus.issueCount !== undefined && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {linearConnectionStatus.issueCount}+ tasks available to import
                          </p>
                        )}
                      </div>
                      {isCheckingLinear ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : linearConnectionStatus?.connected ? (
                        <CheckCircle2 className="h-4 w-4 text-success" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-warning" />
                      )}
                    </div>
                  </div>
                )}

                {/* Import Existing Tasks Button */}
                {linearConnectionStatus?.connected && (
                  <div className="rounded-lg border border-info/30 bg-info/5 p-3">
                    <div className="flex items-start gap-3">
                      <Import className="h-5 w-5 text-info mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-foreground">Import Existing Tasks</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Select which Linear issues to import into AutoBuild as tasks.
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2"
                          onClick={onOpenLinearImport}
                        >
                          <Import className="h-4 w-4 mr-2" />
                          Import Tasks from Linear
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                <Separator />

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-foreground">Team ID (Optional)</Label>
                    <Input
                      placeholder="Auto-detected"
                      value={envConfig.linearTeamId || ''}
                      onChange={(e) => updateEnvConfig({ linearTeamId: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-foreground">Project ID (Optional)</Label>
                    <Input
                      placeholder="Auto-created"
                      value={envConfig.linearProjectId || ''}
                      onChange={(e) => updateEnvConfig({ linearProjectId: e.target.value })}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </section>

      <Separator />

      {/* GitHub Integration Section */}
      <section className="space-y-3">
        <button
          onClick={onGitHubToggle}
          className="w-full flex items-center justify-between text-sm font-semibold text-foreground hover:text-foreground/80"
        >
          <div className="flex items-center gap-2">
            <Github className="h-4 w-4" />
            GitHub Integration
            {envConfig.githubEnabled && (
              <span className="px-2 py-0.5 text-xs bg-success/10 text-success rounded-full">
                Enabled
              </span>
            )}
          </div>
          {githubExpanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>

        {githubExpanded && (
          <div className="space-y-4 pl-6 pt-2">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="font-normal text-foreground">Enable GitHub Issues</Label>
                <p className="text-xs text-muted-foreground">
                  Sync issues from GitHub and create tasks automatically
                </p>
              </div>
              <Switch
                checked={envConfig.githubEnabled}
                onCheckedChange={(checked) => updateEnvConfig({ githubEnabled: checked })}
              />
            </div>

            {envConfig.githubEnabled && (
              <>
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-foreground">Personal Access Token</Label>
                  <p className="text-xs text-muted-foreground">
                    Create a token with <code className="px-1 bg-muted rounded">repo</code> scope from{' '}
                    <a
                      href="https://github.com/settings/tokens/new?scopes=repo&description=Auto-Build-UI"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-info hover:underline"
                    >
                      GitHub Settings
                    </a>
                  </p>
                  <div className="relative">
                    <Input
                      type={showGitHubToken ? 'text' : 'password'}
                      placeholder="ghp_xxxxxxxx or github_pat_xxxxxxxx"
                      value={envConfig.githubToken || ''}
                      onChange={(e) => updateEnvConfig({ githubToken: e.target.value })}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowGitHubToken(!showGitHubToken)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showGitHubToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium text-foreground">Repository</Label>
                  <p className="text-xs text-muted-foreground">
                    Format: <code className="px-1 bg-muted rounded">owner/repo</code> (e.g., facebook/react)
                  </p>
                  <Input
                    placeholder="owner/repository"
                    value={envConfig.githubRepo || ''}
                    onChange={(e) => updateEnvConfig({ githubRepo: e.target.value })}
                  />
                </div>

                {/* Connection Status */}
                {envConfig.githubToken && envConfig.githubRepo && (
                  <div className="rounded-lg border border-border bg-muted/30 p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-foreground">Connection Status</p>
                        <p className="text-xs text-muted-foreground">
                          {isCheckingGitHub ? 'Checking...' :
                            gitHubConnectionStatus?.connected
                              ? `Connected to ${gitHubConnectionStatus.repoFullName}`
                              : gitHubConnectionStatus?.error || 'Not connected'}
                        </p>
                        {gitHubConnectionStatus?.connected && gitHubConnectionStatus.repoDescription && (
                          <p className="text-xs text-muted-foreground mt-1 italic">
                            {gitHubConnectionStatus.repoDescription}
                          </p>
                        )}
                      </div>
                      {isCheckingGitHub ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : gitHubConnectionStatus?.connected ? (
                        <CheckCircle2 className="h-4 w-4 text-success" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-warning" />
                      )}
                    </div>
                  </div>
                )}

                {/* Info about accessing issues */}
                {gitHubConnectionStatus?.connected && (
                  <div className="rounded-lg border border-info/30 bg-info/5 p-3">
                    <div className="flex items-start gap-3">
                      <Github className="h-5 w-5 text-info mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-foreground">Issues Available</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Access GitHub Issues from the sidebar to view, investigate, and create tasks from issues.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

              </>
            )}
          </div>
        )}
      </section>
    </>
  );
}
