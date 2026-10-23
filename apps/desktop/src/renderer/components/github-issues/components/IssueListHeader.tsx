import { useTranslation } from 'react-i18next';
import { Github, RefreshCw, Search, Filter, Wand2, Loader2, Layers } from 'lucide-react';
import { Badge } from '../../ui/badge';
import { Input } from '../../ui/input';
import { Switch } from '../../ui/switch';
import { Label } from '../../ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../ui/tooltip';
import { PageHeader, PAGE_STICKY, type PageHeaderAction } from '../../ui/page-header';
import { cn } from '../../../lib/utils';
import type { IssueListHeaderProps } from '../types';

export function IssueListHeader({
  repoFullName,
  openIssuesCount,
  isLoading,
  searchQuery,
  filterState,
  onSearchChange,
  onFilterChange,
  onRefresh,
  autoFixEnabled,
  autoFixRunning,
  autoFixProcessing,
  onAutoFixToggle,
  onAnalyzeAndGroup,
  isAnalyzing,
}: IssueListHeaderProps) {
  const { t } = useTranslation('common');

  const actions: PageHeaderAction[] = [
    {
      id: 'analyze',
      label: t('issues.analyzeAndGroup'),
      icon: isAnalyzing ? Loader2 : Layers,
      busy: isAnalyzing,
      onClick: () => onAnalyzeAndGroup?.(),
      disabled: isAnalyzing || isLoading,
      tooltip: t('issues.analyzeTooltip'),
      hidden: !onAnalyzeAndGroup,
    },
    {
      id: 'refresh',
      label: t('buttons.refresh'),
      icon: RefreshCw,
      busy: isLoading,
      iconOnly: true,
      onClick: onRefresh,
      disabled: isLoading,
    },
  ];

  const autoFixToggle = onAutoFixToggle && (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex h-8 shrink-0 items-center gap-2 rounded-md border border-border bg-muted/50 px-2 max-md:h-10">
            {autoFixRunning ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : (
              <Wand2 className="h-4 w-4 text-muted-foreground" />
            )}
            <Label htmlFor="auto-fix-toggle" className="cursor-pointer whitespace-nowrap text-sm">
              {t('issues.autoFixNew')}
            </Label>
            <Switch
              id="auto-fix-toggle"
              checked={autoFixEnabled ?? false}
              onCheckedChange={onAutoFixToggle}
              disabled={autoFixRunning}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <p>{t('issues.autoFixTooltip')}</p>
          {autoFixRunning && autoFixProcessing !== undefined && autoFixProcessing > 0 && (
            <p className="mt-1 text-primary">
              {t('issues.autoFixProcessing', { count: autoFixProcessing })}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  return (
    <>
      <PageHeader
        icon={Github}
        title={t('issues.title')}
        subtitle={repoFullName}
        titleAddon={
          <Badge variant="outline" className="shrink-0 text-xs">
            {t('issues.openCount', { count: openIssuesCount })}
          </Badge>
        }
        extra={autoFixToggle}
        actions={actions}
      />

      {/* Search + state filter: stays pinned while a phone scrolls the list */}
      <div className={cn(PAGE_STICKY, 'shrink-0 border-b border-border px-6 py-2 max-md:px-3')}>
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t('issues.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-9 max-md:h-10"
            />
          </div>
          <Select value={filterState} onValueChange={onFilterChange}>
            <SelectTrigger className="w-32 shrink-0 max-md:h-10 max-md:w-28">
              <Filter className="mr-2 h-4 w-4" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">{t('issues.filterOpen')}</SelectItem>
              <SelectItem value="closed">{t('issues.filterClosed')}</SelectItem>
              <SelectItem value="all">{t('issues.filterAll')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </>
  );
}
