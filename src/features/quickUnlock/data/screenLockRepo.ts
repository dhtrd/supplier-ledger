import {
  doc,
  getDocFromServer,
  increment,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { bool, millis, str } from '../../../shared/lib/firestore';
import { emailKey } from '../../auth/domain/lockout';
import { generateToken } from '../../../shared/lib/token';
import { NO_LOCK, type ScreenLock } from '../domain/presence';
import { pinProof, proofCheck } from '../domain/pin';

const lockRef = (db: Firestore, uid: string) => doc(db, 'screenLocks', uid);

function toLock(d: Record<string, unknown> | undefined): ScreenLock {
  if (!d) return NO_LOCK;
  return {
    locked: bool(d.locked),
    atMs: millis(d.at),
    activeAtMs: millis(d.activeAt),
    activeBy: str(d.activeBy),
    pinSet: bool(d.pinSet),
    pinVer: str(d.pinVer),
  };
}

/** Live lock state of the signed-in user (readable even while locked). */
export function watchScreenLock(
  db: Firestore,
  uid: string,
  next: (l: ScreenLock) => void,
  fail: (e: unknown) => void,
): () => void {
  // Only server-confirmed state: a local (optimistic) «unlocked» from a PIN
  // attempt the rules then reject must never show the app, even briefly.
  return onSnapshot(
    lockRef(db, uid),
    { includeMetadataChanges: true },
    (s) => {
      if (!s.metadata.hasPendingWrites) next(toLock(s.data()));
    },
    fail,
  );
}

/** Fresh read from the server (used right before deciding to lock). */
export async function readScreenLock(db: Firestore, uid: string): Promise<ScreenLock> {
  // A heartbeat still in flight would otherwise read back as «no time».
  return toLock((await getDocFromServer(lockRef(db, uid))).data({ serverTimestamps: 'estimate' }));
}

/** «Last active» heartbeat; only meaningful once a PIN exists. */
export async function heartbeat(db: Firestore, uid: string, deviceId: string): Promise<void> {
  await updateDoc(lockRef(db, uid), { activeAt: serverTimestamp(), activeBy: deviceId });
}

/**
 * Set or change the PIN. The rules accept it only within 5 minutes of a
 * password sign-in (the caller re-authenticates first when needed).
 */
export async function setPin(
  db: Firestore,
  uid: string,
  pin: string,
  deviceId: string,
  exists: boolean,
): Promise<{ proof: string; pinVer: string }> {
  const proof = await pinProof(uid, pin);
  const pinVer = generateToken(12);
  const b = writeBatch(db);
  b.set(doc(db, 'pins', uid), { check: await proofCheck(proof), updatedAt: serverTimestamp() });
  if (exists) b.update(lockRef(db, uid), { pinSet: true, pinAt: serverTimestamp(), pinVer });
  else
    b.set(lockRef(db, uid), {
      locked: false,
      at: serverTimestamp(),
      activeAt: serverTimestamp(),
      activeBy: deviceId,
      pinSet: true,
      pinAt: serverTimestamp(),
      pinVer,
    });
  await b.commit();
  return { proof, pinVer };
}

/** Turn quick unlock off: idle then signs out again. */
export async function removePin(db: Firestore, uid: string): Promise<void> {
  const b = writeBatch(db);
  b.delete(doc(db, 'pins', uid));
  b.update(lockRef(db, uid), { pinSet: false, pinAt: serverTimestamp(), pinVer: '' });
  await b.commit();
}

/** Lock the account: from now on the rules refuse all business data. */
export async function lockScreen(db: Firestore, uid: string): Promise<void> {
  await updateDoc(lockRef(db, uid), { locked: true, at: serverTimestamp() });
}

export type UnlockResult = 'ok' | 'wrong';

/**
 * Unlock with a proof (from the typed PIN or the fingerprint key).
 * 1. Commit the guess together with +1 on the 5-attempt counter.
 * 2. Reveal: unlock, delete the guess and reset the counter in one batch —
 *    the rules allow it only if the committed guess matches the PIN.
 * A refused step 1 means the account is locked out (5 failures) or not
 * locked; a refused step 2 means a wrong PIN (the failure stays counted).
 */
export async function unlockWithProof(
  db: Firestore,
  uid: string,
  email: string,
  proof: string,
  deviceId: string,
): Promise<UnlockResult> {
  const key = await emailKey(email);
  const commit = writeBatch(db);
  commit.set(doc(db, 'unlockAttempts', uid), { proof, at: serverTimestamp() });
  commit.set(
    doc(db, 'lockouts', key),
    { fails: increment(1), lastFailAt: serverTimestamp() },
    { merge: true },
  );
  await commit.commit(); // errors propagate: locked out / offline

  const reveal = writeBatch(db);
  reveal.update(lockRef(db, uid), {
    locked: false,
    at: serverTimestamp(),
    activeAt: serverTimestamp(),
    activeBy: deviceId,
  });
  reveal.delete(doc(db, 'unlockAttempts', uid));
  reveal.update(doc(db, 'lockouts', key), { fails: 0 });
  try {
    await reveal.commit();
    return 'ok';
  } catch (e) {
    if (isDenied(e)) return 'wrong';
    throw e;
  }
}

/** After signing in again with the password, the lock may be lifted. */
export async function unlockAfterLogin(
  db: Firestore,
  uid: string,
  deviceId: string,
): Promise<void> {
  await setDoc(
    lockRef(db, uid),
    { locked: false, at: serverTimestamp(), activeAt: serverTimestamp(), activeBy: deviceId },
    { merge: true },
  );
}

export function isDenied(e: unknown): boolean {
  return (
    !!e && typeof e === 'object' && 'code' in e && String(e.code).includes('permission-denied')
  );
}
