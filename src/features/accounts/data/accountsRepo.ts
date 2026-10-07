import { cleanText } from '../../../shared/lib/text';
import {
  Bytes,
  addDoc,
  collection,
  count,
  deleteField,
  doc,
  getAggregateFromServer,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  sum,
  updateDoc,
  where,
  writeBatch,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase/firestore';
import { AppError } from '../../../core/errors';
import { bool, bytes, str } from '../../../shared/lib/firestore';
import { balanceSide, formatAmount, SIDE_LABEL } from '../../../shared/lib/money';
import { addNotification } from '../../notifications/data/notificationsRepo';
import { readTotals, ZERO_TOTALS } from '../domain/totals';
import { storedPhone, type Account, type AccountForm, type AccountGroup } from '../domain/types';

const GROUPS: AccountGroup[] = ['suppliers', 'customers', 'general'];

export function toAccount(s: DocumentSnapshot): Account {
  const d = s.data() ?? {};
  const g = str(d.group) as AccountGroup;
  return {
    id: s.id,
    name: str(d.name),
    phone: str(d.phone),
    group: GROUPS.includes(g) ? g : 'general',
    logo: bytes(d.logo),
    deleted: bool(d.deleted),
    archived: bool(d.archived),
    totals: readTotals(d),
  };
}

/** Managers only (rules: list is manager-only). Live accounts. */
export async function listAccounts(db: Firestore): Promise<Account[]> {
  return (await listAllAccounts(db)).filter((a) => !a.deleted);
}

/** Managers only: every account including those in the trash. */
export async function listAllAccounts(db: Firestore): Promise<Account[]> {
  const snap = await getDocs(collection(db, 'accounts'));
  return snap.docs.map(toAccount);
}

/**
 * Live list of every account (managers). With the device cache, reopening the
 * list re-reads only accounts that changed; their running totals replace the
 * per-account sums the list used to compute.
 */
export function watchAllAccounts(
  db: Firestore,
  next: (rows: Account[]) => void,
  fail: (e: unknown) => void,
): () => void {
  return onSnapshot(collection(db, 'accounts'), (s) => next(s.docs.map(toAccount)), fail);
}

/** Data-entry users read their assigned accounts one by one (they cannot list). */
export async function getAccounts(db: Firestore, ids: string[]): Promise<Account[]> {
  const snaps = await Promise.all(ids.map((id) => getDoc(doc(db, 'accounts', id))));
  return snaps
    .filter((s) => s.exists())
    .map(toAccount)
    .filter((a) => !a.deleted);
}

/** Archive (hide from the daily list) or bring back; audited. Owner and managers. */
export async function setArchived(
  db: Firestore,
  uid: string,
  account: Pick<Account, 'id' | 'archived'>,
  archived: boolean,
): Promise<void> {
  const ref = doc(db, 'accounts', account.id);
  const audit = doc(collection(db, 'auditLog'));
  const batch = writeBatch(db);
  batch.set(audit, {
    actor: uid,
    action: archived ? 'archive' : 'unarchive',
    path: ref.path,
    before: { archived: account.archived },
    at: serverTimestamp(),
  });
  batch.update(ref, {
    archived,
    archivedAt: archived ? serverTimestamp() : deleteField(),
    archivedBy: archived ? uid : deleteField(),
    auditId: audit.id,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
  await batch.commit();
}

/** Date (YYYY-MM-DD) of the latest live entry, or null for an empty account. */
export async function lastMovement(db: Firestore, id: string): Promise<string | null> {
  const q = query(
    collection(db, 'accounts', id, 'entries'),
    where('deleted', '==', false),
    orderBy('date', 'desc'),
    limit(1),
  );
  const snap = await getDocs(q);
  return snap.empty ? null : str(snap.docs[0]?.data().date) || null;
}

export function watchAccount(
  db: Firestore,
  id: string,
  next: (a: Account | null) => void,
  fail: (e: unknown) => void,
): () => void {
  return onSnapshot(doc(db, 'accounts', id), (s) => next(s.exists() ? toAccount(s) : null), fail);
}

export interface AccountTotals {
  balance: number;
  count: number;
}

/** Balance + number of live entries, computed server-side (~1 read per 1000 entries). */
export async function accountTotals(db: Firestore, id: string): Promise<AccountTotals> {
  const q = query(collection(db, 'accounts', id, 'entries'), where('deleted', '==', false));
  const agg = await getAggregateFromServer(q, { balance: sum('signed'), count: count() });
  const d = agg.data();
  return { balance: Math.round(d.balance ?? 0), count: d.count };
}

function payload(form: AccountForm, logo: Uint8Array | null) {
  return {
    name: cleanText(form.name),
    phone: storedPhone(form.phone),
    group: form.group,
    logo: logo ? Bytes.fromUint8Array(logo) : null,
  };
}

export async function createAccount(
  db: Firestore,
  uid: string,
  form: AccountForm,
  logo: Uint8Array | null,
): Promise<string> {
  const ref = await addDoc(collection(db, 'accounts'), {
    ...payload(form, logo),
    deleted: false,
    ...ZERO_TOTALS,
    createdAt: serverTimestamp(),
    createdBy: uid,
  });
  return ref.id;
}

export async function updateAccount(
  db: Firestore,
  uid: string,
  id: string,
  form: AccountForm,
  logo: Uint8Array | null,
): Promise<void> {
  await updateDoc(doc(db, 'accounts', id), {
    ...payload(form, logo),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

/**
 * Moves an account to the trash or brings it back (owner and managers):
 * audited with the account as the server has it, and notified. Its entries
 * are untouched and come back with it.
 */
export async function setAccountDeleted(
  db: Firestore,
  uid: string,
  account: Pick<Account, 'id' | 'name'>,
  deleted: boolean,
  actorName: string,
): Promise<void> {
  const ref = doc(db, 'accounts', account.id);
  const audit = doc(collection(db, 'auditLog'));
  await runTransaction(db, async (tx) => {
    const cur = await tx.get(ref);
    if (!cur.exists()) throw new AppError('الحساب غير موجود.');
    const before = cur.data();
    if (bool(before.deleted) === deleted)
      throw new AppError(deleted ? 'الحساب في السلة أصلاً.' : 'الحساب ليس في السلة.');
    const t = readTotals(before);
    tx.set(audit, {
      actor: uid,
      action: deleted ? 'delete' : 'restore',
      path: ref.path,
      before,
      at: serverTimestamp(),
    });
    addNotification(tx, db, audit.id, {
      kind: deleted ? 'accountDelete' : 'accountRestore',
      accountId: account.id,
      entryId: '',
      accountName: str(before.name),
      title: 'حساب',
      changes: t
        ? [
            `الرصيد: ${formatAmount(Math.abs(t.balance))} ${SIDE_LABEL[balanceSide(t.balance)]}`,
            `العمليات: ${t.entryCount}`,
          ]
        : [],
      actor: uid,
      actorName,
    });
    tx.update(ref, {
      deleted,
      deletedAt: deleted ? serverTimestamp() : deleteField(),
      auditId: audit.id,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    });
  });
}
