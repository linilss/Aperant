import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Inbox, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ScrollArea } from '../ui/scroll-area';
import { SortableFeatureCard } from '../SortableFeatureCard';
import { cn } from '../../lib/utils';
import type { Roadmap, RoadmapFeature, RoadmapFeaturePriority } from '../../../shared/types';

export interface MoscowQuadrantConfig {
  id: RoadmapFeaturePriority;
  /** Top border accent */
  borderClass: string;
  /** Small dot / title accent */
  dotClass: string;
}

export const MOSCOW_QUADRANTS: MoscowQuadrantConfig[] = [
  { id: 'must', borderClass: 'border-t-destructive', dotClass: 'bg-destructive' },
  { id: 'should', borderClass: 'border-t-warning', dotClass: 'bg-warning' },
  { id: 'could', borderClass: 'border-t-info', dotClass: 'bg-info' },
  { id: 'wont', borderClass: 'border-t-muted-foreground/50', dotClass: 'bg-muted-foreground/50' },
];

interface MoscowQuadrantProps {
  quadrant: MoscowQuadrantConfig;
  features: RoadmapFeature[];
  roadmap: Roadmap;
  isOver: boolean;
  onFeatureClick: (feature: RoadmapFeature) => void;
  onConvertToSpec?: (feature: RoadmapFeature) => void;
  onGoToTask?: (specId: string) => void;
}

export function MoscowQuadrant({
  quadrant,
  features,
  roadmap,
  isOver,
  onFeatureClick,
  onConvertToSpec,
  onGoToTask,
}: MoscowQuadrantProps) {
  const { t } = useTranslation('common');
  const { setNodeRef } = useDroppable({ id: quadrant.id });

  return (
    <section
      ref={setNodeRef}
      aria-label={t(`roadmap.moscow.quadrants.${quadrant.id}.title`)}
      className={cn(
        'flex min-h-0 flex-col rounded-xl border border-white/5 border-t-2 bg-linear-to-b from-secondary/30 to-transparent transition-all duration-200',
        quadrant.borderClass,
        isOver && 'drop-zone-highlight'
      )}
    >
      <header className="flex items-start justify-between gap-3 border-b border-white/5 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn('h-2 w-2 shrink-0 rounded-full', quadrant.dotClass)} />
            <h3 className="text-sm font-semibold text-foreground">
              {t(`roadmap.moscow.quadrants.${quadrant.id}.title`)}
            </h3>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {t(`roadmap.moscow.quadrants.${quadrant.id}.description`)}
          </p>
        </div>
        <span className="column-count-badge shrink-0">{features.length}</span>
      </header>

      <div className="min-h-0 flex-1">
        <ScrollArea className="h-full px-3 pb-3 pt-2">
          <SortableContext items={features.map((f) => f.id)} strategy={verticalListSortingStrategy}>
            <div className="min-h-[96px] space-y-2">
              {features.length === 0 ? (
                <div
                  className={cn(
                    'empty-column-dropzone flex flex-col items-center justify-center py-6',
                    isOver && 'active'
                  )}
                >
                  {isOver ? (
                    <>
                      <Plus className="h-5 w-5 text-primary" />
                      <span className="mt-1 text-sm font-medium text-primary">
                        {t('roadmap.moscow.dropHere')}
                      </span>
                    </>
                  ) : (
                    <>
                      <Inbox className="h-5 w-5 text-muted-foreground/50" />
                      <span className="mt-1 text-xs text-muted-foreground/70">
                        {t('roadmap.moscow.emptyQuadrant')}
                      </span>
                    </>
                  )}
                </div>
              ) : (
                features.map((feature) => (
                  <SortableFeatureCard
                    key={feature.id}
                    feature={feature}
                    roadmap={roadmap}
                    onClick={() => onFeatureClick(feature)}
                    onConvertToSpec={onConvertToSpec}
                    onGoToTask={onGoToTask}
                  />
                ))
              )}
            </div>
          </SortableContext>
        </ScrollArea>
      </div>
    </section>
  );
}
