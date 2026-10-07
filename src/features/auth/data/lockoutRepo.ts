import {
  doc,
  getDoc,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import { int } from '../../../shared/lib/firestore';
import { emailKey } from '../domain/lockout';

/**
 * Adds one failure without reading first (the login page is unauthenticated
 * and may not read counters). The rules only allow +1, up to 5.
 */
export async function recordFailure(db: Firestore, email: string): Promise<void> {
  const key = await emailKey(email);
  await setDoc(
    doc(db, 'lockouts', key),
    { fails: increment(1), lastFailAt: serverTimestamp() },
    { merge: true },
  );
}

/** Failures recorded for an email (own email, or any email for the owner). */
export async function getFailures(db: Firestore, email: string): Promise<number> {
  const s = await getDoc(doc(db, 'lockouts', await emailKey(email)));
  return s.exists() ? int(s.data().fails) : 0;
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
