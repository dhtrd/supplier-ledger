/** Running totals on accounts (fewer reads) and moving accounts to the trash. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { ACC_A, ACC_B, createEnv, seed } from './setup';
import { createAccount, setAccountDeleted } from '../../src/features/accounts/data/accountsRepo';
import {
  createEntry,
  deleteEntry,
  getEntry,
  restoreEntry,
  updateEntry,
} from '../../src/features/ledger/data/entriesRepo';
import { toNotification } from '../../src/features/notifications/data/notificationsRepo';

let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore() as unknown as Firestore;
const CTX = { actorName: 'entry', accountName: 'حساب accA' };

beforeAll(async () => {
  env = await createEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await seed(env);
  // Initialise ACC_A totals as the backfill would: inv1 +100000, pay1 −50000.
  await env.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore() as unknown as Firestore, 'accounts', ACC_A), {
      balance: 50000,
      entryCount: 2,
      lastDate: '2026-09-02',
    });
  });
});

const totals = async () => {
  let d: Record<string, unknown> = {};
  await env.withSecurityRulesDisabled(async (ctx) => {
    d =
      (await getDoc(doc(ctx.firestore() as unknown as Firestore, 'accounts', ACC_A))).data() ?? {};
  });
  return { balance: d.balance, entryCount: d.entryCount, lastDate: d.lastDate };
};

describe('running totals move with every entry change', () => {
  it('create, edit, trash and restore keep balance/count/latest date exact', async () => {
    const staff = as('entry');
    const { id } = await createEntry(
      staff,
      'entry',
      ACC_A,
      { type: 'invoice', amount: 7000, signed: 7000, date: '2026-10-05', details: 'ف' },
      [],
    );
    expect(await totals()).toEqual({ balance: 57000, entryCount: 3, lastDate: '2026-10-05' });
    const { voucherNo } = await createEntry(
      staff,
      'entry',
      ACC_A,
      { type: 'payment', amount: 2000, signed: -2000, date: '2026-10-06', details: '' },
      [],
    );
    expect(voucherNo).toBe(101);
    expect(await totals()).toEqual({ balance: 55000, entryCount: 4, lastDate: '2026-10-06' });
    const inv = (await getEntry(staff, ACC_A, id))!;
    await updateEntry(
      staff,
      'entry',
      ACC_A,
      inv,
      { amount: 9000, signed: 9000, date: '2026-10-05', details: 'ف', keepAttachments: [] },
      [],
      [],
      CTX,
    );
    expect((await totals()).balance).toBe(57000);
    const inv2 = (await getEntry(staff, ACC_A, id))!;
    await deleteEntry(staff, 'entry', ACC_A, inv2, [], CTX);
    expect(await totals()).toEqual({ balance: 48000, entryCount: 3, lastDate: '2026-10-06' });
    const trashed = (await getEntry(as('admin'), ACC_A, id))!;
    await restoreEntry(as('admin'), 'admin', ACC_A, trashed, {
      actorName: 'admin',
      accountName: 'حساب accA',
    });
    expect(await totals()).toEqual({ balance: 57000, entryCount: 4, lastDate: '2026-10-06' });
  });

  it('refuses wrong totals, totals without an entry change, and an entry change without totals', async () => {
    const staff = as('entry');
    // Totals alone (no entry written).
    await assertFails(
      updateDoc(doc(staff, 'accounts', ACC_A), {
        balance: 1,
        totalsEntry: 'inv1',
        totalsAt: serverTimestamp(),
      }),
    );
    // A new entry whose totals are off by one riyal.
    const b = writeBatch(staff);
    const e = doc(collection(staff, `accounts/${ACC_A}/entries`));
    b.set(e, {
      type: 'invoice',
      amount: 500,
      signed: 500,
      date: '2026-10-01',
      details: '',
      attachments: [],
      deleted: false,
      createdAt: serverTimestamp(),
      createdBy: 'entry',
    });
    b.update(doc(staff, 'accounts', ACC_A), {
      balance: 50000 + 500 + 100,
      entryCount: 3,
      lastDate: '2026-10-01',
      totalsEntry: e.id,
      totalsAt: serverTimestamp(),
    });
    await assertFails(b.commit());
    // The same entry without moving the totals.
    const b2 = writeBatch(staff);
    b2.set(doc(collection(staff, `accounts/${ACC_A}/entries`)), {
      type: 'invoice',
      amount: 500,
      signed: 500,
      date: '2026-10-01',
      details: '',
      attachments: [],
      deleted: false,
      createdAt: serverTimestamp(),
      createdBy: 'entry',
    });
    await assertFails(b2.commit());
    // A manager's normal account edit cannot touch the totals.
    await assertFails(
      updateDoc(doc(as('owner'), 'accounts', ACC_A), {
        balance: 0,
        updatedAt: serverTimestamp(),
        updatedBy: 'owner',
      }),
    );
  });

  it('a new account starts at zero; an uninitialised account still accepts entries', async () => {
    const id = await createAccount(
      as('admin'),
      'admin',
      { name: 'جديد', phone: '', group: 'general' },
      null,
    );
    let d: Record<string, unknown> = {};
    await env.withSecurityRulesDisabled(async (ctx) => {
      d = (await getDoc(doc(ctx.firestore() as unknown as Firestore, 'accounts', id))).data() ?? {};
    });
    expect([d.balance, d.entryCount, d.lastDate]).toEqual([0, 0, '']);
    await assertSucceeds(
      createEntry(
        as('admin'),
        'admin',
        ACC_B,
        { type: 'note', amount: 0, signed: 0, date: '2026-10-01', details: 'ن' },
        [],
      ),
    );
  });
});

describe('accounts in the trash', () => {
  it('managers move an account to the trash and back; notified; entry users lose it meanwhile', async () => {
    const staff = as('entry');
    await assertFails(
      setAccountDeleted(staff, 'entry', { id: ACC_A, name: 'حساب accA' }, true, 'entry'),
    );
    await setAccountDeleted(as('admin'), 'admin', { id: ACC_A, name: 'حساب accA' }, true, 'admin');
    await assertFails(getEntry(staff, ACC_A, 'inv1'));
    const notes = (await getDocs(collection(as('owner'), 'notifications'))).docs.map(
      toNotification,
    );
    expect(notes.map((n) => n.kind)).toEqual(['accountDelete']);
    expect(notes[0]?.changes).toEqual(['الرصيد: 500 له', 'العمليات: 2']);
    await setAccountDeleted(as('owner'), 'owner', { id: ACC_A, name: 'حساب accA' }, false, 'owner');
    expect((await getEntry(staff, ACC_A, 'inv1'))?.entry.amount).toBe(100000);
  });

  it('refuses a silent delete (no audit or no notification)', async () => {
    const admin = as('admin');
    await assertFails(
      updateDoc(doc(admin, 'accounts', ACC_A), {
        deleted: true,
        deletedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: 'admin',
      }),
    );
  });
});
