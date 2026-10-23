import { CheckCircle2, Circle, Loader2, SkipForward, ChevronRight } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

export interface PhaseInfo {
  name: string;
  label: string;
  status: string;
}

interface RefinePhaseBarProps {
  phases: PhaseInfo[];
  currentPhaseIndex: number;
  onSkip: () => void;
}

function PhaseIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-3.5 w-3.5 text-success" />;
    case 'active':
      return <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />;
    case 'skipped':
      return <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />;
    default:
      return <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />;
  }
}

export function RefinePhaseBar({ phases, currentPhaseIndex, onSkip }: RefinePhaseBarProps) {
  const hasActivePhase = phases.some(p => p.status === 'active');

  return (
    <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-muted/30 shrink-0">
      {phases.map((phase, i) => (
        <div key={phase.name} className="flex items-center gap-1">
          {i > 0 && <div className="w-3 h-px bg-border" />}
          <div
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded text-xs',
              phase.status === 'active' && 'bg-primary/10 text-primary font-medium',
              phase.status === 'completed' && 'text-success',
              phase.status === 'skipped' && 'text-muted-foreground line-through',
              phase.status === 'pending' && 'text-muted-foreground/60',
            )}
          >
            <PhaseIcon status={phase.status} />
            <span>{phase.label}</span>
          </div>
        </div>
      ))}

      <div className="flex-1" />

      {hasActivePhase && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
          onClick={onSkip}
        >
          <SkipForward className="h-3 w-3" />
          Skip
        </Button>
      )}
    </div>
  );
}
