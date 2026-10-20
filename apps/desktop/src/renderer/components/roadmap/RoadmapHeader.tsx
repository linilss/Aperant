import { useTranslation } from 'react-i18next';
import { Target, Users, BarChart3, RefreshCw, Plus, TrendingUp, Sparkles, Trash2 } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { PageHeader, ChipRow, type PageHeaderAction } from '../ui/page-header';
import { getFeatureStats } from '../../stores/roadmap-store';
import { ROADMAP_PRIORITY_COLORS } from '../../../shared/constants';
import type { RoadmapHeaderProps } from './types';

export function RoadmapHeader({ roadmap, competitorAnalysis, onAddFeature, onRefresh, onViewCompetitorAnalysis, onRefineFeature, onClearOpen }: RoadmapHeaderProps) {
  const { t } = useTranslation('common');
  const stats = getFeatureStats(roadmap);

  const actions: PageHeaderAction[] = [
    { id: 'add', label: t('roadmap.header.addFeature'), icon: Plus, onClick: onAddFeature, primary: true, tooltip: t('roadmap.header.addFeatureTooltip') },
    { id: 'refine', label: t('roadmap.header.refine'), icon: Sparkles, onClick: onRefineFeature, tooltip: t('roadmap.header.refineTooltip') },
    { id: 'regenerate', label: t('roadmap.header.regenerate'), icon: RefreshCw, onClick: onRefresh, iconOnly: true },
    {
      id: 'clear-open',
      label: t('roadmap.header.clearOpen'),
      icon: Trash2,
      onClick: onClearOpen,
      iconOnly: true,
      // Always available: the dialog also clears ideas, and disables what has nothing to clear
    },
  ];

  const titleAddon = (
    <>
      <Badge variant="outline">{roadmap.status}</Badge>
      {competitorAnalysis && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="secondary"
              role="button"
              tabIndex={0}
              className="gap-1 cursor-pointer hover:bg-secondary/80 transition-colors"
              onClick={onViewCompetitorAnalysis}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onViewCompetitorAnalysis?.();
                }
              }}
            >
              <TrendingUp className="h-3 w-3" />
              {t('roadmap.header.competitorAnalysis')}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-md">
            <div className="space-y-2">
              <div className="font-semibold">{t('roadmap.header.competitorAnalysisTooltipTitle')}</div>
              <div className="text-sm text-muted-foreground">
                {t('roadmap.header.competitorAnalysisTooltip', {
                  competitors: competitorAnalysis.competitors.length,
                  painPoints: competitorAnalysis.competitors.reduce((sum, c) => sum + c.painPoints.length, 0),
                })}
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      )}
    </>
  );

  return (
    <PageHeader
      icon={Target}
      title={roadmap.projectName}
      titleAddon={titleAddon}
      subtitle={roadmap.vision}
      actions={actions}
    >
      {/* Target Audience */}
      {roadmap.targetAudience && (
        <ChipRow className="text-sm">
          <div className="flex min-w-0 items-center gap-2">
            <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="shrink-0 text-muted-foreground">{t('roadmap.header.target')}</span>
            <span className="min-w-0 truncate font-medium max-md:whitespace-nowrap">{roadmap.targetAudience.primary}</span>
          </div>
          {roadmap.targetAudience.secondary?.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="whitespace-nowrap text-muted-foreground cursor-help underline decoration-dotted">
                  {t('roadmap.header.morePersonas', { count: roadmap.targetAudience.secondary.length })}
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-md">
                <div className="space-y-1">
                  <div className="font-semibold mb-2">{t('roadmap.header.secondaryPersonas')}</div>
                  {roadmap.targetAudience.secondary.map((persona) => (
                    <div key={persona} className="text-sm">• {persona}</div>
                  ))}
                </div>
              </TooltipContent>
            </Tooltip>
          )}
        </ChipRow>
      )}

      {/* Stats */}
      <ChipRow className="gap-x-4 text-sm">
        <div className="flex items-center gap-2 whitespace-nowrap">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <span>
            <span className="font-semibold">{stats.total}</span>
            <span className="text-muted-foreground"> {t('roadmap.header.features')}</span>
          </span>
        </div>
        <div className="whitespace-nowrap">
          <span className="font-semibold">{roadmap.phases.length}</span>
          <span className="text-muted-foreground"> {t('roadmap.header.phases')}</span>
        </div>
        <div className="flex items-center gap-1">
          {Object.entries(stats.byPriority).map(([priority, count]) => (
            <Badge
              key={priority}
              variant="outline"
              className={`whitespace-nowrap text-xs ${ROADMAP_PRIORITY_COLORS[priority]}`}
            >
              {count} {priority}
            </Badge>
          ))}
        </div>
      </ChipRow>
    </PageHeader>
  );
}
