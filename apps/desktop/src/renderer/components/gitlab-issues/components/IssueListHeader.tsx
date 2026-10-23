import { useTranslation } from 'react-i18next';
import { GitlabIcon, RefreshCw, Search, Filter } from 'lucide-react';
import { Badge } from '../../ui/badge';
import { Input } from '../../ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../ui/select';
import { PageHeader, PAGE_STICKY } from '../../ui/page-header';
import { cn } from '../../../lib/utils';
import type { IssueListHeaderProps } from '../types';

export function IssueListHeader({
  projectPath,
  openIssuesCount,
  isLoading,
  searchQuery,
  filterState,
  onSearchChange,
  onFilterChange,
  onRefresh
}: IssueListHeaderProps) {
  const { t } = useTranslation(['gitlab', 'common']);

  return (
    <>
      <PageHeader
        icon={GitlabIcon}
        title={t('title')}
        subtitle={projectPath}
        titleAddon={
          <Badge variant="outline" className="shrink-0 text-xs">
            {openIssuesCount} {t('header.open')}
          </Badge>
        }
        actions={[
          {
            id: 'refresh',
            label: t('common:buttons.refresh'),
            icon: RefreshCw,
            iconOnly: true,
            busy: isLoading,
            disabled: isLoading,
            onClick: onRefresh,
          },
        ]}
      />

      {/* Search + state filter: stays pinned while a phone scrolls the list */}
      <div className={cn(PAGE_STICKY, 'shrink-0 border-b border-border px-6 py-2 max-md:px-3')}>
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t('header.searchPlaceholder')}
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
              <SelectItem value="opened">{t('filters.opened')}</SelectItem>
              <SelectItem value="closed">{t('filters.closed')}</SelectItem>
              <SelectItem value="all">{t('filters.all')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </>
  );
}
