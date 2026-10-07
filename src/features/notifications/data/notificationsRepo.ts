import {
  arrayUnion,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
  type DocumentSnapshot,
  type Firestore,
  type DocumentReference,
  type Transaction,
  type WriteBatch,
} from 'firebase/firestore';
import { millis, str, strList } from '../../../shared/lib/firestore';
import type { AppNotification, NotificationKind } from '../domain/notification';

const KINDS: NotificationKind[] = [
  'signedEdit',
  'invoiceEdit',
  'delete',
  'restore',
  'accountDelete',
  'accountRestore',
];
export const NOTIFICATIONS_SHOWN = 100;

export interface NewNotification {
  kind: NotificationKind;
  accountId: string;
  entryId: string;
  accountName: string;
  title: string;
  changes: string[];
  actor: string;
  actorName: string;
}

/** Adds the notification to the batch that makes the change (id = audit id). */
export function addNotification(
  batch: Pick<WriteBatch, 'set'> | Pick<Transaction, 'set'>,
  db: Firestore,
  auditId: string,
  n: NewNotification,
): void {
  (batch.set as (r: DocumentReference, d: object) => void)(doc(db, 'notifications', auditId), {
    ...n,
    accountName: n.accountName.slice(0, 120),
    title: n.title.slice(0, 120),
    at: serverTimestamp(),
    readBy: [],
  });
}

export function toNotification(s: DocumentSnapshot): AppNotification {
  const d = s.data({ serverTimestamps: 'estimate' }) ?? {};
  const k = str(d.kind) as NotificationKind;
  return {
    id: s.id,
    kind: KINDS.includes(k) ? k : 'invoiceEdit',
    accountId: str(d.accountId),
    entryId: str(d.entryId),
    accountName: str(d.accountName),
    title: str(d.title),
    changes: strList(d.changes),
    actor: str(d.actor),
    actorName: str(d.actorName),
    atMs: millis(d.at),
    readBy: strList(d.readBy),
  };
}

/** Newest first (managers only). */
export function watchNotifications(
  db: Firestore,
  next: (rows: AppNotification[]) => void,
  fail: (e: unknown) => void,
): () => void {
  const q = query(
    collection(db, 'notifications'),
    orderBy('at', 'desc'),
    limit(NOTIFICATIONS_SHOWN),
  );
  return onSnapshot(q, (snap) => next(snap.docs.map(toNotification)), fail);
}

export async function markRead(db: Firestore, uid: string, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 400) {
    const batch = writeBatch(db);
    for (const id of ids.slice(i, i + 400))
      batch.update(doc(db, 'notifications', id), { readBy: arrayUnion(uid) });
    await batch.commit();
  }
}
