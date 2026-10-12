/**
 * Phone-only shell pieces (below Tailwind `md`): a compact top bar with a
 * hamburger and a project dropdown (the desktop ProjectTabBar is hidden on
 * mobile), and an off-canvas drawer that hosts the regular Sidebar.
 */

import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, ChevronLeft, Menu, Plus } from 'lucide-react';
import { cn } from '../lib/utils';
import { AuthStatusIndicator } from './AuthStatusIndicator';
import { ProjectAccountChip } from './ProjectAccountChip';
import { UsageIndicator } from './UsageIndicator';
import { FunnelBar } from './FunnelProgress';
import { useFunnelStore } from '../stores/funnel-store';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/dropdown-menu';
import type { FunnelProgress, Project } from '../../shared/types';

/** Project name with its plan-funnel progress as a thin bar underneath */
function ProjectNameWithFunnel({ name, funnel, className }: { name: string; funnel?: FunnelProgress; className?: string }) {
  const { t } = useTranslation('common');
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="flex min-w-0 items-baseline gap-2">
        <span className={cn('min-w-0 flex-1 truncate', className)}>{name}</span>
        {funnel && (
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
            {t('funnel.count', { completed: funnel.completed, total: funnel.total })}
          </span>
        )}
      </span>
      {funnel && <FunnelBar progress={funnel} className="h-0.5 rounded-full" />}
    </span>
  );
}

interface MobileTopBarProps {
  /** Current view, shown under the project name */
  viewTitle: string;
  onMenuClick: () => void;
  projects: MobileProjectMenuProps;
}

export function MobileTopBar({ viewTitle, onMenuClick, projects }: MobileTopBarProps) {
  const { t } = useTranslation('navigation');
  return (
    <header className="flex shrink-0 items-center gap-1 border-b border-border bg-background px-2 pt-[env(safe-area-inset-top)] pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))]">
      <button
        type="button"
        onClick={onMenuClick}
        aria-label={t('mobile.openMenu')}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-foreground hover:bg-accent"
      >
        <Menu className="h-5 w-5" />
      </button>
      <MobileProjectMenu {...projects} viewTitle={viewTitle} />
    </header>
  );
}

interface MobileDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

/**
 * Kept mounted while closed so the Sidebar's effects (git status, env config
 * for integration nav items) keep running exactly as on desktop.
 */
export function MobileDrawer({ open, onOpenChange, children }: MobileDrawerProps) {
  const { t } = useTranslation('navigation');

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  return (
    <>
      <button
        type="button"
        aria-label={t('mobile.closeMenu')}
        tabIndex={-1}
        onClick={() => onOpenChange(false)}
        className={cn(
          'fixed inset-0 z-40 bg-black/60 transition-opacity duration-200',
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
      />
      <div
        role="dialog"
        aria-modal={open}
        aria-hidden={!open}
        inert={!open}
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[min(18rem,85vw)] flex-col bg-sidebar shadow-xl transition-transform duration-200',
          'pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {children}
      </div>
    </>
  );
}

interface MobileProjectMenuProps {
  projects: Project[];
  closedProjects: Project[];
  activeProjectId: string | null;
  onProjectSelect: (projectId: string) => void;
  onProjectOpen: (projectId: string) => void;
  onAddProject: () => void;
}

/** Top-bar project switcher: the active project's name opens a dropdown of all projects. */
function MobileProjectMenu({
  projects,
  closedProjects,
  activeProjectId,
  onProjectSelect,
  onProjectOpen,
  onAddProject,
  viewTitle
}: MobileProjectMenuProps & { viewTitle: string }) {
  const { t } = useTranslation(['navigation', 'common']);
  const funnelByProject = useFunnelStore((s) => s.byProject);
  const active = projects.find((p) => p.id === activeProjectId);
  const itemClass = 'min-h-11 gap-2 px-3 py-2';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('navigation:mobile.switchProject')}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1.5 text-left hover:bg-accent"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-semibold leading-tight">
              {active?.name ?? t('navigation:mobile.noProject')}
            </span>
            <span className="truncate text-xs leading-tight text-muted-foreground">{viewTitle}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="max-h-[70dvh] w-[min(20rem,calc(100vw-1rem))] overflow-y-auto"
      >
        <DropdownMenuLabel className="text-xs uppercase tracking-wider text-muted-foreground">
          {t('navigation:mobile.projects')}
        </DropdownMenuLabel>
        {projects.map((project) => {
          const isActive = project.id === activeProjectId;
          return (
            <DropdownMenuItem
              key={project.id}
              onSelect={() => onProjectSelect(project.id)}
              className={cn(itemClass, isActive && 'bg-accent text-accent-foreground')}
            >
              <ProjectNameWithFunnel name={project.name} funnel={funnelByProject[project.id]} className="font-medium" />
              {isActive && <Check className="h-4 w-4 shrink-0" />}
            </DropdownMenuItem>
          );
        })}
        {closedProjects.map((project) => (
          <DropdownMenuItem
            key={project.id}
            onSelect={() => onProjectOpen(project.id)}
            className={cn(itemClass, 'text-muted-foreground')}
          >
            <ProjectNameWithFunnel name={project.name} funnel={funnelByProject[project.id]} />
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onAddProject} className={cn(itemClass, 'text-muted-foreground')}>
          <Plus className="h-4 w-4 shrink-0" />
          <span>{t('common:projectTab.addProjectAriaLabel')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Drawer header row: auth, the project's Claude account and usage. */
export function MobileDrawerStatus() {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-4 py-3">
      <AuthStatusIndicator />
      <ProjectAccountChip />
      <UsageIndicator />
    </div>
  );
}

interface MobileBackBarProps {
  onBack: () => void;
  /** Shown next to the back arrow, e.g. the open item's name */
  title?: string;
}

/** Back row for list → detail navigation in two-pane views on phones. */
export function MobileBackBar({ onBack, title }: MobileBackBarProps) {
  const { t } = useTranslation('common');
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-border px-1">
      <button
        type="button"
        onClick={onBack}
        className="flex h-10 shrink-0 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        {t('common:buttons.back')}
      </button>
      {title && <span className="min-w-0 truncate text-sm font-medium">{title}</span>}
    </div>
  );
}
