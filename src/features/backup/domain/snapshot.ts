import { fileStamp } from '../../../shared/lib/dates';
import { Bytes, Timestamp } from 'firebase/firestore';
import { toBase64 } from '../../../shared/lib/backupCrypto';

/**
 * Same lossless encoding as scripts/backup/snapshot.ts, for the client SDK:
 * Timestamp → {"$ts": ms}, Bytes → {"$bytes": base64}. restore.ts reads both.
 */
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export function encodeValue(value: unknown): Json {
  if (value === null || value === undefined) return null;
  if (value instanceof Timestamp) return { $ts: value.toMillis() };
  if (value instanceof Bytes) return { $bytes: toBase64(value.toUint8Array()) };
  if (Array.isArray(value)) return value.map(encodeValue);
  if (typeof value === 'object') {
    const out: { [k: string]: Json } = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = encodeValue(v);
    return out;
  }
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean')
    return value;
  throw new Error(`Unsupported Firestore value: ${typeof value}`);
}

export interface Snapshot {
  version: 1;
  takenAt: number;
  docs: Record<string, Json>;
}

/** Download name, Riyadh time, 12-hour: supplier-ledger-backup-2026-10-07_02-58م.slbackup */
export function backupFileName(takenAt: number): string {
  return `supplier-ledger-backup-${fileStamp(takenAt)}.slbackup`;
}
