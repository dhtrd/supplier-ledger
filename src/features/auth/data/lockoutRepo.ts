import {
  doc,
  getDoc,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import { int, millis } from '../../../shared/lib/firestore';
import { effectiveFails, emailKey, type FailureState } from '../domain/lockout';

/**
 * Adds one failure without reading first (the login page is unauthenticated
 * and may not read counters). The rules only allow +1, up to 5.
 */
export async function recordFailure(db: Firestore, email: string): Promise<void> {
  const ref = doc(db, 'lockouts', await emailKey(email));
  try {
    await setDoc(ref, { fails: increment(1), lastFailAt: serverTimestamp() }, { merge: true });
  } catch (e) {
    // After a lock has expired the count starts again at 1 (the rules refuse +1).
    if (!isDenied(e)) throw e;
    await setDoc(ref, { fails: 1, lastFailAt: serverTimestamp() }, { merge: true });
  }
}

export const isDenied = (e: unknown) =>
  !!e && typeof e === 'object' && 'code' in e && String(e.code).includes('permission-denied');

/** Failure counter of an email (own email, or any email for the owner). */
export async function getFailureState(db: Firestore, email: string): Promise<FailureState> {
  const s = await getDoc(doc(db, 'lockouts', await emailKey(email)));
  if (!s.exists()) return { fails: 0, lastFailAtMs: 0 };
  return { fails: int(s.data().fails), lastFailAtMs: millis(s.data().lastFailAt) };
}

/** Failures that still count (an expired lock counts as none). */
export async function getFailures(db: Firestore, email: string): Promise<number> {
  return effectiveFails(await getFailureState(db, email));
}

/** After a successful sign-in / unlock: clear the user's own counter. */
export async function clearOwnFailures(db: Firestore, email: string): Promise<void> {
  await updateDoc(doc(db, 'lockouts', await emailKey(email)), { fails: 0 });
}

/** Owner only: re-enable an account locked by failed attempts. */
export async function unlockAccount(db: Firestore, ownerUid: string, email: string): Promise<void> {
  await updateDoc(doc(db, 'lockouts', await emailKey(email)), {
    fails: 0,
    unlockedAt: serverTimestamp(),
    unlockedBy: ownerUid,
  });
}
