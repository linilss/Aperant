import { useDraggable } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import { Lightbulb } from 'lucide-react';

import { cn } from '../../lib/utils';
import { IDEATION_TYPE_COLORS, IDEATION_TYPE_LABELS } from '../../../shared/constants';
import type { Idea } from '../../../shared/types';

export const IDEA_DRAG_PREFIX = 'idea:';

function IdeaChip({ idea, busy }: { idea: Idea; busy: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `${IDEA_DRAG_PREFIX}${idea.id}`, disabled: busy });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      title={idea.description}
      className={cn(
        'flex w-64 shrink-0 cursor-grab touch-none flex-col gap-1 rounded-lg border border-border bg-card p-2.5 text-left',
        isDragging && 'opacity-40',
        busy && 'cursor-wait opacity-60'
      )}
    >
      <span className={cn('w-fit rounded border px-1.5 text-[11px]', IDEATION_TYPE_COLORS[idea.type])}>
        {IDEATION_TYPE_LABELS[idea.type] ?? idea.type}
      </span>
      <span className="line-clamp-2 text-sm font-medium leading-snug">{idea.title}</span>
    </div>
  );
}

/** Ideas without a priority yet: drag one into a quadrant to make it a feature with that priority */
export function UnsortedIdeas({ ideas, busyIds }: { ideas: Idea[]; busyIds: Set<string> }) {
  const { t } = useTranslation('common');
  if (ideas.length === 0) return null;
  return (
    <div className="shrink-0 border-b border-border px-6 py-3 max-md:px-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <Lightbulb className="h-4 w-4 text-muted-foreground" />
        {t('backlog.unsorted', { count: ideas.length })}
        <span className="text-xs font-normal text-muted-foreground">{t('backlog.unsortedHint')}</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {ideas.map((idea) => (
          <IdeaChip key={idea.id} idea={idea} busy={busyIds.has(idea.id)} />
        ))}
      </div>
    </div>
  );
}
