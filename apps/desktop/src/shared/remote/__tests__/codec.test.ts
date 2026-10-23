import { describe, expect, it } from 'vitest';
import { decodeRemoteMessage, encodeRemoteMessage } from '../codec';

const roundTrip = <T>(value: T): T => decodeRemoteMessage<T>(encodeRemoteMessage(value));

describe('remote codec', () => {
  it('preserves undefined slots in argument arrays', () => {
    const args = roundTrip(['p1', undefined, 3]);
    expect(args).toHaveLength(3);
    expect(args[1]).toBeUndefined();
    const withDefault = (_a: string, b = 'default'): string => b;
    expect(withDefault(...(args as [string, string]))).toBe('default');
  });

  it('restores Dates, bytes, Maps, Sets and Errors', () => {
    const value = roundTrip({
      at: new Date('2026-01-02T03:04:05.000Z'),
      bytes: new Uint8Array([1, 2, 255]),
      buf: Buffer.from('hi'),
      map: new Map([['k', { n: 1 }]]),
      set: new Set(['a']),
      err: new TypeError('bad'),
    });
    expect(value.at).toBeInstanceOf(Date);
    expect(value.at.toISOString()).toBe('2026-01-02T03:04:05.000Z');
    expect(Array.from(value.bytes)).toEqual([1, 2, 255]);
    expect(Buffer.from(value.buf).toString()).toBe('hi');
    expect(value.map.get('k')).toEqual({ n: 1 });
    expect(value.set.has('a')).toBe(true);
    expect(value.err).toBeInstanceOf(Error);
    expect(value.err.message).toBe('bad');
    expect(value.err.name).toBe('TypeError');
  });

  it('throws on circular structures', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => encodeRemoteMessage(circular)).toThrow();
  });
});
