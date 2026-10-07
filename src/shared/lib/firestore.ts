import { Bytes, Timestamp, type DocumentData } from 'firebase/firestore';

/** Defensive readers: Firestore data is external input until proven otherwise. */
export const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
export const int = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback;
export const bool = (v: unknown, fallback = false): boolean =>
  typeof v === 'boolean' ? v : fallback;
export const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
export const millis = (v: unknown, fallback = 0): number =>
  v instanceof Timestamp ? v.toMillis() : fallback;
export const bytes = (v: unknown): Uint8Array | null =>
  v instanceof Bytes ? v.toUint8Array() : null;

export type Raw = DocumentData;
