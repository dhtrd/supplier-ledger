/**
 * Quick unlock (option «ب»): the lock is enforced by the rules, the PIN is
 * checked server-side, and every guess costs one of the 5 attempts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { ACC_A, createEnv, seed } from './setup';
import { getAccounts } from '../../src/features/accounts/data/accountsRepo';
import {
  getFailures,
  recordFailure,
  unlockAccount,
} from '../../src/features/auth/data/lockoutRepo';
import { emailKey } from '../../src/features/auth/domain/lockout';
import {
  heartbeat,
  lockScreen,
  readScreenLock,
  removePin,
  setPin,
  unlockAfterLogin,
  unlockWithProof,
} from '../../src/features/quickUnlock/data/screenLockRepo';
import { pinProof } from '../../src/features/quickUnlock/domain/pin';

let env: RulesTestEnvironment;
const nowSec = () => Math.floor(Date.now() / 1000);
/** A signed-in user; `loginAgoSec` = seconds since the password sign-in. */
const as = (uid: string, loginAgoSec = 10) =>
  env
    .authenticatedContext(uid, { email: `${uid}@example.com`, auth_time: nowSec() - loginAgoSec })
    .firestore() as unknown as Firestore;
const DEV = 'device-aaaa-1111';
const PIN = '482915';

beforeAll(async () => {
  env = await createEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await seed(env);
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function lockedEntryUser(): Promise<Firestore> {
  const db = as('entry');
  await setPin(db, 'entry', PIN, DEV, false);
  await lockScreen(db, 'entry');
  return db;
}

describe('setting the PIN', () => {
  it('needs a password sign-in within the last 5 minutes; the PIN hash is unreadable', async () => {
    await assertFails(setPin(as('entry', 600), 'entry', PIN, DEV, false));
    await assertSucceeds(setPin(as('entry'), 'entry', PIN, DEV, false));
    await assertFails(getDoc(doc(as('entry'), 'pins/entry')));
    await assertFails(getDoc(doc(as('owner'), 'pins/entry')));
    const l = await readScreenLock(as('entry'), 'entry');
    expect(l.pinSet).toBe(true);
    expect(l.locked).toBe(false);
    // Changing it later also needs a recent sign-in.
    await assertFails(setPin(as('entry', 600), 'entry', '111111', DEV, true));
    await assertSucceeds(setPin(as('entry'), 'entry', '111111', DEV, true));
  });

  it('cannot lock without a PIN; the flag must match the PIN document', async () => {
    const db = as('entry');
    await setPin(db, 'entry', PIN, DEV, false);
    await removePin(db, 'entry');
    expect((await readScreenLock(db, 'entry')).pinSet).toBe(false);
    await assertFails(lockScreen(db, 'entry'));
    await assertFails(
      updateDoc(doc(db, 'screenLocks/entry'), { pinSet: true, pinAt: serverTimestamp() }),
    );
  });

  it("another user cannot read or touch someone's lock", async () => {
    await setPin(as('entry'), 'entry', PIN, DEV, false);
    await assertFails(getDoc(doc(as('owner'), 'screenLocks/entry')));
    await assertFails(lockScreen(as('owner'), 'entry'));
    await assertFails(heartbeat(as('owner'), 'entry', DEV));
  });
});

describe('while locked', () => {
  it('business data is refused; own profile, settings and lock state stay readable', async () => {
    const db = await lockedEntryUser();
    await assertFails(getAccounts(db, [ACC_A]));
    await assertFails(heartbeat(db, 'entry', DEV));
    await assertSucceeds(getDoc(doc(db, 'users/entry')));
    await assertSucceeds(getDoc(doc(db, 'settings/app')));
    expect((await readScreenLock(db, 'entry')).locked).toBe(true);
    // Simply flipping the flag back is refused.
    await assertFails(
      updateDoc(doc(db, 'screenLocks/entry'), {
        locked: false,
        at: serverTimestamp(),
        activeAt: serverTimestamp(),
        activeBy: DEV,
      }),
    );
    // So is resetting the counter with a fake unlock.
    const b = writeBatch(db);
    b.update(doc(db, 'screenLocks/entry'), {
      locked: false,
      at: serverTimestamp(),
      activeAt: serverTimestamp(),
      activeBy: DEV,
    });
    b.update(doc(db, 'lockouts', await emailKey('entry@example.com')), { fails: 0 });
    await assertFails(b.commit());
  });

  it('a wrong PIN costs an attempt; the right one unlocks and clears the counter', async () => {
    const db = await lockedEntryUser();
    const wrong = await pinProof('entry', '000000');
    expect(await unlockWithProof(db, 'entry', 'entry@example.com', wrong, DEV)).toBe('wrong');
    expect(await getFailures(db, 'entry@example.com')).toBe(1);
    expect((await readScreenLock(db, 'entry')).locked).toBe(true);
    const right = await pinProof('entry', PIN);
    expect(await unlockWithProof(db, 'entry', 'entry@example.com', right, DEV)).toBe('ok');
    expect(await getFailures(db, 'entry@example.com')).toBe(0);
    expect((await getAccounts(db, [ACC_A])).length).toBe(1);
    await assertFails(getDoc(doc(db, 'unlockAttempts/entry')));
  });

  it("another user's proof never unlocks (the uid is part of the proof)", async () => {
    const db = await lockedEntryUser();
    const fromAdmin = await pinProof('admin', PIN);
    expect(await unlockWithProof(db, 'entry', 'entry@example.com', fromAdmin, DEV)).toBe('wrong');
  });

  it('a correct 5th attempt still unlocks; 5 wrong ones lock the account for good', async () => {
    const db = await lockedEntryUser();
    const wrong = await pinProof('entry', '999999');
    for (let i = 0; i < 4; i++)
      expect(await unlockWithProof(db, 'entry', 'entry@example.com', wrong, DEV)).toBe('wrong');
    const right = await pinProof('entry', PIN);
    expect(await unlockWithProof(db, 'entry', 'entry@example.com', right, DEV)).toBe('ok');
    expect(await getFailures(db, 'entry@example.com')).toBe(0);

    await lockScreen(db, 'entry');
    for (let i = 0; i < 5; i++)
      expect(await unlockWithProof(db, 'entry', 'entry@example.com', wrong, DEV)).toBe('wrong');
    // The 6th guess cannot even be committed — not even the right PIN.
    await assertFails(unlockWithProof(db, 'entry', 'entry@example.com', right, DEV));
    // Nor can signing in again help while locked out.
    await assertFails(unlockAfterLogin(as('entry', 1), 'entry', DEV));
    // The owner re-enables the account; then a fresh sign-in lifts the lock.
    await unlockAccount(as('owner'), 'owner', 'entry@example.com');
    await wait(1100); // auth_time has 1-second resolution
    await assertSucceeds(unlockAfterLogin(as('entry', 0), 'entry', DEV));
    expect((await getAccounts(db, [ACC_A])).length).toBe(1);
  });

  it('password failures that reach 5 after a guess are not cleared by revealing it', async () => {
    const db = await lockedEntryUser();
    const key = await emailKey('entry@example.com');
    const right = await pinProof('entry', PIN);
    const commit = writeBatch(db);
    commit.set(doc(db, 'unlockAttempts/entry'), { proof: right, at: serverTimestamp() });
    commit.set(
      doc(db, 'lockouts', key),
      { fails: 1, lastFailAt: serverTimestamp() },
      { merge: true },
    );
    await commit.commit();
    const anon = env.unauthenticatedContext().firestore() as unknown as Firestore;
    for (let i = 0; i < 4; i++) await recordFailure(anon, 'entry@example.com');
    const reveal = writeBatch(db);
    reveal.update(doc(db, 'screenLocks/entry'), {
      locked: false,
      at: serverTimestamp(),
      activeAt: serverTimestamp(),
      activeBy: DEV,
    });
    reveal.delete(doc(db, 'unlockAttempts/entry'));
    reveal.update(doc(db, 'lockouts', key), { fails: 0 });
    await assertFails(reveal.commit());
    // With 5 failures nothing else gets in either.
    await assertFails(unlockWithProof(db, 'entry', 'entry@example.com', right, DEV));
  });

  it('a guess cannot be committed without counting a failed attempt', async () => {
    const db = await lockedEntryUser();
    const right = await pinProof('entry', PIN);
    await assertFails(
      setDoc(doc(db, 'unlockAttempts/entry'), { proof: right, at: serverTimestamp() }),
    );
  });

  it('a guess committed before an earlier unlock cannot be replayed later', async () => {
    const db = await lockedEntryUser();
    const right = await pinProof('entry', PIN);
    // Commit the right PIN but «crash» before revealing it.
    const commit = writeBatch(db);
    commit.set(doc(db, 'unlockAttempts/entry'), { proof: right, at: serverTimestamp() });
    commit.set(
      doc(db, 'lockouts', await emailKey('entry@example.com')),
      { fails: 1, lastFailAt: serverTimestamp() },
      { merge: true },
    );
    await commit.commit();
    // The user signs in with the password instead, then the device locks again.
    await wait(1100);
    await unlockAfterLogin(as('entry', 0), 'entry', DEV);
    await wait(1100);
    await lockScreen(db, 'entry');
    // Revealing the old committed guess is refused (it predates this lock).
    const reveal = writeBatch(db);
    reveal.update(doc(db, 'screenLocks/entry'), {
      locked: false,
      at: serverTimestamp(),
      activeAt: serverTimestamp(),
      activeBy: DEV,
    });
    reveal.delete(doc(db, 'unlockAttempts/entry'));
    reveal.update(doc(db, 'lockouts', await emailKey('entry@example.com')), { fails: 0 });
    await assertFails(reveal.commit());
  });

  it('signing in again with the password lifts the lock; an older session cannot', async () => {
    await lockedEntryUser();
    await assertFails(unlockAfterLogin(as('entry', 3600), 'entry', DEV));
    await wait(1100);
    await assertSucceeds(unlockAfterLogin(as('entry', 0), 'entry', DEV));
  });
});

describe('activity heartbeat', () => {
  it('only the owner of the lock writes it, with server time and a device id', async () => {
    const db = as('entry');
    await setPin(db, 'entry', PIN, DEV, false);
    await assertSucceeds(heartbeat(db, 'entry', 'device-bbbb-2222'));
    expect((await readScreenLock(db, 'entry')).activeBy).toBe('device-bbbb-2222');
    await assertFails(heartbeat(db, 'entry', 'x'));
    await assertFails(
      setDoc(
        doc(db, 'screenLocks/entry'),
        { activeAt: serverTimestamp(), activeBy: DEV, pinSet: false },
        { merge: true },
      ),
    );
  });
});
