import { useTranslation } from 'react-i18next';
import { User, MessageCircle, Tag, Sparkles } from 'lucide-react';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import {
  GITHUB_ISSUE_STATE_COLORS,
  GITHUB_ISSUE_STATE_LABELS
} from '../../../../shared/constants';
import type { IssueListItemProps } from '../types';

export function IssueListItem({ issue, isSelected, onClick, onInvestigate }: IssueListItemProps) {
  const { t } = useTranslation('common');
  return (
    <div
      className={`group p-3 rounded-lg cursor-pointer transition-colors ${
        isSelected
          ? 'bg-accent/50 border border-accent'
          : 'hover:bg-muted/50 border border-transparent'
      }`}
      onClick={onClick}
    >
      <div className="flex min-w-0 items-start gap-3 max-md:gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex min-w-0 items-center gap-2 mb-1">
            <Badge
              variant="outline"
              className={`shrink-0 text-xs ${GITHUB_ISSUE_STATE_COLORS[issue.state]}`}
            >
              {GITHUB_ISSUE_STATE_LABELS[issue.state]}
            </Badge>
            <span className="shrink-0 text-xs text-muted-foreground">#{issue.number}</span>
          </div>
          <h4 className="text-sm font-medium text-foreground truncate">
            {issue.title}
          </h4>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-muted-foreground">
            <div className="flex min-w-0 items-center gap-1">
              <User className="h-3 w-3 shrink-0" />
              <span className="truncate">{issue.author.login}</span>
            </div>
            {issue.commentsCount > 0 && (
              <div className="flex items-center gap-1">
                <MessageCircle className="h-3 w-3" />
                {issue.commentsCount}
              </div>
            )}
            {issue.labels.length > 0 && (
              <div className="flex items-center gap-1">
                <Tag className="h-3 w-3" />
                {issue.labels.length}
              </div>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 opacity-0 group-hover:opacity-100 max-md:opacity-100 transition-opacity h-8 w-8 max-md:h-10 max-md:w-10"
          aria-label={t('issues.investigate')}
          onClick={(e) => {
            e.stopPropagation();
            onInvestigate();
          }}
        >
          <Sparkles className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
