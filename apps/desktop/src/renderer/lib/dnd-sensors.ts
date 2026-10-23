import type { PointerEvent as ReactPointerEvent } from 'react';
import { PointerSensor, type PointerSensorOptions } from '@dnd-kit/core';

/**
 * PointerSensor that ignores touch pointers, so it can sit next to a
 * TouchSensor: mouse/pen drag exactly as before, while touch uses the
 * TouchSensor's long-press (a plain swipe keeps scrolling the page).
 */
export class MouseAndPenSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: (event: ReactPointerEvent, options: PointerSensorOptions): boolean => {
        if (event.nativeEvent.pointerType === 'touch') return false;
        return PointerSensor.activators[0].handler(event, options);
      }
    }
  ];
}

/** Long-press to drag on touch screens; moving more than 5px first cancels (= scroll). */
export const TOUCH_DRAG_ACTIVATION = { delay: 250, tolerance: 5 } as const;
