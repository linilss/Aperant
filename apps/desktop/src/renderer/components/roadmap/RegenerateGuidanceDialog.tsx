import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Compass } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';

interface RegenerateGuidanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Direction given on the previous regenerate, used to prefill */
  initialGuidance: string;
  /** Continue with the regenerate; guidance may be empty */
  onConfirm: (guidance: string) => void;
}

/**
 * First step of "Regenerate Roadmap": lets the user nudge the next roadmap,
 * e.g. point out a direction the current cards take that they don't want.
 */
export function RegenerateGuidanceDialog({
  open,
  onOpenChange,
  initialGuidance,
  onConfirm,
}: RegenerateGuidanceDialogProps) {
  const { t } = useTranslation(['dialogs']);
  const [text, setText] = useState(initialGuidance);

  // Start each opening from the last direction given
  useEffect(() => {
    if (open) setText(initialGuidance);
  }, [open, initialGuidance]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onConfirm(text);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Compass className="h-5 w-5 text-primary" />
            {t('dialogs:regenerateRoadmap.title')}
          </DialogTitle>
          <DialogDescription>{t('dialogs:regenerateRoadmap.description')}</DialogDescription>
        </DialogHeader>

        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('dialogs:regenerateRoadmap.placeholder')}
          className="min-h-[140px]"
          autoFocus
        />
        <p className="text-xs text-muted-foreground">{t('dialogs:regenerateRoadmap.hint')}</p>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('dialogs:regenerateRoadmap.cancel')}
          </Button>
          <Button onClick={() => onConfirm(text)}>
            {text.trim()
              ? t('dialogs:regenerateRoadmap.continueWithGuidance')
              : t('dialogs:regenerateRoadmap.continueWithout')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
