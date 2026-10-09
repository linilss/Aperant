import { describe, it, expect } from 'vitest';
import { createKeyedLimiter } from '../refine-queue';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createKeyedLimiter', () => {
  it('runs at most 2 tasks per key at once, FIFO, and independently per key', async () => {
    const limiter = createKeyedLimiter(2);
    let running = 0;
    let peak = 0;
    const order: number[] = [];
    const gates = Array.from({ length: 5 }, deferred);

    const tasks = gates.map((gate, i) =>
      limiter.run('p1', async () => {
        running++;
        peak = Math.max(peak, running);
        order.push(i);
        await gate.promise;
        running--;
        return i;
      }),
    );

    // Another project is not blocked by p1's queue
    let otherRan = false;
    const other = limiter.run('p2', async () => {
      otherRan = true;
    });

    await tick();
    expect(running).toBe(2);
    expect(limiter.size('p1')).toBe(5);
    expect(otherRan).toBe(true);

    for (const gate of gates) {
      gate.resolve();
      await tick();
      expect(running).toBeLessThanOrEqual(2);
    }

    expect(await Promise.all(tasks)).toEqual([0, 1, 2, 3, 4]);
    await other;
    expect(peak).toBe(2);
    expect(order).toEqual([0, 1, 2, 3, 4]);
    expect(limiter.size('p1')).toBe(0);
  });

  it('releases the slot when a task throws', async () => {
    const limiter = createKeyedLimiter(1);
    await expect(limiter.run('p', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(limiter.run('p', async () => 'ok')).resolves.toBe('ok');
    expect(limiter.size('p')).toBe(0);
  });
});
