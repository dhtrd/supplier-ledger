import {
  Bytes,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
  type WriteBatch,
} from 'firebase/firestore';
import { AppError } from '../../../core/errors';
import { int, millis, str, strList } from '../../../shared/lib/firestore';
import type { Entry, EntryType, Signature } from '../domain/types';

const TYPES: EntryType[] = ['invoice', 'payment', 'note'];

export interface EntrySnapshot {
  entry: Entry;
  /** Raw document data, kept for the audit log's "before" copy. */
  raw: Record<string, unknown>;
}

export function toEntry(s: DocumentSnapshot): EntrySnapshot {
  const raw = s.data() ?? {};
  // Pending server timestamps resolve to a local estimate so new rows sort last.
  const est = s.data({ serverTimestamps: 'estimate' }) ?? {};
  const t = str(raw.type) as EntryType;
  const sig = raw.signature as Record<string, unknown> | undefined;
  const signature: Signature | null =
    sig && typeof sig === 'object'
      ? { name: str(sig.name), image: str(sig.image), signedAtMs: millis(sig.signedAt) }
      : null;
  return {
    raw,
    entry: {
      id: s.id,
      type: TYPES.includes(t) ? t : 'note',
      amount: int(raw.amount),
      signed: int(raw.signed),
      date: str(raw.date),
      order: millis(est.createdAt, Date.now()),
      deleted: raw.deleted === true,
      details: str(raw.details),
      attachments: strList(raw.attachments),
      voucherNo: typeof raw.voucherNo === 'number' ? raw.voucherNo : null,
      signature,
      createdBy: str(raw.createdBy),
      legacy: typeof raw.legacyId === 'number',
    },
  };
}

const entriesCol = (db: Firestore, accountId: string) =>
  collection(db, 'accounts', accountId, 'entries');

/** Live entries of one account, oldest first (date, then entry order). */
export function watchEntries(
  db: Firestore,
  accountId: string,
  next: (rows: EntrySnapshot[]) => void,
  fail: (e: unknown) => void,
): () => void {
  const q = query(
    entriesCol(db, accountId),
    where('deleted', '==', false),
    orderBy('date'),
    orderBy('createdAt'),
  );
  return onSnapshot(q, (snap) => next(snap.docs.map(toEntry)), fail);
}

export async function getEntry(
  db: Firestore,
  accountId: string,
  entryId: string,
): Promise<EntrySnapshot | null> {
  const s = await getDoc(doc(entriesCol(db, accountId), entryId));
  return s.exists() ? toEntry(s) : null;
}

/** A compressed image ready to store (see shared/lib/image.ts). */
export interface PreparedImage {
  data: Uint8Array;
  mime: 'image/webp' | 'image/jpeg';
}

type Writer = Pick<WriteBatch, 'set'> | Pick<Transaction, 'set'>;

function writeAttachments(
  w: Writer,
  db: Firestore,
  uid: string,
  accountId: string,
  entryId: string,
  files: PreparedImage[],
): string[] {
  return files.map((f) => {
    const ref = doc(collection(db, 'accounts', accountId, 'attachments'));
    (w.set as (r: DocumentReference, d: object) => void)(ref, {
      data: Bytes.fromUint8Array(f.data),
      mime: f.mime,
      size: f.data.byteLength,
      entryId,
      createdAt: serverTimestamp(),
      createdBy: uid,
    });
    return ref.id;
  });
}

export interface NewEntry {
  type: EntryType;
  amount: number;
  signed: number;
  date: string;
  details: string;
}

/**
 * Creates an entry with its images in one atomic write. Payments take the
 * next voucher number from counters/vouchers inside a transaction.
 */
export async function createEntry(
  db: Firestore,
  uid: string,
  accountId: string,
  input: NewEntry,
  files: PreparedImage[],
): Promise<{ id: string; voucherNo: number | null }> {
  const ref = doc(entriesCol(db, accountId));
  const base = {
    type: input.type,
    amount: input.amount,
    signed: input.signed,
    date: input.date,
    details: input.details,
    deleted: false,
    createdAt: serverTimestamp(),
    createdBy: uid,
  };
  if (input.type !== 'payment') {
    const batch = writeBatch(db);
    const attachments = writeAttachments(batch, db, uid, accountId, ref.id, files);
    batch.set(ref, { ...base, attachments });
    await batch.commit();
    return { id: ref.id, voucherNo: null };
  }
  const counter = doc(db, 'counters', 'vouchers');
  const voucherNo = await runTransaction(db, async (tx) => {
    const c = await tx.get(counter);
    if (!c.exists()) throw new AppError('عدّاد السندات غير مهيأ. شغّل سكربت إنشاء المالك أولاً.');
    const next = int(c.data().next) + 1;
    tx.update(counter, { next });
    const attachments = writeAttachments(tx, db, uid, accountId, ref.id, files);
    tx.set(ref, { ...base, attachments, voucherNo: next });
    return next;
  });
  return { id: ref.id, voucherNo };
}

export interface EntryChanges {
  amount: number;
  signed: number;
  date: string;
  details: string;
  /** Attachment ids that remain after the edit. */
  keepAttachments: string[];
}

function auditRecord(uid: string, action: 'update' | 'delete', path: string, before: object) {
  return { actor: uid, action, path, before, at: serverTimestamp() };
}

/** Edits an unsigned entry; the previous version goes to auditLog atomically. */
export async function updateEntry(
  db: Firestore,
  uid: string,
  accountId: string,
  current: EntrySnapshot,
  changes: EntryChanges,
  newFiles: PreparedImage[],
  revokeLinkIds: string[] = [],
): Promise<void> {
  if (current.entry.signature) throw new AppError('السند موقّع ولا يمكن تعديله.');
  const ref = doc(entriesCol(db, accountId), current.entry.id);
  const audit = doc(collection(db, 'auditLog'));
  const batch = writeBatch(db);
  batch.set(audit, auditRecord(uid, 'update', ref.path, current.raw));
  // An open signing link must never outlive the amount it was issued for.
  for (const l of revokeLinkIds) batch.update(doc(db, 'signLinks', l), { status: 'revoked' });
  const added = writeAttachments(batch, db, uid, accountId, current.entry.id, newFiles);
  batch.update(ref, {
    amount: changes.amount,
    signed: changes.signed,
    date: changes.date,
    details: changes.details,
    attachments: [...changes.keepAttachments, ...added],
    auditId: audit.id,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
  await batch.commit();
}

/** Soft delete (kept for the audit trail and backups). */
export async function deleteEntry(
  db: Firestore,
  uid: string,
  accountId: string,
  current: EntrySnapshot,
  revokeLinkIds: string[] = [],
): Promise<void> {
  if (current.entry.signature) throw new AppError('السند موقّع ولا يمكن حذفه.');
  const ref = doc(entriesCol(db, accountId), current.entry.id);
  const audit = doc(collection(db, 'auditLog'));
  const batch = writeBatch(db);
  for (const l of revokeLinkIds) batch.update(doc(db, 'signLinks', l), { status: 'revoked' });
  batch.set(audit, auditRecord(uid, 'delete', ref.path, current.raw));
  batch.update(ref, {
    deleted: true,
    deletedAt: serverTimestamp(),
    auditId: audit.id,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
  await batch.commit();
}

export async function getAttachment(
  db: Firestore,
  accountId: string,
  attachmentId: string,
): Promise<{ data: Uint8Array; mime: string } | null> {
  const s = await getDoc(doc(db, 'accounts', accountId, 'attachments', attachmentId));
  if (!s.exists()) return null;
  const d = s.data();
  const data = d.data instanceof Bytes ? d.data.toUint8Array() : null;
  return data ? { data, mime: str(d.mime, 'image/jpeg') } : null;
}
