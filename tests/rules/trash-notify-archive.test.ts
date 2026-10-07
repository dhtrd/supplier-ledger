/**
 * Owner decisions 2026-10-07: editing a signed voucher voids its signature,
 * managers are notified (signed vouchers, invoices, trash, restore), deletes go
 * to a restorable trash, accounts can be archived.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
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
import { getAccounts, setArchived } from '../../src/features/accounts/data/accountsRepo';
import {
  deleteEntry,
  getEntry,
  listTrash,
  restoreEntry,
  updateEntry,
  type EntrySnapshot,
} from '../../src/features/ledger/data/entriesRepo';
import {
  createSignLink,
  signLink,
  syncSignedLink,
  toLink,
} from '../../src/features/signing/data/signLinksRepo';
import { markRead, toNotification } from '../../src/features/notifications/data/notificationsRepo';

let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore() as unknown as Firestore;
const anon = () => env.unauthenticatedContext().firestore() as unknown as Firestore;
const CTX = { actorName: 'entry', accountName: 'حساب accA' };
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  env = await createEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await seed(env);
});

/** Signs pay1 of ACC_A through the real public link flow; returns the link id. */
async function signPay1(): Promise<string> {
  const staff = as('entry');
  const pay = (await getEntry(staff, ACC_A, 'pay1'))!;
  const [account] = await getAccounts(staff, [ACC_A]);
  const token = await createSignLink(staff, 'entry', {
    account: account!,
    entry: pay.entry,
    payerName: 'x',
    ttlMinutes: 60,
    pendingForEntry: [],
  });
  await signLink(anon(), token, 'عبد المجيد', PNG);
  await syncSignedLink(staff, 'entry', toLink(await getDoc(doc(staff, 'signLinks', token))));
  return token;
}

const notifications = async (db: Firestore) =>
  (await getDocs(collection(db, 'notifications'))).docs.map(toNotification);

const changes = (cur: EntrySnapshot, p: Partial<{ amount: number; details: string }> = {}) => ({
  amount: p.amount ?? cur.entry.amount,
  signed: -(p.amount ?? cur.entry.amount),
  date: cur.entry.date,
  details: p.details ?? cur.entry.details,
  keepAttachments: cur.entry.attachments,
});

describe('editing a signed voucher', () => {
  it('removes the signature, notifies the managers, and the old link cannot bring it back', async () => {
    const token = await signPay1();
    const staff = as('entry');
    const signed = (await getEntry(staff, ACC_A, 'pay1'))!;
    expect(signed.entry.signature?.name).toBe('عبد المجيد');
    await wait(1100); // createdAt/updatedAt comparisons have 1 s resolution in the emulator clock
    await updateEntry(
      staff,
      'entry',
      ACC_A,
      signed,
      changes(signed, { details: 'دفعة معدّلة' }),
      [],
      [],
      CTX,
    );
    const after = (await getEntry(staff, ACC_A, 'pay1'))!;
    expect(after.entry.signature).toBeNull();
    expect(after.raw.signLinkId).toBeUndefined();
    const [n] = await notifications(as('admin'));
    expect(n?.kind).toBe('signedEdit');
    expect(n?.changes).toEqual(['التفاصيل: «دفعة» ← «دفعة معدّلة»']);
    expect(n?.actorName).toBe('entry');
    // Only the details changed: the old link still matches amount and voucher,
    // so only «issued after the last change» keeps it from re-attaching.
    await assertFails(
      syncSignedLink(staff, 'entry', toLink(await getDoc(doc(staff, 'signLinks', token)))),
    );
  });

  it('refuses to keep the signature, or to skip the notification', async () => {
    await signPay1();
    const staff = as('entry');
    const signed = (await getEntry(staff, ACC_A, 'pay1'))!;
    const ref = doc(staff, `accounts/${ACC_A}/entries/pay1`);
    // Audited, but signature kept.
    const b1 = writeBatch(staff);
    const a1 = doc(collection(staff, 'auditLog'));
    b1.set(a1, {
      actor: 'entry',
      action: 'update',
      path: ref.path,
      before: signed.raw,
      at: serverTimestamp(),
    });
    b1.update(ref, {
      details: 'x',
      auditId: a1.id,
      updatedAt: serverTimestamp(),
      updatedBy: 'entry',
    });
    await assertFails(b1.commit());
    // Signature removed, audited, but no notification.
    const { deleteField } = await import('firebase/firestore');
    const b2 = writeBatch(staff);
    const a2 = doc(collection(staff, 'auditLog'));
    b2.set(a2, {
      actor: 'entry',
      action: 'update',
      path: ref.path,
      before: signed.raw,
      at: serverTimestamp(),
    });
    b2.update(ref, {
      details: 'x',
      signature: deleteField(),
      signLinkId: deleteField(),
      auditId: a2.id,
      updatedAt: serverTimestamp(),
      updatedBy: 'entry',
    });
    await assertFails(b2.commit());
  });

  it('an entry user cannot edit a signed voucher of an account not assigned to him', async () => {
    const admin = as('admin');
    const pay = (await getEntry(admin, ACC_B, 'pay1'))!;
    await assertFails(
      updateEntry(as('entry'), 'entry', ACC_B, pay, changes(pay, { amount: 1 }), [], [], CTX),
    );
  });
});

describe('invoice edits notify; unsigned payments do not', () => {
  it('invoice edit without its notification is refused', async () => {
    const staff = as('entry');
    const inv = (await getEntry(staff, ACC_A, 'inv1'))!;
    const ref = doc(staff, `accounts/${ACC_A}/entries/inv1`);
    const b = writeBatch(staff);
    const a = doc(collection(staff, 'auditLog'));
    b.set(a, {
      actor: 'entry',
      action: 'update',
      path: ref.path,
      before: inv.raw,
      at: serverTimestamp(),
    });
    b.update(ref, {
      details: 'x',
      auditId: a.id,
      updatedAt: serverTimestamp(),
      updatedBy: 'entry',
    });
    await assertFails(b.commit());
    await updateEntry(
      staff,
      'entry',
      ACC_A,
      inv,
      { ...changes(inv), signed: inv.entry.amount, details: 'x' },
      [],
      [],
      CTX,
    );
    expect((await notifications(as('owner')))[0]?.kind).toBe('invoiceEdit');
  });

  it('saving without a real change is stopped in the app', async () => {
    const staff = as('entry');
    const pay = (await getEntry(staff, ACC_A, 'pay1'))!;
    await expect(
      updateEntry(staff, 'entry', ACC_A, pay, changes(pay), [], [], CTX),
    ).rejects.toThrow('لا تغييرات');
  });
});

describe('trash', () => {
  it('a signed voucher goes to the trash and comes back signed (managers only)', async () => {
    await signPay1();
    const staff = as('entry');
    const signed = (await getEntry(staff, ACC_A, 'pay1'))!;
    await deleteEntry(staff, 'entry', ACC_A, signed, [], CTX);
    expect((await getEntry(staff, ACC_A, 'pay1'))!.entry.deleted).toBe(true);
    expect((await notifications(as('admin')))[0]?.kind).toBe('delete');

    await assertFails(listTrash(staff));
    const trash = await listTrash(as('admin'));
    expect(trash.map((t) => `${t.accountId}/${t.snap.entry.id}`)).toEqual([`${ACC_A}/pay1`]);
    expect(trash[0]?.deletedBy).toBe('entry');

    const inTrash = trash[0]!.snap;
    await assertFails(restoreEntry(staff, 'entry', ACC_A, inTrash, CTX));
    await restoreEntry(as('admin'), 'admin', ACC_A, inTrash, {
      actorName: 'admin',
      accountName: 'x',
    });
    const back = (await getEntry(staff, ACC_A, 'pay1'))!;
    expect(back.entry.deleted).toBe(false);
    expect(back.entry.signature?.name).toBe('عبد المجيد');
    expect(back.raw.deletedAt).toBeUndefined();
    expect((await notifications(as('owner'))).map((n) => n.kind).sort()).toEqual([
      'delete',
      'restore',
    ]);
  });

  it('refuses a delete without notification, a delete that also edits, and any hard delete', async () => {
    const staff = as('entry');
    const inv = (await getEntry(staff, ACC_A, 'inv1'))!;
    const ref = doc(staff, `accounts/${ACC_A}/entries/inv1`);
    const b = writeBatch(staff);
    const a = doc(collection(staff, 'auditLog'));
    b.set(a, {
      actor: 'entry',
      action: 'delete',
      path: ref.path,
      before: inv.raw,
      at: serverTimestamp(),
    });
    b.update(ref, {
      deleted: true,
      deletedAt: serverTimestamp(),
      auditId: a.id,
      updatedAt: serverTimestamp(),
      updatedBy: 'entry',
    });
    await assertFails(b.commit());
    await assertFails(deleteDoc(ref));
    await assertFails(deleteDoc(doc(as('owner'), `accounts/${ACC_A}/entries/inv1`)));
  });
});

describe('notifications', () => {
  it('only managers read; read state is per user and only yourself', async () => {
    const staff = as('entry');
    const inv = (await getEntry(staff, ACC_A, 'inv1'))!;
    await deleteEntry(staff, 'entry', ACC_A, inv, [], CTX);
    await assertFails(getDocs(collection(staff, 'notifications')));
    const [n] = await notifications(as('admin'));
    await markRead(as('admin'), 'admin', [n!.id]);
    expect((await notifications(as('owner')))[0]?.readBy).toEqual(['admin']);
    const ref = doc(as('owner'), 'notifications', n!.id);
    await assertFails(updateDoc(ref, { readBy: ['admin', 'entry'] }));
    await assertFails(updateDoc(ref, { changes: ['مزوّر'] }));
    await assertFails(markRead(staff, 'entry', [n!.id]));
    await assertFails(deleteDoc(ref));
  });

  it('cannot be forged: needs a matching audit record, entry and real name', async () => {
    const staff = as('entry');
    const base = {
      kind: 'delete',
      accountId: ACC_A,
      entryId: 'inv1',
      accountName: 'x',
      title: 'فاتورة',
      changes: [],
      actor: 'entry',
      actorName: 'entry',
      at: serverTimestamp(),
      readBy: [],
    };
    await assertFails(setDoc(doc(staff, 'notifications', 'fake1'), base));
    // Audit record exists but the entry was not touched.
    const b = writeBatch(staff);
    const a = doc(collection(staff, 'auditLog'));
    b.set(a, {
      actor: 'entry',
      action: 'delete',
      path: `accounts/${ACC_A}/entries/inv1`,
      before: {},
      at: serverTimestamp(),
    });
    b.set(doc(staff, 'notifications', a.id), base);
    await assertFails(b.commit());
    // Wrong display name.
    const inv = (await getEntry(staff, ACC_A, 'inv1'))!;
    await assertFails(
      deleteEntry(staff, 'entry', ACC_A, inv, [], { actorName: 'المالك', accountName: 'x' }),
    );
  });
});

describe('archive', () => {
  it('managers archive (audited); the account vanishes for data-entry users until restored', async () => {
    const admin = as('admin');
    const staff = as('entry');
    await assertFails(setArchived(staff, 'entry', { id: ACC_A, archived: false }, true));
    await setArchived(admin, 'admin', { id: ACC_A, archived: false }, true);
    expect((await getDoc(doc(admin, 'accounts', ACC_A))).data()?.archived).toBe(true);
    // The card stays readable (so the app hides it); the statement does not.
    expect((await getAccounts(staff, [ACC_A]))[0]?.archived).toBe(true);
    await assertFails(getEntry(staff, ACC_A, 'inv1'));
    await assertFails(getDocs(collection(staff, `accounts/${ACC_A}/entries`)));
    // Managers still see it and its statement.
    expect((await getEntry(admin, ACC_A, 'inv1'))?.entry.amount).toBe(100000);
    await setArchived(admin, 'admin', { id: ACC_A, archived: true }, false);
    expect((await getAccounts(staff, [ACC_A]))[0]?.archived).toBe(false);
    expect((await getEntry(staff, ACC_A, 'inv1'))?.entry.amount).toBe(100000);
  });

  it('flipping the flag needs the audit record; a normal edit cannot flip it', async () => {
    const owner = as('owner');
    await assertFails(
      updateDoc(doc(owner, 'accounts', ACC_B), {
        archived: true,
        archivedAt: serverTimestamp(),
        archivedBy: 'owner',
        updatedAt: serverTimestamp(),
        updatedBy: 'owner',
      }),
    );
    await assertSucceeds(
      updateDoc(doc(owner, 'accounts', ACC_B), {
        name: 'اسم جديد',
        updatedAt: serverTimestamp(),
        updatedBy: 'owner',
      }),
    );
  });
});
