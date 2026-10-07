import {
  Bytes,
  collection,
  collectionGroup,
  deleteField,
  doc,
  getDocs,
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
import { addNotification } from '../../notifications/data/notificationsRepo';
import {
  describeChanges,
  editKind,
  entrySummary,
  entryTitle,
} from '../../notifications/domain/notification';

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
      subtype: raw.subtype === 'return' || raw.subtype === 'discount' ? raw.subtype : null,
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
  /** Original (≤ 300 KB); moved to Dropbox by the nightly job. */
  data: Uint8Array;
  /** Small preview (≤ 60 KB) that stays in Firestore. */
  thumb: Uint8Array;
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
      thumb: Bytes.fromUint8Array(f.thumb),
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

type AuditAction = 'update' | 'delete' | 'restore';

function auditRecord(uid: string, action: AuditAction, path: string, before: object) {
  return { actor: uid, action, path, before, at: serverTimestamp() };
}

/** Who acts and on which account — the notification text needs both names. */
export interface ChangeContext {
  actorName: string;
  accountName: string;
}

/** True when saving these values would actually change the entry. */
export function entryChanged(current: Entry, changes: EntryChanges, newFiles: number): boolean {
  return (
    newFiles > 0 ||
    describeChanges(
      current.type,
      {
        amount: current.amount,
        date: current.date,
        details: current.details,
        attachments: current.attachments.length,
      },
      {
        amount: changes.amount,
        date: changes.date,
        details: changes.details,
        attachments: changes.keepAttachments.length,
      },
    ).length > 0
  );
}

/**
 * Edits an entry; the previous version goes to auditLog atomically. Editing a
 * signed voucher removes its signature (a new link must be sent); a signed
 * voucher or an invoice also notifies the owner and managers.
 */
export async function updateEntry(
  db: Firestore,
  uid: string,
  accountId: string,
  current: EntrySnapshot,
  changes: EntryChanges,
  newFiles: PreparedImage[],
  revokeLinkIds: string[],
  ctx: ChangeContext,
): Promise<void> {
  const e = current.entry;
  if (!entryChanged(e, changes, newFiles.length)) throw new AppError('لا تغييرات للحفظ.');
  const ref = doc(entriesCol(db, accountId), e.id);
  const audit = doc(collection(db, 'auditLog'));
  const batch = writeBatch(db);
  batch.set(audit, auditRecord(uid, 'update', ref.path, current.raw));
  // An open signing link must never outlive the amount it was issued for.
  for (const l of revokeLinkIds) batch.update(doc(db, 'signLinks', l), { status: 'revoked' });
  const added = writeAttachments(batch, db, uid, accountId, e.id, newFiles);
  const kind = editKind(e);
  if (kind)
    addNotification(batch, db, audit.id, {
      kind,
      accountId,
      entryId: e.id,
      accountName: ctx.accountName,
      title: entryTitle(e),
      changes: describeChanges(
        e.type,
        { amount: e.amount, date: e.date, details: e.details, attachments: e.attachments.length },
        {
          amount: changes.amount,
          date: changes.date,
          details: changes.details,
          attachments: changes.keepAttachments.length + added.length,
        },
      ),
      actor: uid,
      actorName: ctx.actorName,
    });
  batch.update(ref, {
    amount: changes.amount,
    signed: changes.signed,
    date: changes.date,
    details: changes.details,
    attachments: [...changes.keepAttachments, ...added],
    ...(e.signature ? { signature: deleteField(), signLinkId: deleteField() } : {}),
    auditId: audit.id,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
  await batch.commit();
}

/** Moves an entry to the trash (soft delete, signed vouchers too) and notifies. */
export async function deleteEntry(
  db: Firestore,
  uid: string,
  accountId: string,
  current: EntrySnapshot,
  revokeLinkIds: string[],
  ctx: ChangeContext,
): Promise<void> {
  const ref = doc(entriesCol(db, accountId), current.entry.id);
  const audit = doc(collection(db, 'auditLog'));
  const batch = writeBatch(db);
  for (const l of revokeLinkIds) batch.update(doc(db, 'signLinks', l), { status: 'revoked' });
  batch.set(audit, auditRecord(uid, 'delete', ref.path, current.raw));
  addNotification(batch, db, audit.id, {
    kind: 'delete',
    accountId,
    entryId: current.entry.id,
    accountName: ctx.accountName,
    title: entryTitle(current.entry),
    changes: entrySummary(current.entry),
    actor: uid,
    actorName: ctx.actorName,
  });
  batch.update(ref, {
    deleted: true,
    deletedAt: serverTimestamp(),
    auditId: audit.id,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
  await batch.commit();
}

/** Brings an entry back from the trash exactly as it was (owner and managers). */
export async function restoreEntry(
  db: Firestore,
  uid: string,
  accountId: string,
  current: EntrySnapshot,
  ctx: ChangeContext,
): Promise<void> {
  const ref = doc(entriesCol(db, accountId), current.entry.id);
  const audit = doc(collection(db, 'auditLog'));
  const batch = writeBatch(db);
  batch.set(audit, auditRecord(uid, 'restore', ref.path, current.raw));
  addNotification(batch, db, audit.id, {
    kind: 'restore',
    accountId,
    entryId: current.entry.id,
    accountName: ctx.accountName,
    title: entryTitle(current.entry),
    changes: entrySummary(current.entry),
    actor: uid,
    actorName: ctx.actorName,
  });
  batch.update(ref, {
    deleted: false,
    deletedAt: deleteField(),
    auditId: audit.id,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
  await batch.commit();
}

export interface TrashItem {
  accountId: string;
  snap: EntrySnapshot;
  deletedAtMs: number;
  deletedBy: string;
}

/** Every entry in the trash, newest deletion first (managers only). */
export async function listTrash(db: Firestore): Promise<TrashItem[]> {
  const snap = await getDocs(query(collectionGroup(db, 'entries'), where('deleted', '==', true)));
  return snap.docs
    .map((d) => {
      const raw = d.data();
      return {
        accountId: d.ref.parent.parent?.id ?? '',
        snap: toEntry(d),
        deletedAtMs: millis(raw.deletedAt) || millis(raw.updatedAt),
        deletedBy: str(raw.updatedBy),
      };
    })
    .sort((a, b) => b.deletedAtMs - a.deletedAtMs);
}

export async function getAttachment(
  db: Firestore,
  accountId: string,
  attachmentId: string,
): Promise<StoredImage | null> {
  const s = await getDoc(doc(db, 'accounts', accountId, 'attachments', attachmentId));
  if (!s.exists()) return null;
  const d = s.data();
  const url = str(d.url);
  return {
    thumb: d.thumb instanceof Bytes ? d.thumb.toUint8Array() : null,
    data: d.data instanceof Bytes ? d.data.toUint8Array() : null,
    // Only Dropbox links written by the backup job are ever opened.
    url: /^https:\/\/(www\.)?dropbox\.com\//.test(url) ? url : null,
    mime: str(d.mime, 'image/jpeg'),
  };
}

/** What the app can show for an attachment: preview, and the original or its Dropbox link. */
export interface StoredImage {
  thumb: Uint8Array | null;
  data: Uint8Array | null;
  url: string | null;
  mime: string;
}
