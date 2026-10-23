import { useTranslation } from 'react-i18next';
import { Gift, Users } from 'lucide-react';
import { Badge } from '../../ui/badge';
import { IDEATION_IMPACT_COLORS } from '../../../../shared/constants';
import type { FeatureIdea } from '../../../../shared/types';

interface FeatureDetailsProps {
  idea: FeatureIdea;
}

export function FeatureDetails({ idea }: FeatureDetailsProps) {
  const { t } = useTranslation('common');
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline" className={IDEATION_IMPACT_COLORS[idea.impact]}>
          {t(`ideation.feature.impactBadge.${idea.impact}`)}
        </Badge>
        <Badge variant="outline">{t(`ideation.feature.complexityBadge.${idea.complexity}`)}</Badge>
      </div>

      {idea.userValue && (
        <div>
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <Gift className="h-4 w-4" />
            {t('ideation.feature.userValue')}
          </h3>
          <p className="text-sm text-muted-foreground">{idea.userValue}</p>
        </div>
      )}

      {idea.targetUsers && (
        <div>
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <Users className="h-4 w-4" />
            {t('ideation.feature.targetUsers')}
          </h3>
          <p className="text-sm text-muted-foreground">{idea.targetUsers}</p>
        </div>
      )}
    </>
  );
}
