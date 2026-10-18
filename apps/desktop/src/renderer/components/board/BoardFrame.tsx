import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../lib/utils';

export type BoardView = 'kanban' | 'roadmap' | 'ideation';

/** Views that live under the one Board (the sidebar shows only "Board") */
export const BOARD_VIEWS: readonly string[] = ['kanban', 'roadmap', 'ideation'];

/** Tab row over the Board's views: Flow (the board) and Backlog (features + ideas, MoSCoW, phases) */
export function BoardFrame({ view, onSelect, children }: { view: BoardView; onSelect: (view: BoardView) => void; children: ReactNode }) {
  const { t } = useTranslation(['common']);
  const tabs: Array<{ id: BoardView; label: string }> = [
    { id: 'kanban', label: t('board.tabs.flow') },
    { id: 'roadmap', label: t('board.tabs.roadmap') },
  ];
  return (
    <div className="flex h-full flex-col">
      <div role="tablist" className="flex shrink-0 gap-1 border-b border-border px-6 pt-3 max-md:px-3 max-md:pt-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={view === tab.id}
            onClick={() => onSelect(tab.id)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              view === tab.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
