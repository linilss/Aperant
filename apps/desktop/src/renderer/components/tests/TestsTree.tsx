import { useTranslation } from 'react-i18next';
import { ChevronRight, ChevronDown, FlaskConical } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../lib/utils';
import { Badge } from '../ui/badge';
import type { TestProject, TestCategory } from '../../../shared/types/tests';

interface TestsTreeProps {
  projects: TestProject[];
  selectedProjectId: string | null;
  selectedCategory: TestCategory | 'all';
  onSelectProject: (id: string) => void;
  onSelectCategory: (cat: TestCategory | 'all') => void;
}

const KNOWN_CATEGORIES: Array<TestCategory | 'all'> = ['all', 'unit', 'integration', 'e2e', 'interface'];

function getCategoryLabel(t: (key: string) => string, cat: TestCategory | 'all'): string {
  const known = KNOWN_CATEGORIES.includes(cat);
  if (known) {
    return t(`categories.${cat}`);
  }
  return cat;
}

function countByCategory(project: TestProject, cat: TestCategory | 'all'): number {
  if (cat === 'all') return project.tests.length;
  return project.tests.filter((t) => t.category === cat).length;
}

function passedCount(project: TestProject, cat: TestCategory | 'all'): number {
  const tests = cat === 'all' ? project.tests : project.tests.filter((t) => t.category === cat);
  return tests.filter((t) => t.status === 'passed').length;
}

function failedCount(project: TestProject, cat: TestCategory | 'all'): number {
  const tests = cat === 'all' ? project.tests : project.tests.filter((t) => t.category === cat);
  return tests.filter((t) => t.status === 'failed').length;
}

function getProjectCategories(project: TestProject): string[] {
  const cats = new Set(project.tests.map((t) => t.category));
  return Array.from(cats);
}

interface ProjectNodeProps {
  project: TestProject;
  isSelected: boolean;
  selectedCategory: TestCategory | 'all';
  onSelectProject: (id: string) => void;
  onSelectCategory: (cat: TestCategory | 'all') => void;
}

function ProjectNode({
  project,
  isSelected,
  selectedCategory,
  onSelectProject,
  onSelectCategory,
}: ProjectNodeProps) {
  const { t } = useTranslation('tests');
  const [expanded, setExpanded] = useState(true);
  const categories = getProjectCategories(project);
  const failed = failedCount(project, 'all');

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          onSelectProject(project.id);
          setExpanded((e) => !e);
        }}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
          'hover:bg-accent hover:text-accent-foreground',
          isSelected && 'bg-accent text-accent-foreground',
        )}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <FlaskConical className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="flex-1 truncate font-medium">{project.name}</span>
        {failed > 0 && (
          <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
            {failed}
          </Badge>
        )}
        {project.isRunning && (
          <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
        )}
      </button>

      {expanded && isSelected && (
        <div className="ml-4 mt-0.5 space-y-0.5 border-l border-border pl-3">
          {/* "All" category row */}
          <CategoryRow
            label={getCategoryLabel(t, 'all')}
            count={countByCategory(project, 'all')}
            failed={failedCount(project, 'all')}
            passed={passedCount(project, 'all')}
            isSelected={selectedCategory === 'all'}
            onSelect={() => onSelectCategory('all')}
          />
          {categories.map((cat) => (
            <CategoryRow
              key={cat}
              label={getCategoryLabel(t, cat)}
              count={countByCategory(project, cat)}
              failed={failedCount(project, cat)}
              passed={passedCount(project, cat)}
              isSelected={selectedCategory === cat}
              onSelect={() => onSelectCategory(cat)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface CategoryRowProps {
  label: string;
  count: number;
  failed: number;
  passed: number;
  isSelected: boolean;
  onSelect: () => void;
}

function CategoryRow({ label, count, failed, isSelected, onSelect }: CategoryRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
        isSelected && 'bg-accent/60 text-accent-foreground',
      )}
    >
      <span className="flex-1 truncate text-muted-foreground">{label}</span>
      {failed > 0 && (
        <span className="font-medium text-red-500">{failed} fail</span>
      )}
      <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
        {count}
      </Badge>
    </button>
  );
}

export function TestsTree({
  projects,
  selectedProjectId,
  selectedCategory,
  onSelectProject,
  onSelectCategory,
}: TestsTreeProps) {
  return (
    <div className="space-y-1 p-2">
      {projects.map((project) => (
        <ProjectNode
          key={project.id}
          project={project}
          isSelected={selectedProjectId === project.id}
          selectedCategory={selectedCategory}
          onSelectProject={onSelectProject}
          onSelectCategory={onSelectCategory}
        />
      ))}
    </div>
  );
}
