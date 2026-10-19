import type * as React from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button, type ButtonProps } from './button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from './dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

/*
 * One responsive page pattern for every top-level view:
 *
 *   <div className={PAGE_ROOT}>
 *     <PageHeader ... />                       // scrolls away on phones
 *     <div className={PAGE_STICKY}>tabs</div>  // optional compact row, pinned on phones
 *     <ScrollArea className={PAGE_BODY}>...</ScrollArea>
 *   </div>
 *
 * Desktop: header fixed, body scrolls. Phone (< md) or touch screen: the page root is the scroller, so the
 * header scrolls out of view and only the compact tab/filter row stays pinned.
 */

/** Page root: desktop clips and lets the body scroll; phones scroll the whole page. */
export const PAGE_ROOT = 'flex h-full min-w-0 flex-col overflow-hidden pagescroll:overflow-y-auto pagescroll:overscroll-contain';
/** Region under the header: fills and scrolls on desktop, grows to its content on phones. */
export const PAGE_BODY = 'min-h-0 flex-1 pagescroll:flex-none';
/** Compact tab/filter row that stays pinned while a phone scrolls the page. */
export const PAGE_STICKY = 'pagescroll:sticky pagescroll:top-0 pagescroll:z-10 pagescroll:bg-background';

export interface PageHeaderAction {
  id: string;
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  /** Stays a visible button on phones; other actions fold into the "⋯" menu below md */
  primary?: boolean;
  variant?: ButtonProps['variant'];
  /** Spins the icon while work is in progress */
  busy?: boolean;
  /** Desktop: icon-only button with the label as tooltip */
  iconOnly?: boolean;
  /** Extra tooltip text on desktop */
  tooltip?: string;
  hidden?: boolean;
}

interface PageHeaderProps {
  icon?: LucideIcon;
  title: React.ReactNode;
  /** Inline next to the title (status badge etc.) */
  titleAddon?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: PageHeaderAction[];
  /** Custom controls that are always visible before the actions (toggles, selects) */
  extra?: React.ReactNode;
  /** Rows below the title line (chips, stats, filters) */
  children?: React.ReactNode;
  className?: string;
}

function ActionButton({ action, className }: { action: PageHeaderAction; className?: string }) {
  const Icon = action.icon;
  const icon = Icon && (
    <Icon className={cn('h-4 w-4', !action.iconOnly && 'mr-1.5', action.busy && 'animate-spin')} />
  );
  const button = (
    <Button
      variant={action.variant ?? (action.primary ? 'default' : 'outline')}
      size="sm"
      onClick={action.onClick}
      disabled={action.disabled}
      aria-label={action.iconOnly ? action.label : undefined}
      className={cn('max-md:h-10', action.iconOnly && Icon && 'w-8 px-0 max-md:w-10', className)}
    >
      {icon}
      {!(action.iconOnly && Icon) && action.label}
    </Button>
  );
  const tip = action.tooltip ?? (action.iconOnly ? action.label : undefined);
  if (!tip) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Shared page header: optional icon tile, title (+ addon), subtitle and actions.
 * Actions wrap under the title when space runs out; on phones only `primary` actions
 * stay as buttons and the rest move into a "⋯" menu.
 */
export function PageHeader({
  icon: Icon,
  title,
  titleAddon,
  subtitle,
  actions = [],
  extra,
  children,
  className
}: PageHeaderProps) {
  const { t } = useTranslation('common');
  const visible = actions.filter((a) => !a.hidden);
  const secondary = visible.filter((a) => !a.primary);

  return (
    <header
      className={cn(
        'shrink-0 border-b border-border bg-card/50 px-6 py-4 max-md:px-3 max-md:py-3',
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-[1_1_14rem] items-center gap-3">
          {Icon && (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 max-md:h-9 max-md:w-9">
              <Icon className="h-5 w-5 text-primary" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="min-w-0 truncate text-lg font-semibold leading-tight text-foreground max-md:text-base">
                {title}
              </h2>
              {titleAddon}
            </div>
            {subtitle && (
              <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground max-md:line-clamp-1 max-md:text-xs">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {(extra || visible.length > 0) && (
          <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
            {extra}
            {visible.map((action) => (
              <ActionButton
                key={action.id}
                action={action}
                className={action.primary ? undefined : 'max-md:hidden'}
              />
            ))}
            {secondary.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="md:hidden"
                    aria-label={t('accessibility.moreOptionsAriaLabel')}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[12rem]">
                  {secondary.map((action) => {
                    const ItemIcon = action.icon;
                    return (
                      <DropdownMenuItem
                        key={action.id}
                        disabled={action.disabled}
                        onSelect={action.onClick}
                        className="min-h-10 gap-2"
                      >
                        {ItemIcon && <ItemIcon className={cn('h-4 w-4', action.busy && 'animate-spin')} />}
                        {action.label}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </div>
      {children && <div className="mt-3 space-y-2 max-md:mt-2.5">{children}</div>}
    </header>
  );
}

/**
 * Row of chips/badges/stats: wraps on desktop, scrolls sideways with an edge fade on phones.
 */
export function ChipRow({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2',
        'max-md:-mx-3 max-md:flex-nowrap max-md:overflow-x-auto max-md:px-3 max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden max-md:[&>*]:shrink-0',
        'max-md:[mask-image:linear-gradient(to_right,#000_calc(100%-1.5rem),transparent)]',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
