import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '../../../hooks/use-toast';
import { ToastAction } from '../../ui/toast';
import { useIdeationStore } from '../../../stores/ideation-store';
import { loadRoadmap } from '../../../stores/roadmap-store';
import type { Idea } from '../../../../shared/types';

/**
 * "Add to roadmap": creates a roadmap feature from the idea, links the idea,
 * refreshes the roadmap store (so Roadmap and MoSCoW show it) and toasts with
 * a "View in MoSCoW" action.
 */
export function useAddIdeaToRoadmap(projectId: string, onGoToMoscow?: () => void) {
  const { t } = useTranslation('common');
  const [addingIdeas, setAddingIdeas] = useState<Set<string>>(new Set());
  // Synchronous guard against double clicks (state is stale inside the closure)
  const addingRef = useRef<Set<string>>(new Set());

  const handleAddToRoadmap = useCallback(
    async (idea: Idea) => {
      if (addingRef.current.has(idea.id)) return;
      addingRef.current.add(idea.id);
      setAddingIdeas(new Set(addingRef.current));

      try {
        const result = await window.electronAPI.addIdeaToRoadmap(projectId, idea.id);
        if (!result.success || !result.data) {
          toast({
            variant: 'destructive',
            title: t('ideation.addToRoadmapFailed'),
            description: result.error || t('errors.unknownError'),
          });
          return;
        }
        useIdeationStore.getState().setIdeaRoadmapFeatureId(idea.id, result.data.featureId);
        await loadRoadmap(projectId);
        toast({
          title: t('ideation.addedToRoadmap'),
          description: t('ideation.addedToRoadmapDescription', { title: idea.title }),
          action: onGoToMoscow ? (
            <ToastAction altText={t('ideation.viewInMoscow')} onClick={onGoToMoscow}>
              {t('ideation.viewInMoscow')}
            </ToastAction>
          ) : undefined,
        });
      } catch (error) {
        toast({
          variant: 'destructive',
          title: t('ideation.addToRoadmapFailed'),
          description: error instanceof Error ? error.message : t('errors.unknownError'),
        });
      } finally {
        addingRef.current.delete(idea.id);
        setAddingIdeas(new Set(addingRef.current));
      }
    },
    [projectId, onGoToMoscow, t]
  );

  return { handleAddToRoadmap, addingIdeas };
}
