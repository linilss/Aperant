import type { SyntheticEvent } from 'react';
import { Check, MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

export interface MoveToOption {
  id: string;
  label: string;
  /** Small colored dot, e.g. the MoSCoW quadrant color */
  dotClass?: string;
}

export interface MoveToConfig {
  options: MoveToOption[];
  /** Id of the option the item is in now (shown checked, selecting it is a no-op) */
  current: string;
  onSelect: (id: string) => void;
}

interface MoveToMenuProps extends MoveToConfig {
  itemTitle: string;
  className?: string;
}

/**
 * Keep taps/keys inside the menu from reaching the card: React bubbles events
 * through portals, so without this a menu tap would also open the detail panel
 * or start a dnd-kit drag on the card wrapper.
 */
const stop = (e: SyntheticEvent) => e.stopPropagation();

/** "Move to…" menu — the touch-friendly alternative to dragging a card between columns */
export function MoveToMenu({ options, current, onSelect, itemTitle, className }: MoveToMenuProps) {
  const { t } = useTranslation('common');
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={t('roadmap.moveToAriaLabel', { title: itemTitle })}
        title={t('roadmap.moveTo')}
        onClick={stop}
        onPointerDown={stop}
        onTouchStart={stop}
        onKeyDown={stop}
        className={cn(
          '-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground',
          className
        )}
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-[11rem]"
        onClick={stop}
        onPointerDown={stop}
        onTouchStart={stop}
        onKeyDown={stop}
      >
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          {t('roadmap.moveTo')}
        </DropdownMenuLabel>
        {options.map((option) => {
          const isCurrent = option.id === current;
          return (
            <DropdownMenuItem
              key={option.id}
              className="gap-2 py-2"
              onSelect={() => {
                if (!isCurrent) onSelect(option.id);
              }}
            >
              {option.dotClass && <span className={cn('h-2 w-2 shrink-0 rounded-full', option.dotClass)} />}
              <span className={cn('flex-1', isCurrent && 'font-medium')}>{option.label}</span>
              {isCurrent && <Check className="h-4 w-4 text-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
