import { ArrowRight } from 'lucide-react';
import { Button } from '../ui/button';

interface NextStepButtonProps {
  label: string;
  onClick: () => void;
}

/** Subtle "Next: <step> →" link that keeps the plan funnel flowing */
export function NextStepButton({ label, onClick }: NextStepButtonProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="gap-1.5 text-muted-foreground hover:text-foreground max-md:h-10"
    >
      {label}
      <ArrowRight className="h-4 w-4" />
    </Button>
  );
}
