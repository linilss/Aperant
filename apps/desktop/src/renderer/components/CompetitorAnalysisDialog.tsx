import { useTranslation } from 'react-i18next';
import { Swords, Compass, ListOrdered } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogAction,
  AlertDialogCancel,
} from './ui/alert-dialog';

interface CompetitorAnalysisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Analyze competitors first" — go to the Competitors step of the Plan funnel */
  onAccept: () => void;
  /** Generate the roadmap without competitor analysis */
  onDecline: () => void;
}

/**
 * Shown when generating a roadmap before the Competitors step has run.
 * Competitor analysis lives on the Competitors page; the roadmap reuses it.
 */
export function CompetitorAnalysisDialog({ open, onOpenChange, onAccept, onDecline }: CompetitorAnalysisDialogProps) {
  const { t } = useTranslation(['dialogs']);

  const handleAccept = () => {
    onAccept();
    onOpenChange(false);
  };

  const handleDecline = () => {
    onDecline();
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-[500px]">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-foreground">
            <Swords className="h-5 w-5 text-primary" />
            {t('dialogs:competitorAnalysis.title')}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-muted-foreground">
            {t('dialogs:competitorAnalysis.description')}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 py-4">
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
            <h4 className="mb-2 text-sm font-medium text-foreground">{t('dialogs:competitorAnalysis.whatItDoes')}</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <Swords className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                <span>{t('dialogs:competitorAnalysis.stepAnalyze')}</span>
              </li>
              <li className="flex items-start gap-2">
                <ListOrdered className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                <span>{t('dialogs:competitorAnalysis.stepRank')}</span>
              </li>
              <li className="flex items-start gap-2">
                <Compass className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                <span>{t('dialogs:competitorAnalysis.stepGuide')}</span>
              </li>
            </ul>
          </div>
          <p className="text-xs text-muted-foreground">{t('dialogs:competitorAnalysis.optionalInfo')}</p>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleDecline}>{t('dialogs:competitorAnalysis.skipAnalysis')}</AlertDialogCancel>
          <AlertDialogAction onClick={handleAccept}>{t('dialogs:competitorAnalysis.goToCompetitors')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
