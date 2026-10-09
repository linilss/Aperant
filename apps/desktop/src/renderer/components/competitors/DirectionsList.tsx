import { useTranslation } from 'react-i18next';
import {
  DndContext,
  KeyboardSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Ban, ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { cn } from '../../lib/utils';
import { MouseAndPenSensor, TOUCH_DRAG_ACTIVATION } from '../../lib/dnd-sensors';
import type { StrategicDirection } from '../../../shared/types/competitors';

/** Top non-avoided directions handed downstream as "pursue" (matches main/ai/runners/competitors/guidance.ts) */
const PURSUE_COUNT = 3;

interface DirectionsListProps {
  directions: StrategicDirection[];
  disabled: boolean;
  onMove: (from: number, to: number) => void;
  onToggleAvoid: (id: string) => void;
  onNote: (id: string, note: string) => void;
}

interface RowProps {
  direction: StrategicDirection;
  index: number;
  count: number;
  pursueRank: number | null;
  disabled: boolean;
  onMove: (from: number, to: number) => void;
  onToggleAvoid: (id: string) => void;
  onNote: (id: string, note: string) => void;
}

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <p className="text-sm">
      <span className="font-medium text-muted-foreground">{label}: </span>
      {value}
    </p>
  );
}

function DirectionRow({ direction: d, index, count, pursueRank, disabled, onMove, onToggleAvoid, onNote }: RowProps) {
  const { t } = useTranslation('common');
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: d.id,
    disabled,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 50 : undefined }}
    >
      <Card className={cn('flex gap-2 p-3', d.avoid && 'opacity-60', isDragging && 'shadow-2xl')}>
        <div className="flex flex-col items-center gap-1">
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-accent disabled:cursor-not-allowed"
            aria-label={t('competitors.directions.dragHandle', { title: d.title })}
            disabled={disabled}
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold tabular-nums">{index + 1}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onMove(index, index - 1)}
            disabled={disabled || index === 0}
            aria-label={t('competitors.directions.moveUp', { title: d.title })}
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onMove(index, index + 1)}
            disabled={disabled || index === count - 1}
            aria-label={t('competitors.directions.moveDown', { title: d.title })}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className={cn('font-semibold', d.avoid && 'line-through')}>{d.title}</h4>
            {pursueRank !== null && (
              <Badge variant="success" className="text-xs">
                {t('competitors.directions.pursue')}
              </Badge>
            )}
            {d.avoid && (
              <Badge variant="destructive" className="text-xs">
                {t('competitors.directions.avoided')}
              </Badge>
            )}
          </div>
          {d.description && <p className="text-sm">{d.description}</p>}
          <Field
            label={t('competitors.directions.occupiedBy')}
            value={d.occupiedBy.length > 0 ? d.occupiedBy.join(', ') : t('competitors.directions.nobody')}
          />
          <Field label={t('competitors.directions.opportunity')} value={d.opportunity} />
          <Field
            label={t('competitors.directions.fit')}
            value={d.fitSources.length > 0 ? `${d.fit} (${d.fitSources.join(', ')})` : d.fit}
          />
          <Field label={t('competitors.directions.risk')} value={d.risk} />
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Input
              value={d.note}
              onChange={(e) => onNote(d.id, e.target.value)}
              placeholder={t('competitors.directions.notePlaceholder')}
              aria-label={t('competitors.directions.noteLabel', { title: d.title })}
              className="h-8 min-w-0 flex-1 basis-48 text-sm"
              maxLength={500}
              disabled={disabled}
            />
            <Button
              variant={d.avoid ? 'destructive' : 'outline'}
              size="sm"
              onClick={() => onToggleAvoid(d.id)}
              aria-pressed={d.avoid}
              disabled={disabled}
            >
              <Ban className="mr-1 h-3.5 w-3.5" />
              {t('competitors.directions.avoid')}
            </Button>
          </div>
        </div>
      </Card>
    </li>
  );
}

export function DirectionsList({ directions, disabled, onMove, onToggleAvoid, onNote }: DirectionsListProps) {
  const sensors = useSensors(
    useSensor(MouseAndPenSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: TOUCH_DRAG_ACTIVATION }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = directions.findIndex((d) => d.id === active.id);
    const to = directions.findIndex((d) => d.id === over.id);
    if (from !== -1 && to !== -1) onMove(from, to);
  };

  // Rank among non-avoided directions; top 3 are "pursue"
  let active = 0;
  const pursueRanks = directions.map((d) => {
    if (d.avoid) return null;
    active++;
    return active <= PURSUE_COUNT ? active : null;
  });

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={directions.map((d) => d.id)} strategy={verticalListSortingStrategy}>
        <ol className="space-y-2">
          {directions.map((d, i) => (
            <DirectionRow
              key={d.id}
              direction={d}
              index={i}
              count={directions.length}
              pursueRank={pursueRanks[i]}
              disabled={disabled}
              onMove={onMove}
              onToggleAvoid={onToggleAvoid}
              onNote={onNote}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}
