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
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
  type WriteBatch,
} from 'firebase/firestore';
import { AppError } from '../../../core/errors';
import {
  nextTotals,
  readTotals,
  type EntryState,
  type RunningTotals,
} from '../../accounts/domain/totals';
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
  const counter = doc(db, 'counters', 'vouchers');
  const voucherNo = await runTransaction(db, async (tx) => {
    // Reads first (transaction rule), then writes.
    const totals = await readAccountTotals(tx, db, accountId);
    let next: number | null = null;
    if (input.type === 'payment') {
      const c = await tx.get(counter);
      if (!c.exists()) throw new AppError('عدّاد السندات غير مهيأ. شغّل سكربت إنشاء المالك أولاً.');
      next = int(c.data().next) + 1;
      // The rules let the counter move only with the entry that takes the number.
      tx.update(counter, { next, lastAccount: accountId, lastEntry: ref.id });
    }
    const attachments = writeAttachments(tx, db, uid, accountId, ref.id, files);
    tx.set(ref, { ...base, attachments, ...(next !== null ? { voucherNo: next } : {}) });
    moveTotals(tx, db, accountId, ref.id, totals, null, {
      deleted: false,
      signed: input.signed,
      date: input.date,
    });
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

const STALE =
  'تغيّرت هذه العملية منذ فتحتها (ربما عدّلها أو حذفها مستخدم آخر). ارجع للكشف وافتحها من جديد.';

const accountDoc = (db: Firestore, accountId: string) => doc(db, 'accounts', accountId);

function stateOf(raw: Record<string, unknown>): EntryState {
  return { deleted: raw.deleted === true, signed: int(raw.signed), date: str(raw.date) };
}

/** The account's running totals inside a transaction (null = not initialised). */
async function readAccountTotals(
  tx: Transaction,
  db: Firestore,
  accountId: string,
): Promise<RunningTotals | null> {
  const a = await tx.get(accountDoc(db, accountId));
  return a.exists() ? readTotals(a.data()) : null;
}

/**
 * Reads the account totals and the entry as the server has it now. Refuses if
 * someone changed the entry since it was opened (instead of overwriting their
 * change); the server copy is what goes into the audit log.
 */
async function readForChange(
  tx: Transaction,
  db: Firestore,
  accountId: string,
  current: EntrySnapshot,
): Promise<{ before: Record<string, unknown>; totals: RunningTotals | null }> {
  const totals = await readAccountTotals(tx, db, accountId);
  const s = await tx.get(doc(entriesCol(db, accountId), current.entry.id));
  if (!s.exists()) throw new AppError(STALE);
  const before = s.data();
  const same = (k: string) =>
    JSON.stringify(before[k] ?? null) === JSON.stringify(current.raw[k] ?? null);
  if (!['auditId', 'deleted', 'signLinkId', 'amount', 'date'].every(same))
    throw new AppError(STALE);
  return { before, totals };
}

/** Moves the account totals by one entry change (same transaction; rules check it). */
function moveTotals(
  tx: Transaction,
  db: Firestore,
  accountId: string,
  entryId: string,
  totals: RunningTotals | null,
  before: EntryState | null,
  after: EntryState,
): void {
  if (!totals) return; // account not initialised yet (backfill pending)
  tx.update(accountDoc(db, accountId), {
    ...nextTotals(totals, before, after),
    totalsEntry: entryId,
    totalsAt: serverTimestamp(),
  });
}

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
  await runTransaction(db, async (tx) => {
    const { before, totals } = await readForChange(tx, db, accountId, current);
    tx.set(audit, auditRecord(uid, 'update', ref.path, before));
    // An open signing link must never outlive the amount it was issued for.
    for (const l of revokeLinkIds) tx.update(doc(db, 'signLinks', l), { status: 'revoked' });
    const added = writeAttachments(tx, db, uid, accountId, e.id, newFiles);
    const kind = editKind(e);
    if (kind)
      addNotification(tx, db, audit.id, {
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
    tx.update(ref, {
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
    moveTotals(tx, db, accountId, e.id, totals, stateOf(before), {
      deleted: false,
      signed: changes.signed,
      date: changes.date,
    });
  });
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
  await runTransaction(db, async (tx) => {
    const { before, totals } = await readForChange(tx, db, accountId, current);
    for (const l of revokeLinkIds) tx.update(doc(db, 'signLinks', l), { status: 'revoked' });
    tx.set(audit, auditRecord(uid, 'delete', ref.path, before));
    addNotification(tx, db, audit.id, {
      kind: 'delete',
      accountId,
      entryId: current.entry.id,
      accountName: ctx.accountName,
      title: entryTitle(current.entry),
      changes: entrySummary(current.entry),
      actor: uid,
      actorName: ctx.actorName,
    });
    tx.update(ref, {
      deleted: true,
      deletedAt: serverTimestamp(),
      auditId: audit.id,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    });
    const was = stateOf(before);
    moveTotals(tx, db, accountId, current.entry.id, totals, was, { ...was, deleted: true });
  });
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
  await runTransaction(db, async (tx) => {
    const { before, totals } = await readForChange(tx, db, accountId, current);
    tx.set(audit, auditRecord(uid, 'restore', ref.path, before));
    addNotification(tx, db, audit.id, {
      kind: 'restore',
      accountId,
      entryId: current.entry.id,
      accountName: ctx.accountName,
      title: entryTitle(current.entry),
      changes: entrySummary(current.entry),
      actor: uid,
      actorName: ctx.actorName,
    });
    tx.update(ref, {
      deleted: false,
      deletedAt: deleteField(),
      auditId: audit.id,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    });
    const was = stateOf(before);
    moveTotals(tx, db, accountId, current.entry.id, totals, was, { ...was, deleted: false });
  });
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
