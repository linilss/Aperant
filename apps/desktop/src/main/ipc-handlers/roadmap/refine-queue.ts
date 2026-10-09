/**
 * Per-key concurrency limiter: at most `maxConcurrent` tasks run per key (project);
 * the rest wait in FIFO order. Keys are independent of each other.
 */
export interface KeyedLimiter {
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
  /** Running + waiting tasks for a key */
  size(key: string): number;
}

export function createKeyedLimiter(maxConcurrent: number): KeyedLimiter {
  const lanes = new Map<string, { running: number; waiting: Array<() => void> }>();

  const lane = (key: string) => {
    let l = lanes.get(key);
    if (!l) {
      l = { running: 0, waiting: [] };
      lanes.set(key, l);
    }
    return l;
  };

  return {
    async run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const l = lane(key);
      if (l.running >= maxConcurrent) {
        await new Promise<void>((resolve) => l.waiting.push(resolve));
      } else {
        l.running++;
      }
      try {
        return await task();
      } finally {
        const next = l.waiting.shift();
        if (next) {
          next(); // hand the slot over; running count stays the same
        } else {
          l.running--;
          if (l.running === 0) lanes.delete(key);
        }
      }
    },
    size(key: string): number {
      const l = lanes.get(key);
      return l ? l.running + l.waiting.length : 0;
    },
  };
}
