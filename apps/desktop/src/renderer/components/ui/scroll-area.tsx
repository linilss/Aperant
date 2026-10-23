import * as React from 'react';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import { cn } from '../../lib/utils';

/**
 * Radix wraps the viewport content in a `display: table; min-width: 100%` div so it can
 * scroll sideways. That lets wide content (long words, code, nowrap rows) stretch the
 * whole column past the viewport, where it gets clipped. By default the wrapper is a
 * plain block, so content is laid out at the viewport width and wraps/truncates.
 * Pass `horizontal` only where the content should keep its own width and scroll sideways.
 */
const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
    viewportClassName?: string;
    onViewportRef?: (element: HTMLDivElement | null) => void;
    /** Keep the content's intrinsic width and add a horizontal scrollbar */
    horizontal?: boolean;
  }
>(({ className, children, viewportClassName, onViewportRef, horizontal = false, ...props }, ref) => {
  const viewportRef = React.useCallback(
    (element: HTMLDivElement | null) => {
      onViewportRef?.(element);
    },
    [onViewportRef]
  );

  return (
    <ScrollAreaPrimitive.Root
      ref={ref}
      className={cn('relative overflow-hidden', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        className={cn(
          'h-full w-full rounded-[inherit]',
          !horizontal && '[&>div]:block! [&>div]:min-w-0!',
          viewportClassName
        )}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      {horizontal && <ScrollBar orientation="horizontal" />}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
});
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName;

const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = 'vertical', ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      'flex touch-none select-none transition-colors',
      orientation === 'vertical' && 'h-full w-2.5 border-l border-l-transparent p-[1px]',
      orientation === 'horizontal' && 'h-2.5 flex-col border-t border-t-transparent p-[1px]',
      className
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
));
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName;

export { ScrollArea, ScrollBar };
