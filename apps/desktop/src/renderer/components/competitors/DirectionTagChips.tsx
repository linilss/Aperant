import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { useCompetitorStore } from '../../stores/competitor-store';
import { resolveFeatureDirections } from '../moscow/direction-filter';
import type { RoadmapFeature } from '../../../shared/types';
import type { StrategicDirection } from '../../../shared/types/competitors';

const NO_DIRECTIONS: StrategicDirection[] = [];

/** Directions (rank order) for the project, once the competitor store holds it */
export function useProjectDirections(projectId: string | undefined): StrategicDirection[] {
  const storeProjectId = useCompetitorStore((s) => s.projectId);
  const directions = useCompetitorStore((s) => s.data?.directions);
  if (!projectId || storeProjectId !== projectId || !directions) return NO_DIRECTIONS;
  return directions;
}

interface DirectionTagProps {
  direction: StrategicDirection;
  rank: number;
  className?: string;
}

/** Rank badge + truncated title; avoided directions are muted and struck through */
export function DirectionTag({ direction, rank, className }: DirectionTagProps) {
  const { t } = useTranslation('common');
  const tooltip = direction.avoid
    ? t('roadmap.moscow.directions.avoidTooltip', { rank, title: direction.title })
    : t('roadmap.moscow.directions.tooltip', { rank, title: direction.title });
  return (
    <span
      title={tooltip}
      className={cn(
        'inline-flex max-w-[10rem] items-center gap-1 rounded-full border px-1.5 py-0 text-[10px] leading-4',
        direction.avoid
          ? 'border-muted-foreground/30 text-muted-foreground/70'
          : 'border-primary/30 bg-primary/5 text-primary',
        className
      )}
    >
      <span
        className={cn(
          'shrink-0 rounded-full px-1 font-semibold tabular-nums',
          direction.avoid ? 'bg-muted text-muted-foreground' : 'bg-primary/15'
        )}
      >
        {rank}
      </span>
      <span className={cn('truncate', direction.avoid && 'line-through')}>{direction.title}</span>
    </span>
  );
}

interface DirectionTagChipsProps {
  feature: Pick<RoadmapFeature, 'directionIds'>;
  projectId?: string;
}

/** The feature's direction tags; renders nothing when it has none */
export function DirectionTagChips({ feature, projectId }: DirectionTagChipsProps) {
  const directions = useProjectDirections(projectId);
  const refs = resolveFeatureDirections(feature, directions);
  if (refs.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {refs.map(({ direction, rank }) => (
        <DirectionTag key={direction.id} direction={direction} rank={rank} />
      ))}
    </div>
  );
}
