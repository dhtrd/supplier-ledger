import { cleanText } from '../../../shared/lib/text';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import { int, millis, str } from '../../../shared/lib/firestore';
import { DEFAULT_SETTINGS, type AppSettings } from '../domain/types';

export function watchSettings(
  db: Firestore,
  next: (s: AppSettings) => void,
  fail: (e: unknown) => void,
): () => void {
  return onSnapshot(
    doc(db, 'settings', 'app'),
    (s) => {
      const d = s.data() ?? {};
      const labels = (d.roleLabels ?? {}) as Record<string, unknown>;
      next({
        linkMinutes: int(d.linkMinutes, DEFAULT_SETTINGS.linkMinutes),
        idleMinutes: int(d.idleMinutes, DEFAULT_SETTINGS.idleMinutes),
        idleCountdownSeconds: int(d.idleCountdownSeconds, DEFAULT_SETTINGS.idleCountdownSeconds),
        payerName: str(d.payerName, DEFAULT_SETTINGS.payerName),
        roleLabels: {
          owner: str(labels.owner, DEFAULT_SETTINGS.roleLabels.owner),
          admin: str(labels.admin, DEFAULT_SETTINGS.roleLabels.admin),
          entry: str(labels.entry, DEFAULT_SETTINGS.roleLabels.entry),
        },
      });
    },
    fail,
  );
}

export async function saveSettings(db: Firestore, uid: string, s: AppSettings): Promise<void> {
  await updateDoc(doc(db, 'settings', 'app'), {
    linkMinutes: s.linkMinutes,
    idleMinutes: s.idleMinutes,
    idleCountdownSeconds: s.idleCountdownSeconds,
    payerName: cleanText(s.payerName),
    roleLabels: {
      owner: cleanText(s.roleLabels.owner),
      admin: cleanText(s.roleLabels.admin),
      entry: cleanText(s.roleLabels.entry),
    },
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

export interface BackupMeta {
  lastBackupMs: number | null;
  docs: number;
  images: number;
  /** Approximate stored size in bytes (JSON + images), written by the backup job. */
  bytes: number | null;
}

export async function getBackupMeta(db: Firestore): Promise<BackupMeta> {
  const s = await getDoc(doc(db, 'meta', 'backup'));
  const d = s.data() ?? {};
  const last = millis(d.lastBackupAt, -1);
  return {
    lastBackupMs: last < 0 ? null : last,
    docs: int(d.docs),
    images: int(d.images),
    bytes: typeof d.bytes === 'number' ? d.bytes : null,
  };
}

export type AuditAction = 'update' | 'delete' | 'restore' | 'archive' | 'unarchive';
const ACTIONS: AuditAction[] = ['update', 'delete', 'restore', 'archive', 'unarchive'];

export interface AuditItem {
  id: string;
  actor: string;
  action: AuditAction;
  path: string;
  atMs: number;
  before: Record<string, unknown>;
}

export async function listAudit(db: Firestore, max = 100): Promise<AuditItem[]> {
  const snap = await getDocs(query(collection(db, 'auditLog'), orderBy('at', 'desc'), limit(max)));
  return snap.docs.map((s) => {
    const d = s.data();
    return {
      id: s.id,
      actor: str(d.actor),
      action: ACTIONS.includes(d.action as AuditAction) ? (d.action as AuditAction) : 'update',
      path: str(d.path),
      atMs: millis(d.at),
      before: (d.before ?? {}) as Record<string, unknown>,
    };
  });
}
