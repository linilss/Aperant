import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { SortableProjectTab } from './SortableProjectTab';
import { UsageIndicator } from './UsageIndicator';
import { AuthStatusIndicator } from './AuthStatusIndicator';
import { ProjectAccountChip } from './ProjectAccountChip';
import { useFunnelStore } from '../stores/funnel-store';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/dropdown-menu';
import type { Project } from '../../shared/types';

interface ProjectTabBarProps {
  projects: Project[];
  /** Projects that exist in the app but have no open tab — reopenable from the + menu */
  closedProjects: Project[];
  activeProjectId: string | null;
  onProjectSelect: (projectId: string) => void;
  onProjectClose: (projectId: string) => void;
  onProjectOpen: (projectId: string) => void;
  onProjectRemove: (projectId: string) => void;
  onAddProject: () => void;
  className?: string;
  // Control props for active tab
  onSettingsClick?: () => void;
}

export function ProjectTabBar({
  projects,
  closedProjects,
  activeProjectId,
  onProjectSelect,
  onProjectClose,
  onProjectOpen,
  onProjectRemove,
  onAddProject,
  className,
  onSettingsClick
}: ProjectTabBarProps) {
  const { t } = useTranslation('common');
  const funnelByProject = useFunnelStore((s) => s.byProject);

  // Keyboard shortcuts for tab navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if in input fields (but NOT xterm's hidden textarea —
      // xterm already passes through Cmd/Ctrl+1-9 via attachCustomKeyEventHandler)
      const target = e.target as HTMLElement;
      const isXtermTextarea = target.classList?.contains('xterm-helper-textarea');
      if (
        !isXtermTextarea &&
        (e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        target?.isContentEditable)
      ) {
        return;
      }

      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;

      // Cmd/Ctrl + 1-9: Switch to tab N
      if (e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const index = parseInt(e.key, 10) - 1;
        if (index < projects.length) {
          onProjectSelect(projects[index].id);
        }
        return;
      }

      // Cmd/Ctrl + Tab: Next tab
      // Cmd/Ctrl + Shift + Tab: Previous tab
      if (e.key === 'Tab') {
        e.preventDefault();
        const currentIndex = projects.findIndex((p) => p.id === activeProjectId);
        if (currentIndex === -1 || projects.length === 0) return;

        const nextIndex = e.shiftKey
          ? (currentIndex - 1 + projects.length) % projects.length
          : (currentIndex + 1) % projects.length;
        onProjectSelect(projects[nextIndex].id);
        return;
      }

      // Cmd/Ctrl + W: Close current tab (only if more than one tab)
      if (e.key === 'w' && activeProjectId && projects.length > 1) {
        e.preventDefault();
        onProjectClose(activeProjectId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [projects, activeProjectId, onProjectSelect, onProjectClose]);

  // Keep the active tab in view when the row scrolls (narrow windows, iPad)
  const tabsScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tab = tabsScrollRef.current?.querySelector<HTMLElement>(`[data-project-id="${activeProjectId}"]`);
    tab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeProjectId]);

  if (projects.length === 0) {
    return null;
  }

  return (
    <div className={cn(
      // Bottom line drawn as an inset shadow so each tab's funnel bar can sit on top of it
      'flex items-stretch bg-background shadow-[inset_0_-1px_0_var(--border)]',
      className
    )}>
      {/* Only the tabs scroll (by swipe on touch screens); the account/usage controls stay put */}
      <div
        ref={tabsScrollRef}
        className="flex min-w-0 flex-1 items-stretch overflow-x-auto overscroll-x-contain scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent"
      >
        {projects.map((project, index) => {
          const isActiveTab = activeProjectId === project.id;
          return (
            <SortableProjectTab
              key={project.id}
              project={project}
              isActive={isActiveTab}
              canClose={projects.length > 1}
              tabIndex={index}
              onSelect={() => onProjectSelect(project.id)}
              onClose={(e) => {
                e.stopPropagation();
                onProjectClose(project.id);
              }}
              onRemove={() => onProjectRemove(project.id)}
              // Pass control props only for active tab
              onSettingsClick={isActiveTab ? onSettingsClick : undefined}
              funnel={funnelByProject[project.id]}
            />
          );
        })}
      </div>

      <div className="flex shrink-0 items-center gap-2 px-2 py-1">
        <AuthStatusIndicator />
        <ProjectAccountChip />
        <UsageIndicator />
        {closedProjects.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label={t('projectTab.openProjectAriaLabel')}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>{t('projectTab.closedProjects')}</DropdownMenuLabel>
              {closedProjects.map((project) => (
                <DropdownMenuItem
                  key={project.id}
                  onClick={() => onProjectOpen(project.id)}
                  className="truncate"
                  title={project.path}
                >
                  {project.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onAddProject}>
                {t('projectTab.addProject')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onAddProject}
            aria-label={t('projectTab.addProjectAriaLabel')}
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
