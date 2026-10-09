/** «إقرار مطابقة رصيد» — balance confirmations signed by the supplier/customer (2026-10-09). */
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
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { ACC_A, ACC_B, createEnv, seed } from './setup';
import { getAccounts } from '../../src/features/accounts/data/accountsRepo';
import {
  createEntry,
  deleteEntry,
  getEntry,
  restoreEntry,
  updateEntry,
} from '../../src/features/ledger/data/entriesRepo';
import {
  createSignLink,
  getPublicLink,
  signLink,
  syncSignedLink,
  toLink,
} from '../../src/features/signing/data/signLinksRepo';
import { toNotification } from '../../src/features/notifications/data/notificationsRepo';

let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore() as unknown as Firestore;
const anon = () => env.unauthenticatedContext().firestore() as unknown as Firestore;
const CTX = { actorName: 'entry', accountName: 'حساب accA' };
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const admin = async <T>(fn: (db: Firestore) => Promise<T>): Promise<T> => {
  let out: T;
  await env.withSecurityRulesDisabled(async (ctx) => {
    out = await fn(ctx.firestore() as unknown as Firestore);
  });
  return out!;
};
const account = () => admin(async (db) => (await getDoc(doc(db, 'accounts', ACC_A))).data()!);
const notes = async () =>
  (await getDocs(collection(as('owner'), 'notifications'))).docs.map(toNotification);

beforeAll(async () => {
  env = await createEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await seed(env);
  await admin(async (db) => {
    // ACC_A totals as the backfill leaves them: inv1 +100000 (09-01), pay1 −50000 (09-02).
    await updateDoc(doc(db, 'accounts', ACC_A), {
      balance: 50000,
      entryCount: 2,
      lastDate: '2026-09-02',
    });
  });
});

const confirmInput = (date: string, confirmBalance: number) => ({
  type: 'confirm' as const,
  amount: 0,
  signed: 0,
  date,
  details: 'مطابقة الربع الثالث',
  confirmBalance,
});

/** Creates a confirmation on ACC_A and has the supplier sign it. */
async function signedConfirmation(date = '2026-09-30', balance = 50000): Promise<string> {
  const staff = as('entry');
  const { id } = await createEntry(staff, 'entry', ACC_A, confirmInput(date, balance), []);
  const e = (await getEntry(staff, ACC_A, id))!;
  const [acc] = await getAccounts(staff, [ACC_A]);
  const token = await createSignLink(staff, 'entry', {
    account: acc!,
    entry: e.entry,
    payerName: 'شركة الضبيبي',
    ttlMinutes: 60,
    pendingForEntry: [],
  });
  await signLink(anon(), token, 'محمد بدر', PNG);
  await syncSignedLink(staff, 'entry', toLink(await getDoc(doc(staff, 'signLinks', token))));
  return id;
}

describe('creating a balance confirmation', () => {
  it('takes «م-1, م-2» from its own counter and does not move the balance', async () => {
    const staff = as('entry');
    const a = await createEntry(staff, 'entry', ACC_A, confirmInput('2026-09-30', 50000), []);
    const b = await createEntry(staff, 'entry', ACC_A, confirmInput('2026-10-01', 50000), []);
    expect([a.confirmNo, b.confirmNo, a.voucherNo]).toEqual([1, 2, null]);
    expect((await account()).balance).toBe(50000);
    // The payment voucher sequence is untouched.
    const p = await createEntry(
      staff,
      'entry',
      ACC_A,
      { type: 'payment', amount: 100, signed: -100, date: '2026-10-02', details: '' },
      [],
    );
    expect(p.voucherNo).toBe(101);
  });

  it('refuses a future date, an unassigned account, a moved balance or a skipped number', async () => {
    const staff = as('entry');
    await assertFails(createEntry(staff, 'entry', ACC_A, confirmInput('2099-01-01', 50000), []));
    await assertFails(createEntry(staff, 'entry', ACC_B, confirmInput('2026-09-30', 50000), []));
    const raw = (over: Record<string, unknown>) => {
      const b = writeBatch(staff);
      const e = doc(collection(staff, `accounts/${ACC_A}/entries`));
      b.set(e, {
        type: 'confirm',
        amount: 0,
        signed: 0,
        date: '2026-09-30',
        details: '',
        attachments: [],
        confirmNo: 1,
        confirmBalance: 50000,
        deleted: false,
        createdAt: serverTimestamp(),
        createdBy: 'entry',
        ...over,
      });
      b.set(doc(staff, 'counters', 'confirmations'), {
        next: 1,
        lastAccount: ACC_A,
        lastEntry: e.id,
      });
      b.update(doc(staff, 'accounts', ACC_A), {
        balance: 50000 + ((over.signed as number) ?? 0),
        entryCount: 3,
        lastDate: '2026-09-30',
        totalsEntry: e.id,
        totalsAt: serverTimestamp(),
      });
      return b.commit();
    };
    await assertFails(raw({ amount: 500, signed: 500 }));
    await assertFails(raw({ confirmNo: 5 }));
    await assertFails(raw({ voucherNo: 1 }));
    await assertFails(raw({ confirmBalance: 'x' }));
    await assertSucceeds(raw({}));
    // A normal entry cannot carry confirmation fields.
    await assertFails(
      setDoc(doc(staff, `accounts/${ACC_A}/entries/x1`), {
        type: 'invoice',
        amount: 1,
        signed: 1,
        date: '2026-10-01',
        details: '',
        attachments: [],
        confirmBalance: 1,
        deleted: false,
        createdAt: serverTimestamp(),
        createdBy: 'entry',
      }),
    );
  });
});

describe('the confirmation counter', () => {
  it('starts at 1 only together with the first confirmation', async () => {
    const staff = as('entry');
    await assertFails(
      setDoc(doc(staff, 'counters', 'confirmations'), {
        next: 1,
        lastAccount: ACC_A,
        lastEntry: 'nothing',
      }),
    );
    await assertFails(
      setDoc(doc(staff, 'counters', 'vouchers'), { next: 1, lastAccount: ACC_A, lastEntry: 'x' }),
    );
    await assertFails(setDoc(doc(staff, 'counters', 'other'), { next: 1 }));
  });
});

describe('signing a confirmation', () => {
  it('public sign → synced onto the entry and raises the confirmed date', async () => {
    const id = await signedConfirmation();
    const e = (await getEntry(as('entry'), ACC_A, id))!;
    expect(e.entry.signature?.name).toBe('محمد بدر');
    expect((await account()).confirmedThrough).toBe('2026-09-30');
    // An older confirmation does not lower it.
    await signedConfirmation('2026-09-10', 50000);
    expect((await account()).confirmedThrough).toBe('2026-09-30');
  });

  it('the link carries the stated balance only, and must match the entry', async () => {
    const staff = as('entry');
    const { id } = await createEntry(staff, 'entry', ACC_A, confirmInput('2026-09-30', 50000), []);
    const e = (await getEntry(staff, ACC_A, id))!;
    const [acc] = await getAccounts(staff, [ACC_A]);
    const args = { account: acc!, payerName: 'شركة الضبيبي', ttlMinutes: 60, pendingForEntry: [] };
    await assertFails(
      createSignLink(staff, 'entry', { ...args, entry: { ...e.entry, confirmBalance: 1 } }),
    );
    const token = await createSignLink(staff, 'entry', { ...args, entry: e.entry });
    const pub = (await getPublicLink(anon(), token))!;
    expect([pub.confirmNo, pub.confirmBalance, pub.amount]).toEqual([1, 50000, 0]);
    expect(pub.amountWords).toBe('خمسمائة ريال سعودي لا غير');
    // The public page cannot read the statement.
    await assertFails(getEntry(anon(), ACC_A, 'inv1'));
  });

  it('the signature cannot be copied without raising the confirmed date', async () => {
    const staff = as('entry');
    const { id } = await createEntry(staff, 'entry', ACC_A, confirmInput('2026-09-30', 50000), []);
    const e = (await getEntry(staff, ACC_A, id))!;
    const [acc] = await getAccounts(staff, [ACC_A]);
    const token = await createSignLink(staff, 'entry', {
      account: acc!,
      entry: e.entry,
      payerName: 'شركة الضبيبي',
      ttlMinutes: 60,
      pendingForEntry: [],
    });
    await signLink(anon(), token, 'محمد بدر', PNG);
    const l = toLink(await getDoc(doc(staff, 'signLinks', token)));
    const b = writeBatch(staff);
    b.update(doc(staff, `accounts/${ACC_A}/entries/${id}`), {
      signLinkId: token,
      signature: { name: l.signerName, image: l.signatureImage, signedAt: l.signedAtRaw },
      updatedAt: serverTimestamp(),
      updatedBy: 'entry',
    });
    b.update(doc(staff, 'signLinks', token), { synced: true });
    await assertFails(b.commit());
    await assertSucceeds(syncSignedLink(staff, 'entry', l));
  });

  it('nobody sets the confirmed date by hand', async () => {
    for (const uid of ['entry', 'owner'])
      await assertFails(
        updateDoc(doc(as(uid), 'accounts', ACC_A), {
          confirmedThrough: '2026-12-31',
          confirmedEntry: 'inv1',
        }),
      );
    await assertFails(
      updateDoc(doc(as('owner'), 'accounts', ACC_A), {
        confirmedThrough: '2026-12-31',
        updatedAt: serverTimestamp(),
        updatedBy: 'owner',
      }),
    );
  });
});

describe('changes before a signed confirmation notify the managers', () => {
  it('a new entry dated before it: audited + confirmBreak; after it: nothing', async () => {
    await signedConfirmation();
    const staff = as('entry');
    await createEntry(
      staff,
      'entry',
      ACC_A,
      { type: 'invoice', amount: 700, signed: 700, date: '2026-10-05', details: '' },
      [],
      CTX,
    );
    expect(await notes()).toEqual([]);
    const { id } = await createEntry(
      staff,
      'entry',
      ACC_A,
      { type: 'invoice', amount: 900, signed: 900, date: '2026-09-15', details: '' },
      [],
      CTX,
    );
    const [n] = await notes();
    expect([n?.kind, n?.confirmDate, n?.entryId]).toEqual(['confirmBreak', '2026-09-30', id]);
    // A note there needs nothing (it does not move the balance).
    await createEntry(
      staff,
      'entry',
      ACC_A,
      { type: 'note', amount: 0, signed: 0, date: '2026-09-15', details: 'ن' },
      [],
      CTX,
    );
    expect(await notes()).toHaveLength(1);
  });

  it('refuses the same entry written silently', async () => {
    await signedConfirmation();
    const staff = as('entry');
    const b = writeBatch(staff);
    const e = doc(collection(staff, `accounts/${ACC_A}/entries`));
    b.set(e, {
      type: 'invoice',
      amount: 900,
      signed: 900,
      date: '2026-09-15',
      details: '',
      attachments: [],
      deleted: false,
      createdAt: serverTimestamp(),
      createdBy: 'entry',
    });
    b.update(doc(staff, 'accounts', ACC_A), {
      balance: 50900,
      entryCount: 4,
      lastDate: '2026-09-30',
      totalsEntry: e.id,
      totalsAt: serverTimestamp(),
    });
    await assertFails(b.commit());
  });

  it('edit, trash and restore before it carry the confirmed date', async () => {
    await signedConfirmation();
    const staff = as('entry');
    // Unsigned payment edit: normally silent, now confirmBreak.
    const pay = (await getEntry(staff, ACC_A, 'pay1'))!;
    await updateEntry(
      staff,
      'entry',
      ACC_A,
      pay,
      { amount: 60000, signed: -60000, date: '2026-09-02', details: 'دفعة', keepAttachments: [] },
      [],
      [],
      CTX,
    );
    // Details only: the balance does not move, so no notification.
    const pay2 = (await getEntry(staff, ACC_A, 'pay1'))!;
    await updateEntry(
      staff,
      'entry',
      ACC_A,
      pay2,
      { amount: 60000, signed: -60000, date: '2026-09-02', details: 'نص', keepAttachments: [] },
      [],
      [],
      CTX,
    );
    const inv = (await getEntry(staff, ACC_A, 'inv1'))!;
    await deleteEntry(staff, 'entry', ACC_A, inv, [], CTX);
    const trashed = (await getEntry(as('admin'), ACC_A, 'inv1'))!;
    await restoreEntry(as('admin'), 'admin', ACC_A, trashed, { ...CTX, actorName: 'admin' });
    const kinds = (await notes()).map((n) => `${n.kind}:${n.confirmDate}`).sort();
    expect(kinds).toEqual(['confirmBreak:2026-09-30', 'delete:2026-09-30', 'restore:2026-09-30']);
  });

  it('refuses an edit before it that skips the confirmed date', async () => {
    await signedConfirmation();
    const staff = as('entry');
    const b = writeBatch(staff);
    const audit = doc(collection(staff, 'auditLog'));
    const before = (await getDoc(doc(staff, `accounts/${ACC_A}/entries/pay1`))).data()!;
    b.set(audit, {
      actor: 'entry',
      action: 'update',
      path: `accounts/${ACC_A}/entries/pay1`,
      before,
      at: serverTimestamp(),
    });
    b.update(doc(staff, `accounts/${ACC_A}/entries/pay1`), {
      amount: 1000,
      signed: -1000,
      auditId: audit.id,
      updatedAt: serverTimestamp(),
      updatedBy: 'entry',
    });
    b.update(doc(staff, 'accounts', ACC_A), {
      balance: 99000,
      entryCount: 3,
      lastDate: '2026-09-30',
      totalsEntry: 'pay1',
      totalsAt: serverTimestamp(),
    });
    await assertFails(b.commit());
  });

  it('editing the signed confirmation removes its signature (signedEdit)', async () => {
    const id = await signedConfirmation();
    const staff = as('entry');
    const e = (await getEntry(staff, ACC_A, id))!;
    await updateEntry(
      staff,
      'entry',
      ACC_A,
      e,
      {
        amount: 0,
        signed: 0,
        date: '2026-09-01',
        details: '',
        keepAttachments: [],
        confirmBalance: 100000,
      },
      [],
      [],
      CTX,
    );
    const after = (await getEntry(staff, ACC_A, id))!;
    expect([after.entry.signature, after.entry.confirmBalance]).toEqual([null, 100000]);
    expect((await notes()).map((n) => n.kind)).toEqual(['signedEdit']);
  });
});
