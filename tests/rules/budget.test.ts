/**
 * Rules budget with real-life account state (2026-10-10). In production every
 * user who ever failed a sign-in has a lockouts doc, and every user with quick
 * unlock has a screenLocks doc; each makes the role checks cost more, and one
 * batch shares a budget of 1000 evaluated expressions. An owner invoice edit
 * went over it and was refused. These flows run with that state for each role.
 */
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, Timestamp, updateDoc, type Firestore } from 'firebase/firestore';
import { ACC_A, createEnv, seed } from './setup';
import { emailKey } from '../../src/features/auth/domain/lockout';
import { getAccounts, setArchived } from '../../src/features/accounts/data/accountsRepo';
import {
  createEntry,
  deleteEntry,
  getEntry,
  restoreEntry,
  updateEntry,
} from '../../src/features/ledger/data/entriesRepo';
import {
  createSignLink,
  signLink,
  syncSignedLink,
  toLink,
} from '../../src/features/signing/data/signLinksRepo';

let env: RulesTestEnvironment;
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const as = (uid: string) =>
  env
    .authenticatedContext(uid, { email: `${uid}@example.com` })
    .firestore() as unknown as Firestore;
const anon = () => env.unauthenticatedContext().firestore() as unknown as Firestore;
const ctx = (uid: string) => ({ actorName: uid, accountName: 'حساب accA' });

beforeAll(async () => {
  env = await createEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await seed(env);
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore() as unknown as Firestore;
    await updateDoc(doc(db, 'accounts', ACC_A), {
      balance: 50000,
      entryCount: 2,
      lastDate: '2026-09-02',
    });
    for (const uid of ['owner', 'admin', 'entry']) {
      await setDoc(doc(db, 'lockouts', await emailKey(`${uid}@example.com`)), {
        fails: 0,
        lastFailAt: Timestamp.now(),
      });
      await setDoc(doc(db, 'screenLocks', uid), {
        locked: false,
        at: Timestamp.now(),
        activeAt: Timestamp.now(),
        activeBy: 'device-12345',
        pinSet: true,
        pinAt: Timestamp.now(),
        pinVer: 'x'.repeat(16),
      });
    }
  });
});

/** A payment signed by the supplier (via the app's own functions). */
async function signedPayment(uid: string): Promise<void> {
  const db = as(uid);
  const pay = (await getEntry(db, ACC_A, 'pay1'))!;
  const [acc] = await getAccounts(db, [ACC_A]);
  const token = await createSignLink(db, uid, {
    account: acc!,
    entry: pay.entry,
    payerName: 'شركة الضبيبي',
    ttlMinutes: 60,
    pendingForEntry: [],
  });
  await signLink(anon(), token, 'عبد المجيد', PNG);
  await syncSignedLink(db, uid, toLink(await getDoc(doc(db, 'signLinks', token))));
}

for (const uid of ['owner', 'entry']) {
  describe(`heavy writes stay within budget (${uid})`, () => {
    it('invoice edit, signed voucher edit, trash, new payment', async () => {
      const db = as(uid);
      const inv = (await getEntry(db, ACC_A, 'inv1'))!;
      await assertSucceeds(
        updateEntry(
          db,
          uid,
          ACC_A,
          inv,
          { amount: 120000, signed: 120000, date: '2026-09-01', details: 'x', keepAttachments: [] },
          [],
          [],
          ctx(uid),
        ),
      );
      await signedPayment(uid);
      const pay = (await getEntry(db, ACC_A, 'pay1'))!;
      await assertSucceeds(
        updateEntry(
          db,
          uid,
          ACC_A,
          pay,
          { amount: 60000, signed: -60000, date: '2026-09-02', details: 'y', keepAttachments: [] },
          [],
          [],
          ctx(uid),
        ),
      );
      await assertSucceeds(
        createEntry(
          db,
          uid,
          ACC_A,
          { type: 'payment', amount: 100, signed: -100, date: '2026-10-01', details: '' },
          [],
          ctx(uid),
        ),
      );
      const inv2 = (await getEntry(db, ACC_A, 'inv1'))!;
      await assertSucceeds(deleteEntry(db, uid, ACC_A, inv2, [], ctx(uid)));
    });

    it('signed confirmation, then changes before its date (notified)', async () => {
      const db = as(uid);
      const { id } = await createEntry(
        db,
        uid,
        ACC_A,
        {
          type: 'confirm',
          amount: 0,
          signed: 0,
          date: '2026-09-30',
          details: '',
          confirmBalance: 50000,
        },
        [],
      );
      const e = (await getEntry(db, ACC_A, id))!;
      const [acc] = await getAccounts(db, [ACC_A]);
      const token = await createSignLink(db, uid, {
        account: acc!,
        entry: e.entry,
        payerName: 'شركة الضبيبي',
        ttlMinutes: 60,
        pendingForEntry: [],
      });
      await signLink(anon(), token, 'محمد', PNG);
      await assertSucceeds(
        syncSignedLink(db, uid, toLink(await getDoc(doc(db, 'signLinks', token)))),
      );
      await assertSucceeds(
        createEntry(
          db,
          uid,
          ACC_A,
          { type: 'invoice', amount: 900, signed: 900, date: '2026-09-15', details: '' },
          [],
          ctx(uid),
        ),
      );
      const inv = (await getEntry(db, ACC_A, 'inv1'))!;
      await assertSucceeds(
        updateEntry(
          db,
          uid,
          ACC_A,
          inv,
          { amount: 110000, signed: 110000, date: '2026-09-01', details: '', keepAttachments: [] },
          [],
          [],
          ctx(uid),
        ),
      );
      const inv2 = (await getEntry(db, ACC_A, 'inv1'))!;
      await assertSucceeds(deleteEntry(db, uid, ACC_A, inv2, [], ctx(uid)));
    });
  });
}

describe('manager-only heavy writes stay within budget', () => {
  it('restore from the trash and archive', async () => {
    const admin = as('admin');
    const inv = (await getEntry(admin, ACC_A, 'inv1'))!;
    await deleteEntry(admin, 'admin', ACC_A, inv, [], ctx('admin'));
    const trashed = (await getEntry(admin, ACC_A, 'inv1'))!;
    await assertSucceeds(restoreEntry(as('owner'), 'owner', ACC_A, trashed, ctx('owner')));
    const [acc] = await getAccounts(as('owner'), [ACC_A]);
    await assertSucceeds(setArchived(as('owner'), 'owner', acc!, true));
  });
});
