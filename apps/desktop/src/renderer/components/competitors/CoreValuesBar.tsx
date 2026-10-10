import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Gem } from 'lucide-react';
import { loadCoreValues, selectCoreValues, useCoreValuesStore } from '../../stores/core-values-store';
import { CoreValuesMarkdown } from '../context/index/CoreValuesCard';

interface CoreValuesBarProps {
  projectId: string;
  /** Open Context → Project Index, where the values are edited */
  onGoToContext?: () => void;
}

/** Compact read-only view of the core values that steer the directions */
export function CoreValuesBar({ projectId, onGoToContext }: CoreValuesBarProps) {
  const { t } = useTranslation('common');
  const values = useCoreValuesStore((s) => selectCoreValues(s, projectId));
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void loadCoreValues(projectId);
  }, [projectId]);

  if (!values) return null;

  const link = onGoToContext && (
    <button type="button" className="shrink-0 text-xs text-primary hover:underline max-md:min-h-10" onClick={onGoToContext}>
      {values.text ? t('competitors.coreValues.edit') : t('competitors.coreValues.add')}
    </button>
  );

  if (!values.text) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Gem className="h-3.5 w-3.5 shrink-0" />
          {t('competitors.coreValues.none')}
        </span>
        {link}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? t('competitors.coreValues.hide') : t('competitors.coreValues.show')}
          className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-primary max-md:min-h-10"
        >
          <Gem className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{t('competitors.coreValues.steering')}</span>
          {open ? <ChevronUp className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
        </button>
        {link}
      </div>
      {open && (
        <div className="max-h-64 overflow-y-auto pb-1 pt-2">
          <CoreValuesMarkdown text={values.text} />
        </div>
      )}
    </div>
  );
}
