import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Settings,
  LayoutGrid,
  Terminal,
  BookOpen,
  AlertCircle,
  Download,
  RefreshCw,
  FileText,
  Sparkles,
  GitBranch,
  HelpCircle,
  Wrench,
  Bot,
  FlaskConical,
  Wand,
  ChevronRight,
  Rocket,
  Swords,
  ListTodo,
  Gem,
  Palette,
  CheckCircle2
} from 'lucide-react';
import { Button } from './ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from './ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog';
import { cn } from '../lib/utils';
import {
  useProjectStore,
  removeProject,
  initializeProject
} from '../stores/project-store';
import { useSettingsStore } from '../stores/settings-store';
import { useTaskStore } from '../stores/task-store';
import { useFunnelProgress } from '../stores/funnel-store';
import { countUndeployedTasks } from '../../shared/utils/task-deployments';
import {
  loadProjectEnvConfig,
  clearProjectEnvConfig
} from '../stores/project-env-store';
import { AddProjectModal } from './AddProjectModal';
import { GitSetupModal } from './GitSetupModal';
import { RateLimitIndicator } from './RateLimitIndicator';

import { UpdateBanner } from './UpdateBanner';
import type { Project, GitStatus, FunnelStepId } from '../../shared/types';

export type SidebarView = 'kanban' | 'terminals' | 'agents' | 'skills' | 'core-values' | 'design' | 'competitors' | 'roadmap' | 'context' | 'ideation' | 'changelog' | 'insights' | 'worktrees' | 'agent-tools' | 'tests' | 'deploy';

interface SidebarProps {
  onSettingsClick: () => void;
  onNewTaskClick: () => void;
  activeView?: SidebarView;
  onViewChange?: (view: SidebarView) => void;
  className?: string;
  /** `rail`: icon-only column with tooltips, used for narrow desktop windows */
  variant?: 'full' | 'rail';
}

interface NavItem {
  id: SidebarView;
  labelKey: string;
  icon: React.ElementType;
  shortcut?: string;
  /** Plan-funnel step this view completes; shows a check when done for the selected project */
  funnelStep?: FunnelStepId;
  /** Building/shipping view: hidden in overview projects */
  build?: true;
}

const COLLAPSED_SECTIONS_KEY = 'malvy.sidebar.collapsedSections';

interface NavSection {
  id: string;
  labelKey: string;
  items: NavItem[];
}

// Ordered as a funnel: understand → plan → build → review → ship, config last
const navSections: NavSection[] = [
  {
    id: 'understand',
    labelKey: 'navigation:sections.understand',
    items: [
      { id: 'core-values', labelKey: 'navigation:items.coreValues', icon: Gem, shortcut: 'U', funnelStep: 'coreValues' },
      { id: 'context', labelKey: 'navigation:items.context', icon: BookOpen, shortcut: 'C', funnelStep: 'context' },
      { id: 'design', labelKey: 'navigation:items.design', icon: Palette, shortcut: 'J', funnelStep: 'design' }
    ]
  },
  {
    id: 'plan',
    labelKey: 'navigation:sections.plan',
    items: [
      { id: 'competitors', labelKey: 'navigation:items.competitors', icon: Swords, shortcut: 'F', funnelStep: 'competitors' },
      { id: 'roadmap', labelKey: 'navigation:items.backlog', icon: ListTodo, shortcut: 'D', funnelStep: 'roadmap' }
    ]
  },
  {
    id: 'build',
    labelKey: 'navigation:sections.build',
    items: [
      { id: 'kanban', labelKey: 'navigation:items.kanban', icon: LayoutGrid, shortcut: 'K', build: true },
      { id: 'terminals', labelKey: 'navigation:items.terminals', icon: Terminal, shortcut: 'A' },
      { id: 'insights', labelKey: 'navigation:items.insights', icon: Sparkles, shortcut: 'N' }
    ]
  },
  {
    id: 'review',
    labelKey: 'navigation:sections.review',
    items: [
      { id: 'worktrees', labelKey: 'navigation:items.worktrees', icon: GitBranch, shortcut: 'W', build: true },
      { id: 'tests', labelKey: 'navigation:items.tests', icon: FlaskConical, shortcut: 'T', build: true }
    ]
  },
  {
    id: 'ship',
    labelKey: 'navigation:sections.ship',
    items: [
      { id: 'changelog', labelKey: 'navigation:items.changelog', icon: FileText, shortcut: 'L', build: true },
      { id: 'deploy', labelKey: 'navigation:items.deploy', icon: Rocket, shortcut: 'Y', build: true }
    ]
  },
  {
    id: 'configure',
    labelKey: 'navigation:sections.configure',
    items: [
      { id: 'agents', labelKey: 'navigation:items.agents', icon: Bot, shortcut: 'E' },
      { id: 'skills', labelKey: 'navigation:items.skills', icon: Wand, shortcut: 'S' },
      { id: 'agent-tools', labelKey: 'navigation:items.agentTools', icon: Wrench, shortcut: 'M' }
    ]
  }
];

/** Views hidden in overview projects (building and shipping) */
export const BUILD_VIEWS: readonly string[] = navSections.flatMap((s) => s.items.filter((i) => i.build).map((i) => i.id));

/** i18n key of a nav item's label (used by the mobile top bar title). */
export function getNavItemLabelKey(view: SidebarView): string | undefined {
  for (const section of navSections) {
    const item = section.items.find((i) => i.id === view);
    if (item) return item.labelKey;
  }
  return undefined;
}

export function Sidebar({
  onSettingsClick,
  onNewTaskClick,
  activeView = 'kanban',
  onViewChange,
  className,
  variant = 'full'
}: SidebarProps) {
  const isRail = variant === 'rail';
  const { t } = useTranslation(['navigation', 'dialogs', 'common', 'deploy']);
  // Merged tasks not yet deployed — shown on the Ship → Deploy item
  const undeployedCount = useTaskStore((state) => countUndeployedTasks(state.tasks));
  const projects = useProjectStore((state) => state.projects);
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId);
  const settings = useSettingsStore((state) => state.settings);

  const [showAddProjectModal, setShowAddProjectModal] = useState(false);
  const [showInitDialog, setShowInitDialog] = useState(false);
  const [showGitSetupModal, setShowGitSetupModal] = useState(false);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [pendingProject, setPendingProject] = useState<Project | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const funnel = useFunnelProgress(selectedProjectId);
  const isStepDone = (item: NavItem) =>
    !!item.funnelStep && !!funnel?.steps.some((s) => s.id === item.funnelStep && s.done);

  // Track the last loaded project ID to avoid redundant loads
  const lastLoadedProjectIdRef = useRef<string | null>(null);

  // Overview projects (a folder of many apps) plan and analyse only
  const overviewOnly = projects.find((p) => p.id === selectedProjectId)?.settings?.overviewOnly === true;

  // Compute visible sections (overview projects hide build views)
  const visibleSections = useMemo(() => {
    return navSections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => !(overviewOnly && item.build))
      }))
      .filter((section) => section.items.length > 0);
  }, [overviewOnly]);

  const visibleNavItems = useMemo(
    () => visibleSections.flatMap((section) => section.items),
    [visibleSections]
  );

  // All sections start expanded; a section can be collapsed by hand (remembered per
  // viewer) and is reopened when navigation lands in it
  const activeSectionId = visibleSections.find((section) =>
    section.items.some((item) => item.id === activeView || (item.id === 'roadmap' && activeView === 'ideation'))
  )?.id;
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(COLLAPSED_SECTIONS_KEY) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });

  const setSectionOpen = useCallback((sectionId: string, open: boolean) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (open) next.delete(sectionId);
      else next.add(sectionId);
      try {
        localStorage.setItem(COLLAPSED_SECTIONS_KEY, JSON.stringify([...next]));
      } catch {
        // Storage unavailable: keep the state for this session only
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (activeSectionId) setSectionOpen(activeSectionId, true);
  }, [activeSectionId, setSectionOpen]);

  // Load envConfig when project changes to ensure store is populated
  useEffect(() => {
    // Track whether this effect is still current (for race condition handling)
    let isCurrent = true;

    const initializeEnvConfig = async () => {
      if (selectedProject?.id && selectedProject?.autoBuildPath) {
        // Only reload if the project ID differs from what we last loaded
        if (selectedProject.id !== lastLoadedProjectIdRef.current) {
          lastLoadedProjectIdRef.current = selectedProject.id;
          await loadProjectEnvConfig(selectedProject.id);
          // Check if this effect was cancelled while loading
          if (!isCurrent) return;
        }
      } else {
        // Clear the store if no project is selected or has no autoBuildPath
        lastLoadedProjectIdRef.current = null;
        clearProjectEnvConfig();
      }
    };
    initializeEnvConfig();

    // Cleanup function to mark this effect as stale
    return () => {
      isCurrent = false;
    };
  }, [selectedProject?.id, selectedProject?.autoBuildPath]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      // Only handle shortcuts when a project is selected
      if (!selectedProjectId) return;

      // Check for modifier keys - we want plain key presses only
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key.toUpperCase();

      // Find matching nav item from visible items only
      const matchedItem = visibleNavItems.find((item) => item.shortcut === key);

      if (matchedItem) {
        e.preventDefault();
        onViewChange?.(matchedItem.id);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedProjectId, onViewChange, visibleNavItems]);

  // Check git status when project changes
  useEffect(() => {
    const checkGit = async () => {
      if (selectedProject) {
        try {
          const result = await window.electronAPI.checkGitStatus(selectedProject.path);
          if (result.success && result.data) {
            setGitStatus(result.data);
            // Show git setup modal if project is not a git repo or has no commits
            if (!result.data.isGitRepo || !result.data.hasCommits) {
              setShowGitSetupModal(true);
            }
          }
        } catch (error) {
          console.error('Failed to check git status:', error);
        }
      } else {
        setGitStatus(null);
      }
    };
    checkGit();
  }, [selectedProject]);

  const handleProjectAdded = (project: Project, needsInit: boolean) => {
    if (needsInit) {
      setPendingProject(project);
      setShowInitDialog(true);
    }
  };

  const handleInitialize = async () => {
    if (!pendingProject) return;

    const projectId = pendingProject.id;
    setIsInitializing(true);
    try {
      // Init finishes in milliseconds; hold the spinner briefly so the click visibly registers
      const [result] = await Promise.all([
        initializeProject(projectId),
        new Promise((resolve) => setTimeout(resolve, 600))
      ]);
      if (result?.success) {
        // Clear pendingProject FIRST before closing dialog
        // This prevents onOpenChange from triggering skip logic
        setPendingProject(null);
        setShowInitDialog(false);
      }
    } finally {
      setIsInitializing(false);
    }
  };

  const handleSkipInit = () => {
    setShowInitDialog(false);
    setPendingProject(null);
  };

  const handleGitInitialized = async () => {
    // Refresh git status after initialization
    if (selectedProject) {
      try {
        const result = await window.electronAPI.checkGitStatus(selectedProject.path);
        if (result.success && result.data) {
          setGitStatus(result.data);
        }
      } catch (error) {
        console.error('Failed to refresh git status:', error);
      }
    }
  };

  const _handleRemoveProject = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    await removeProject(projectId);
  };


  const handleNavClick = (view: SidebarView) => {
    onViewChange?.(view);
  };

  const renderRailItem = (item: NavItem) => {
    // Ideation (idea settings) is opened from the Backlog
    const isActive = activeView === item.id || (item.id === 'roadmap' && activeView === 'ideation');
    const Icon = item.icon;
    const label = t(item.labelKey);
    const stepDone = isStepDone(item);

    return (
      <Tooltip key={item.id}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => handleNavClick(item.id)}
            disabled={!selectedProjectId}
            aria-keyshortcuts={item.shortcut}
            aria-label={label}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'relative mx-auto flex h-10 w-10 items-center justify-center rounded-lg transition-colors duration-200',
              'hover:bg-accent hover:text-accent-foreground',
              'disabled:pointer-events-none disabled:opacity-50',
              isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'
            )}
          >
            <Icon className="h-[18px] w-[18px]" />
            {item.id === 'deploy' && undeployedCount > 0 && (
              <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" />
            )}
            {stepDone && (
              <CheckCircle2 className="absolute right-0.5 top-0.5 h-3 w-3 rounded-full bg-sidebar text-success" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="flex items-center gap-2">
          {label}
          {stepDone && <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
          {item.id === 'deploy' && undeployedCount > 0 && (
            <span className="text-muted-foreground">
              {t('deploy:notDeployed', { count: undeployedCount })}
            </span>
          )}
          {item.shortcut && (
            <kbd className="rounded border border-border bg-secondary px-1 font-mono text-[11px] text-muted-foreground">
              {item.shortcut}
            </kbd>
          )}
        </TooltipContent>
      </Tooltip>
    );
  };

  const renderNavItem = (item: NavItem) => {
    // Ideation (idea settings) is opened from the Backlog
    const isActive = activeView === item.id || (item.id === 'roadmap' && activeView === 'ideation');
    const Icon = item.icon;
    const stepDone = isStepDone(item);

    return (
      <button
        key={item.id}
        onClick={() => handleNavClick(item.id)}
        disabled={!selectedProjectId}
        aria-keyshortcuts={item.shortcut}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-200',
          'hover:bg-accent hover:text-accent-foreground',
          'disabled:pointer-events-none disabled:opacity-50',
          isActive && 'bg-accent text-accent-foreground'
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left">{t(item.labelKey)}</span>
        {item.id === 'deploy' && undeployedCount > 0 && (
          <span
            className="rounded-full bg-primary/15 px-1.5 text-[10px] font-medium leading-5 text-primary"
            title={t('deploy:notDeployed', { count: undeployedCount })}
          >
            {undeployedCount}
          </span>
        )}
        {stepDone && (
          <CheckCircle2
            className="h-4 w-4 shrink-0 text-success"
            aria-label={t('navigation:funnel.stepDone', { step: t(item.labelKey) })}
          />
        )}
        {item.shortcut && (
          <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded-md border border-border bg-secondary px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:flex">
            {item.shortcut}
          </kbd>
        )}
      </button>
    );
  };

  const sidebarBody = isRail ? (
    <div className={cn('flex h-full w-16 shrink-0 flex-col border-r border-border bg-sidebar', className)}>
      {/* Drag area keeps room for the macOS traffic lights */}
      <div className="electron-drag flex h-14 items-center justify-center pt-6">
        <span className="electron-no-drag text-lg font-bold text-primary">m</span>
      </div>

      <Separator className="mt-2" />

      <ScrollArea className="flex-1">
        <nav className="flex flex-col py-2">
          {visibleSections.map((section, index) => (
            <div
              key={section.id}
              role="group"
              aria-label={t(section.labelKey)}
              className="flex flex-col gap-1 py-1"
            >
              {index > 0 && <Separator className="mx-auto mb-1 w-8" />}
              {section.items.map(renderRailItem)}
            </div>
          ))}
        </nav>
      </ScrollArea>

      <Separator />

      <div className="flex flex-col items-center gap-2 py-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={onSettingsClick} aria-label={t('actions.settings')}>
              <Settings className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{t('tooltips.settings')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => window.open('https://github.com/linilss/Aperant/issues', '_blank')}
              aria-label={t('tooltips.help')}
            >
              <HelpCircle className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{t('tooltips.help')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              onClick={onNewTaskClick}
              disabled={!selectedProjectId || !selectedProject?.autoBuildPath}
              aria-label={t('actions.newTask')}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {selectedProject && !selectedProject.autoBuildPath
              ? t('messages.initializeToCreateTasks')
              : t('actions.newTask')}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  ) : (
      <div className={cn('flex h-full w-64 flex-col bg-sidebar border-r border-border', className)}>
        {/* Header with drag area - extra top padding for macOS traffic lights */}
        <div className="electron-drag flex h-14 items-center px-4 pt-6 max-md:h-12 max-md:pt-0">
          <span className="electron-no-drag text-lg font-bold text-primary">malvy</span>
        </div>

        <Separator className="mt-2" />

        {/* Navigation */}
        <ScrollArea className="flex-1">
          <div className="px-3 py-4">
            <nav className="space-y-1">
              {visibleSections.map((section) => {
                const isOpen = !collapsedSections.has(section.id);
                return (
                  <Collapsible
                    key={section.id}
                    open={isOpen}
                    onOpenChange={(open) => setSectionOpen(section.id, open)}
                  >
                    <CollapsibleTrigger
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground',
                        !isOpen && activeSectionId === section.id && 'text-foreground'
                      )}
                    >
                      <ChevronRight
                        className={cn('h-3 w-3 shrink-0 transition-transform duration-200', isOpen && 'rotate-90')}
                      />
                      <span>{t(section.labelKey)}</span>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-1 pb-2 pl-2">
                      {section.items.map(renderNavItem)}
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </nav>
          </div>
        </ScrollArea>

        <Separator />

        {/* Rate Limit Indicator - shows when Claude is rate limited */}
        <RateLimitIndicator />

        {/* Update Banner - shows when app update is available */}
        <UpdateBanner />

        {/* Bottom section with Settings, Help, and New Task */}
        <div className="space-y-3 p-4">
          {/* Settings and Help row */}
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 justify-start gap-2"
                  onClick={onSettingsClick}
                >
                  <Settings className="h-4 w-4" />
                  {t('actions.settings')}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{t('tooltips.settings')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => window.open('https://github.com/linilss/Aperant/issues', '_blank')}
                  aria-label={t('tooltips.help')}
                >
                  <HelpCircle className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{t('tooltips.help')}</TooltipContent>
            </Tooltip>
          </div>

          {/* New Task button */}
          <Button
            className="w-full"
            onClick={onNewTaskClick}
            disabled={!selectedProjectId || !selectedProject?.autoBuildPath}
          >
            <Plus className="mr-2 h-4 w-4" />
            {t('actions.newTask')}
          </Button>
          {selectedProject && !selectedProject.autoBuildPath && (
            <p className="mt-2 text-xs text-muted-foreground text-center">
              {t('messages.initializeToCreateTasks')}
            </p>
          )}
        </div>
      </div>
  );

  return (
    <TooltipProvider>
      {sidebarBody}

      {/* Initialize Auto Claude Dialog */}
      <Dialog open={showInitDialog} onOpenChange={(open) => {
        // Only allow closing if user manually closes (not during initialization)
        if (!open && !isInitializing) {
          handleSkipInit();
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              {t('dialogs:initialize.title')}
            </DialogTitle>
            <DialogDescription>
              {t('dialogs:initialize.description')}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="rounded-lg bg-muted p-4 text-sm">
              <p className="font-medium mb-2">{t('dialogs:initialize.willDo')}</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>{t('dialogs:initialize.createFolder')}</li>
                <li>{t('dialogs:initialize.copyFramework')}</li>
                <li>{t('dialogs:initialize.setupSpecs')}</li>
              </ul>
            </div>
            {!settings.autoBuildPath && (
              <div className="mt-4 rounded-lg border border-warning/50 bg-warning/10 p-4 text-sm">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-warning">{t('dialogs:initialize.sourcePathNotConfigured')}</p>
                    <p className="text-muted-foreground mt-1">
                      {t('dialogs:initialize.sourcePathNotConfiguredDescription')}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleSkipInit} disabled={isInitializing}>
              {t('common:buttons.skip')}
            </Button>
            <Button
              onClick={handleInitialize}
              disabled={isInitializing || !settings.autoBuildPath}
            >
              {isInitializing ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  {t('common:labels.initializing')}
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  {t('common:buttons.initialize')}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Project Modal */}
      <AddProjectModal
        open={showAddProjectModal}
        onOpenChange={setShowAddProjectModal}
        onProjectAdded={handleProjectAdded}
      />

      {/* Git Setup Modal */}
      <GitSetupModal
        open={showGitSetupModal}
        onOpenChange={setShowGitSetupModal}
        project={selectedProject || null}
        gitStatus={gitStatus}
        onGitInitialized={handleGitInitialized}
      />
    </TooltipProvider>
  );
}
