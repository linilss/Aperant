import { useTranslation } from 'react-i18next';
import { FlaskConical, Play, Square, RefreshCw } from 'lucide-react';
import { PageHeader, type PageHeaderAction } from '../ui/page-header';
import type { TestProject } from '../../../shared/types/tests';

interface TestsHeaderProps {
  isRunning: boolean;
  isLoading: boolean;
  projects: TestProject[];
  selectedProjectId: string | null;
  onDiscover: () => void;
  onRunAll: () => void;
  onStop: () => void;
}

export function TestsHeader({
  isRunning,
  isLoading,
  projects,
  selectedProjectId,
  onDiscover,
  onRunAll,
  onStop,
}: TestsHeaderProps) {
  const { t } = useTranslation('tests');
  const hasProjects = projects.length > 0;

  const subtitle = (() => {
    if (!hasProjects) return t('empty.description');
    const counts = { passed: 0, failed: 0, skipped: 0 };
    for (const project of projects) {
      for (const test of project.tests) {
        if (test.status === 'passed' || test.status === 'failed' || test.status === 'skipped') {
          counts[test.status]++;
        }
      }
    }
    const parts = (['passed', 'failed', 'skipped'] as const)
      .filter((status) => counts[status] > 0)
      .map((status) => t(`results.${status}`, { count: counts[status] }));
    return parts.length > 0 ? parts.join(t('summary.separator')) : t('summary.projects', { count: projects.length });
  })();

  const actions: PageHeaderAction[] = [
    {
      id: 'discover',
      label: t('discoverProjects'),
      icon: RefreshCw,
      onClick: onDiscover,
      disabled: isLoading || isRunning,
      busy: isLoading,
    },
    isRunning
      ? {
          id: 'stop',
          label: t('stop'),
          icon: Square,
          onClick: onStop,
          disabled: !selectedProjectId,
          primary: true,
          variant: 'destructive',
        }
      : {
          id: 'run',
          label: t('runAll'),
          icon: Play,
          onClick: onRunAll,
          disabled: !hasProjects || isLoading || !selectedProjectId,
          primary: true,
        },
  ];

  return <PageHeader icon={FlaskConical} title={t('title')} subtitle={subtitle} actions={actions} />;
}
