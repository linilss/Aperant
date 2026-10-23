/**
 * JSON codec for the remote access protocol.
 *
 * Electron IPC uses structured clone, which preserves Dates, binary data,
 * Maps, Sets, Errors and `undefined` array slots. Plain JSON would silently
 * turn these into strings/objects/null, so values of those types are tagged
 * on the way out and restored on the way in. Everything else follows normal
 * JSON rules (functions and symbols are dropped, BigInt becomes a string).
 *
 * Works in both Node (main process) and the browser (web renderer).
 */

const TAG = '__rt';

type Tagged =
  | { [TAG]: 'Date'; v: string | null }
  | { [TAG]: 'Bytes'; v: string }
  | { [TAG]: 'Map'; v: [unknown, unknown][] }
  | { [TAG]: 'Set'; v: unknown[] }
  | { [TAG]: 'Error'; name: string; message: string; stack?: string }
  | { [TAG]: 'undef' };

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  }
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(b64, 'base64');
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function replacer(this: unknown, key: string, value: unknown): unknown {
  // `value` has already been through toJSON (e.g. Date -> string, Buffer -> {type,data}),
  // so inspect the original value on the holder instead.
  const original = (this as Record<string, unknown>)[key];

  if (original === undefined && Array.isArray(this)) {
    return { [TAG]: 'undef' } satisfies Tagged;
  }
  if (original instanceof Date) {
    const time = original.getTime();
    return { [TAG]: 'Date', v: Number.isNaN(time) ? null : original.toISOString() } satisfies Tagged;
  }
  if (original instanceof ArrayBuffer) {
    return { [TAG]: 'Bytes', v: bytesToBase64(new Uint8Array(original)) } satisfies Tagged;
  }
  if (ArrayBuffer.isView(original) && !(original instanceof DataView)) {
    const view = original as ArrayBufferView;
    return {
      [TAG]: 'Bytes',
      v: bytesToBase64(new Uint8Array(view.buffer, view.byteOffset, view.byteLength)),
    } satisfies Tagged;
  }
  if (original instanceof Map) {
    return { [TAG]: 'Map', v: Array.from(original.entries()) };
  }
  if (original instanceof Set) {
    return { [TAG]: 'Set', v: Array.from(original.values()) };
  }
  if (original instanceof Error) {
    return { [TAG]: 'Error', name: original.name, message: original.message, stack: original.stack } satisfies Tagged;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const tagged = value as Partial<Tagged> & Record<string, unknown>;
  switch (tagged[TAG]) {
    case 'undef':
      return undefined;
    case 'Date':
      return tagged.v === null ? new Date(Number.NaN) : new Date(tagged.v as string);
    case 'Bytes':
      return base64ToBytes(tagged.v as string);
    case 'Map':
      return new Map(tagged.v as [unknown, unknown][]);
    case 'Set':
      return new Set(tagged.v as unknown[]);
    case 'Error': {
      const err = new Error(tagged.message as string);
      err.name = tagged.name as string;
      if (tagged.stack) err.stack = tagged.stack as string;
      return err;
    }
    default:
      return value;
  }
}

/** Serialize a protocol message. Throws on circular structures. */
export function encodeRemoteMessage(message: unknown): string {
  return JSON.stringify(message, replacer);
}

/** Parse a protocol message produced by `encodeRemoteMessage`. Throws on invalid JSON. */
export function decodeRemoteMessage<T = unknown>(raw: string): T {
  return JSON.parse(raw, reviver) as T;
}
