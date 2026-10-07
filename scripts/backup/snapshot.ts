/**
 * Lossless JSON encoding of Firestore values for backups:
 * Timestamps → {"$ts": ms}, Bytes → {"$bytes": base64}. Pure and unit-tested.
 */
import { Timestamp } from 'firebase-admin/firestore';

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export function encode(value: unknown): Json {
  if (value === null || value === undefined) return null;
  if (value instanceof Timestamp) return { $ts: value.toMillis() };
  if (value instanceof Uint8Array) return { $bytes: Buffer.from(value).toString('base64') };
  if (Array.isArray(value)) return value.map(encode);
  if (typeof value === 'object') {
    const out: { [k: string]: Json } = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = encode(v);
    return out;
  }
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean')
    return value;
  throw new Error(`Unsupported Firestore value: ${typeof value}`);
}

export function decode(value: Json): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === '$ts')
      return Timestamp.fromMillis((value as { $ts: number }).$ts);
    if (keys.length === 1 && keys[0] === '$bytes')
      return new Uint8Array(Buffer.from((value as { $bytes: string }).$bytes, 'base64'));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = decode(v);
    return out;
  }
  return value;
}

/** A snapshot is a flat map of document path → encoded data. */
export interface Snapshot {
  version: 1;
  takenAt: number;
  docs: Record<string, Json>;
}
