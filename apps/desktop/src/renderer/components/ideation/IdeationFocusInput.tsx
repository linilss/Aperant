import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Crosshair } from 'lucide-react';
import { Textarea } from '../ui/textarea';
import { MAX_IDEATION_FOCUS_LENGTH } from '../../../shared/constants';

interface IdeationFocusInputProps {
  value: string;
  onChange: (focus: string) => void;
}

/** Optional free-text steer for the idea search (sent to every ideation type) */
export function IdeationFocusInput({ value, onChange }: IdeationFocusInputProps) {
  const { t } = useTranslation('common');
  const id = useId();
  return (
    <div className="space-y-1.5 text-left">
      <label htmlFor={id} className="flex items-center gap-2 text-sm font-medium">
        <Crosshair className="h-4 w-4 text-muted-foreground" />
        {t('ideation.focus.label')}
        <span className="text-xs font-normal text-muted-foreground">{t('ideation.focus.optional')}</span>
      </label>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('ideation.focus.placeholder')}
        maxLength={MAX_IDEATION_FOCUS_LENGTH}
        rows={2}
        className="min-h-[64px] text-base md:text-sm"
      />
      <p className="text-xs text-muted-foreground">{t('ideation.focus.hint')}</p>
    </div>
  );
}
