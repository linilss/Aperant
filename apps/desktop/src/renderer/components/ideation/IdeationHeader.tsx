import { useTranslation } from 'react-i18next';
import { Lightbulb, Eye, EyeOff, Settings2, Plus, Trash2, RefreshCw, CheckSquare, X } from 'lucide-react';
import { Badge } from '../ui/badge';
import { PageHeader, ChipRow, type PageHeaderAction } from '../ui/page-header';
import { IDEATION_TYPE_COLORS } from '../../../shared/constants';
import type { IdeationType } from '../../../shared/types';
import { TypeIcon } from './TypeIcon';

interface IdeationHeaderProps {
  totalIdeas: number;
  ideaCountByType: Record<string, number>;
  showDismissed: boolean;
  selectedCount: number;
  onToggleShowDismissed: () => void;
  onOpenConfig: () => void;
  onOpenAddMore: () => void;
  onDismissAll: () => void;
  onDeleteSelected: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onRefresh: () => void;
  hasActiveIdeas: boolean;
  canAddMore: boolean;
}

export function IdeationHeader({
  totalIdeas,
  ideaCountByType,
  showDismissed,
  selectedCount,
  onToggleShowDismissed,
  onOpenConfig,
  onOpenAddMore,
  onDismissAll,
  onDeleteSelected,
  onSelectAll,
  onClearSelection,
  onRefresh,
  hasActiveIdeas,
  canAddMore
}: IdeationHeaderProps) {
  const { t } = useTranslation('common');
  const hasSelection = selectedCount > 0;
  const dismissedLabel = showDismissed
    ? t('accessibility.hideDismissedAriaLabel')
    : t('accessibility.showDismissedAriaLabel');

  // Desktop: all visible (icon-only with tooltips, wrapping). Phone: the single `primary`
  // action stays a button, the rest fold into the "⋯" menu with their labels.
  const actions: PageHeaderAction[] = [
    {
      id: 'delete-selected',
      label: t('ideation.header.deleteSelected'),
      icon: Trash2,
      onClick: onDeleteSelected,
      primary: true,
      variant: 'destructive',
      hidden: !hasSelection
    },
    {
      id: 'clear-selection',
      label: t('accessibility.clearSelectionAriaLabel'),
      icon: X,
      onClick: onClearSelection,
      variant: 'ghost',
      iconOnly: true,
      hidden: !hasSelection
    },
    {
      id: 'select-all',
      label: t('accessibility.selectAllAriaLabel'),
      icon: CheckSquare,
      onClick: onSelectAll,
      variant: 'ghost',
      iconOnly: true,
      hidden: hasSelection || !hasActiveIdeas
    },
    {
      id: 'toggle-dismissed',
      label: dismissedLabel,
      icon: showDismissed ? Eye : EyeOff,
      onClick: onToggleShowDismissed,
      variant: showDismissed ? 'secondary' : 'outline',
      iconOnly: true
    },
    {
      id: 'configure',
      label: t('accessibility.configureAriaLabel'),
      icon: Settings2,
      onClick: onOpenConfig,
      iconOnly: true
    },
    {
      id: 'add-more',
      label: t('ideation.header.addMore'),
      icon: Plus,
      onClick: onOpenAddMore,
      variant: 'outline',
      primary: !hasSelection,
      hidden: !canAddMore
    },
    {
      id: 'dismiss-all',
      label: t('accessibility.dismissAllAriaLabel'),
      icon: Trash2,
      onClick: onDismissAll,
      iconOnly: true,
      hidden: hasSelection || !hasActiveIdeas
    },
    {
      id: 'regenerate',
      label: t('accessibility.regenerateIdeasAriaLabel'),
      icon: RefreshCw,
      onClick: onRefresh,
      iconOnly: true
    }
  ];

  const typeCounts = Object.entries(ideaCountByType);

  return (
    <PageHeader
      icon={Lightbulb}
      title={t('ideation.header.title')}
      subtitle={t('ideation.header.subtitle')}
      titleAddon={
        <>
          <Badge variant="outline" className="shrink-0">
            {t('ideation.header.ideaCount', { count: totalIdeas })}
          </Badge>
          {hasSelection && (
            <Badge variant="secondary" className="shrink-0">
              {t('ideation.header.selectedCount', { count: selectedCount })}
            </Badge>
          )}
        </>
      }
      actions={actions}
    >
      {typeCounts.length > 0 && (
        <ChipRow>
          {typeCounts.map(([type, count]) => (
            <Badge key={type} variant="outline" className={IDEATION_TYPE_COLORS[type]}>
              <TypeIcon type={type as IdeationType} />
              <span className="ml-1">{count}</span>
            </Badge>
          ))}
        </ChipRow>
      )}
    </PageHeader>
  );
}
