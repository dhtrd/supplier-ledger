import {
  Bytes,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentSnapshot,
  type Firestore,
  type Timestamp,
} from 'firebase/firestore';
import { bytes, int, millis, str } from '../../../shared/lib/firestore';
import { generateToken } from '../../../shared/lib/token';
import { amountInWords } from '../../../shared/lib/tafqit';
import type { Account } from '../../accounts/domain/types';
import type { Entry } from '../../ledger/domain/types';

export type LinkStatus = 'pending' | 'signed' | 'revoked';

export interface SignLink {
  id: string;
  accountId: string;
  entryId: string;
  accountName: string;
  accountPhone: string;
  logo: Uint8Array | null;
  payerName: string;
  amount: number;
  amountWords: string;
  date: string;
  details: string;
  voucherNo: number;
  /** Balance confirmation links: «م-N» and the balance they state (else null). */
  confirmNo: number | null;
  confirmBalance: number | null;
  ttlMinutes: number;
  status: LinkStatus;
  synced: boolean;
  createdAtMs: number;
  signerName: string;
  signatureImage: string;
  signedAtMs: number;
  /** Kept as-is so the copy onto the entry matches the rule's equality check. */
  signedAtRaw: Timestamp | null;
}

export function toLink(s: DocumentSnapshot): SignLink {
  const d = s.data() ?? {};
  // Local pending writes carry no server time yet: use the SDK's estimate.
  const est = s.data({ serverTimestamps: 'estimate' }) ?? {};
  const st = str(d.status);
  return {
    id: s.id,
    accountId: str(d.accountId),
    entryId: str(d.entryId),
    accountName: str(d.accountName),
    accountPhone: str(d.accountPhone),
    logo: bytes(d.logo),
    payerName: str(d.payerName),
    amount: int(d.amount),
    amountWords: str(d.amountWords),
    date: str(d.date),
    details: str(d.details),
    voucherNo: int(d.voucherNo),
    confirmNo: typeof d.confirmNo === 'number' ? d.confirmNo : null,
    confirmBalance: typeof d.confirmBalance === 'number' ? d.confirmBalance : null,
    ttlMinutes: int(d.ttlMinutes, 60),
    status: st === 'signed' || st === 'revoked' ? st : 'pending',
    synced: d.synced === true,
    createdAtMs: millis(est.createdAt),
    signerName: str(d.signerName),
    signatureImage: str(d.signatureImage),
    signedAtMs: millis(d.signedAt),
    signedAtRaw: (d.signedAt as Timestamp | undefined) ?? null,
  };
}

export function expiresAtMs(l: Pick<SignLink, 'createdAtMs' | 'ttlMinutes'>): number {
  return l.createdAtMs + l.ttlMinutes * 60_000;
}

/** Public URL of a signing page. The token lives in the #fragment (never sent to servers). */
export function linkUrl(token: string, base: string): string {
  return `${base}#/s/${token}`;
}

/**
 * Creates a fresh signing link for an unsigned payment or balance confirmation
 * and revokes any older pending links of that entry in the same batch.
 */
export async function createSignLink(
  db: Firestore,
  uid: string,
  args: {
    account: Account;
    entry: Entry;
    payerName: string;
    ttlMinutes: number;
    pendingForEntry: SignLink[];
  },
): Promise<string> {
  const { account, entry } = args;
  const token = generateToken();
  const batch = writeBatch(db);
  for (const old of args.pendingForEntry)
    batch.update(doc(db, 'signLinks', old.id), { status: 'revoked' });
  batch.set(doc(db, 'signLinks', token), {
    accountId: account.id,
    entryId: entry.id,
    accountName: account.name,
    accountPhone: account.phone,
    logo: account.logo ? Bytes.fromUint8Array(account.logo) : null,
    payerName: args.payerName,
    amount: entry.amount,
    date: entry.date,
    details: entry.details,
    ...(entry.type === 'confirm'
      ? {
          amountWords: amountInWords(Math.abs(entry.confirmBalance ?? 0)),
          confirmNo: entry.confirmNo,
          confirmBalance: entry.confirmBalance ?? 0,
        }
      : { amountWords: amountInWords(entry.amount), voucherNo: entry.voucherNo }),
    ttlMinutes: args.ttlMinutes,
    status: 'pending',
    synced: false,
    createdAt: serverTimestamp(),
    createdBy: uid,
  });
  await batch.commit();
  return token;
}

/** Pending + signed-but-not-yet-copied links of one account. */
export function watchOpenLinks(
  db: Firestore,
  accountId: string,
  next: (links: SignLink[]) => void,
  fail: (e: unknown) => void,
): () => void {
  const col = collection(db, 'signLinks');
  let pending: SignLink[] = [];
  let signed: SignLink[] = [];
  const emit = () => next([...pending, ...signed]);
  const u1 = onSnapshot(
    query(col, where('accountId', '==', accountId), where('status', '==', 'pending')),
    (s) => {
      pending = s.docs.map(toLink);
      emit();
    },
    fail,
  );
  const u2 = onSnapshot(
    query(
      col,
      where('accountId', '==', accountId),
      where('status', '==', 'signed'),
      where('synced', '==', false),
    ),
    (s) => {
      signed = s.docs.map(toLink);
      emit();
    },
    fail,
  );
  return () => {
    u1();
    u2();
  };
}

/**
 * Copies a recipient's signature onto the entry and marks the link synced. A
 * signed balance confirmation also raises the account's «confirmed through»
 * date in the same write (changes before it then notify the managers).
 */
export async function syncSignedLink(db: Firestore, uid: string, link: SignLink): Promise<void> {
  if (link.status !== 'signed' || !link.signedAtRaw) return;
  const entryRef = doc(db, 'accounts', link.accountId, 'entries', link.entryId);
  const signature = {
    signLinkId: link.id,
    signature: { name: link.signerName, image: link.signatureImage, signedAt: link.signedAtRaw },
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  };
  if (link.confirmNo === null) {
    const batch = writeBatch(db);
    batch.update(entryRef, signature);
    batch.update(doc(db, 'signLinks', link.id), { synced: true });
    await batch.commit();
    return;
  }
  const accountRef = doc(db, 'accounts', link.accountId);
  await runTransaction(db, async (tx) => {
    const a = await tx.get(accountRef);
    const through = str(a.data()?.confirmedThrough);
    tx.update(entryRef, signature);
    tx.update(doc(db, 'signLinks', link.id), { synced: true });
    tx.update(accountRef, {
      confirmedThrough: link.date > through ? link.date : through,
      confirmedEntry: link.entryId,
    });
  });
}

/** Ids of pending links issued for one entry (to revoke them when it changes). */
export async function pendingLinkIds(
  db: Firestore,
  accountId: string,
  entryId: string,
): Promise<string[]> {
  const snap = await getDocs(
    query(
      collection(db, 'signLinks'),
      where('accountId', '==', accountId),
      where('status', '==', 'pending'),
    ),
  );
  return snap.docs.filter((d) => d.get('entryId') === entryId).map((d) => d.id);
}

export async function revokeLink(db: Firestore, id: string): Promise<void> {
  await updateDoc(doc(db, 'signLinks', id), { status: 'revoked' });
}

/** Public (no login): reads a link only while it is pending and unexpired. */
export async function getPublicLink(db: Firestore, token: string): Promise<SignLink | null> {
  const s = await getDoc(doc(db, 'signLinks', token));
  return s.exists() ? toLink(s) : null;
}

export async function signLink(
  db: Firestore,
  token: string,
  signerName: string,
  signatureImage: string,
): Promise<void> {
  await updateDoc(doc(db, 'signLinks', token), {
    status: 'signed',
    signerName,
    signatureImage,
    signedAt: serverTimestamp(),
  });
}
