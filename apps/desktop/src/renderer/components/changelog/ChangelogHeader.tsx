import { RefreshCw, Check } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import type { WizardStep } from './hooks/useChangelog';

interface ChangelogHeaderProps {
  step: WizardStep;
  onRefresh: () => void;
}

export function ChangelogHeader({ step, onRefresh }: ChangelogHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-border px-6 py-4 max-md:flex-col max-md:items-start max-md:gap-3 max-md:px-4 max-md:py-3">
      <div className="flex items-center gap-4">
        <div>
          <h1 className="text-xl font-semibold">Changelog Generator</h1>
          <p className="text-sm text-muted-foreground">
            {step === 1
              ? 'Step 1: Select completed tasks to include'
              : step === 2
                ? 'Step 2: Configure and generate changelog'
                : 'Step 3: Release and archive tasks'}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 max-md:w-full max-md:justify-between">
        {/* Step indicators */}
        <div className="flex items-center gap-2 mr-4 max-md:mr-0">
          <StepIndicator step={1} currentStep={step} label="Select" />
          <div className="w-6 h-px bg-border max-md:w-3" />
          <StepIndicator step={2} currentStep={step} label="Generate" />
          <div className="w-6 h-px bg-border max-md:w-3" />
          <StepIndicator step={3} currentStep={step} label="Release" />
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh} className="max-md:h-10">
          <RefreshCw className="mr-2 h-4 w-4 max-md:mr-0" />
          <span className="max-md:sr-only">Refresh</span>
        </Button>
      </div>
    </div>
  );
}

interface StepIndicatorProps {
  step: WizardStep;
  currentStep: WizardStep;
  label: string;
}

function StepIndicator({ step, currentStep, label }: StepIndicatorProps) {
  const isActive = step === currentStep;
  const isComplete = step < currentStep;

  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium transition-colors',
          isComplete
            ? 'bg-primary text-primary-foreground'
            : isActive
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground'
        )}
      >
        {isComplete ? <Check className="h-3 w-3" /> : step}
      </div>
      <span
        className={cn(
          'text-sm',
          !isActive && 'max-md:hidden',
          isActive ? 'text-foreground font-medium' : 'text-muted-foreground'
        )}
      >
        {label}
      </span>
    </div>
  );
}
