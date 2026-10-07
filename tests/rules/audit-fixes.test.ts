/** Gaps found by the 2026-10-07 audit — each was an accepted exploit before. */
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
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { ACC_A, createEnv, seed } from './setup';
import { getAccounts, setArchived } from '../../src/features/accounts/data/accountsRepo';
import { getEntry, updateEntry } from '../../src/features/ledger/data/entriesRepo';
import { createSignLink } from '../../src/features/signing/data/signLinksRepo';

let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore() as unknown as Firestore;
const CTX = { actorName: 'entry', accountName: 'حساب accA' };
const PAY = `accounts/${ACC_A}/entries/pay1`;

beforeAll(async () => {
  env = await createEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await seed(env);
});

const rawOf = async (path: string) => {
  let d: Record<string, unknown> = {};
  await env.withSecurityRulesDisabled(async (ctx) => {
    d = (await getDoc(doc(ctx.firestore() as unknown as Firestore, path))).data() ?? {};
  });
  return d;
};

describe('audit records must be written with the change they describe', () => {
  it('an old audit id cannot be reused for a new edit', async () => {
    const staff = as('entry');
    const pay = (await getEntry(staff, ACC_A, 'pay1'))!;
    await updateEntry(
      staff,
      'entry',
      ACC_A,
      pay,
      { amount: 1000, signed: -1000, date: pay.entry.date, details: 'a', keepAttachments: [] },
      [],
      [],
      CTX,
    );
    const firstAudit = (await rawOf(PAY)).auditId as string;
    const pay2 = (await getEntry(staff, ACC_A, 'pay1'))!;
    await updateEntry(
      staff,
      'entry',
      ACC_A,
      pay2,
      { amount: 2000, signed: -2000, date: pay.entry.date, details: 'b', keepAttachments: [] },
      [],
      [],
      CTX,
    );
    await assertFails(
      updateDoc(doc(staff, PAY), {
        amount: 999999,
        signed: -999999,
        auditId: firstAudit,
        updatedAt: serverTimestamp(),
        updatedBy: 'entry',
      }),
    );
  });

  it('a pre-made record, a fake «before» or another account cannot be used', async () => {
    const staff = as('entry');
    await assertFails(
      setDoc(doc(staff, 'auditLog/pre1'), {
        actor: 'entry',
        action: 'update',
        path: PAY,
        before: await rawOf(PAY),
        at: serverTimestamp(),
      }),
    );
    // Real batch, but «before» is not the real previous state.
    const b = writeBatch(staff);
    const a = doc(collection(staff, 'auditLog'));
    b.set(a, {
      actor: 'entry',
      action: 'update',
      path: PAY,
      before: { amount: 1 },
      at: serverTimestamp(),
    });
    b.update(doc(staff, PAY), {
      details: 'x',
      auditId: a.id,
      updatedAt: serverTimestamp(),
      updatedBy: 'entry',
    });
    await assertFails(b.commit());
    await assertFails(
      setDoc(doc(staff, 'auditLog/other'), {
        actor: 'entry',
        action: 'delete',
        path: 'accounts/accB/entries/inv1',
        before: {},
        at: serverTimestamp(),
      }),
    );
  });
});

describe('entries', () => {
  const audited = async (db: Firestore, patch: Record<string, unknown>) => {
    const b = writeBatch(db);
    const a = doc(collection(db, 'auditLog'));
    b.set(a, {
      actor: 'entry',
      action: 'update',
      path: PAY,
      before: await rawOf(PAY),
      at: serverTimestamp(),
    });
    b.update(doc(db, PAY), {
      ...patch,
      auditId: a.id,
      updatedAt: serverTimestamp(),
      updatedBy: 'entry',
    });
    return b.commit();
  };
  it('legacy mark is frozen; impossible dates and junk attachment ids are refused', async () => {
    const staff = as('entry');
    await assertFails(audited(staff, { legacyId: 1 }));
    await assertFails(audited(staff, { date: '2026-13-01' }));
    await assertFails(audited(staff, { date: '2026-02-00' }));
    await assertFails(audited(staff, { date: '1999-12-31' }));
    await assertFails(audited(staff, { attachments: ['../../x'] }));
    await assertSucceeds(audited(staff, { date: '2026-12-31' }));
  });
  it('no one can permanently delete an attachment; orphans cannot be created', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore() as unknown as Firestore, `accounts/${ACC_A}/attachments/att1`),
        { x: 1 },
      );
    });
    await assertFails(deleteDoc(doc(as('owner'), `accounts/${ACC_A}/attachments/att1`)));
    const { Bytes } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(as('entry'), `accounts/${ACC_A}/attachments/orphan`), {
        data: Bytes.fromUint8Array(new Uint8Array(10)),
        thumb: Bytes.fromUint8Array(new Uint8Array(10)),
        mime: 'image/webp',
        size: 10,
        entryId: 'nope',
        createdAt: serverTimestamp(),
        createdBy: 'entry',
      }),
    );
  });
});

describe('sign links show only the real voucher', () => {
  it('payer, supplier name, date and details must match', async () => {
    const staff = as('entry');
    const pay = (await getEntry(staff, ACC_A, 'pay1'))!;
    const [account] = await getAccounts(staff, [ACC_A]);
    const make = (o: Partial<{ payerName: string; name: string; date: string; details: string }>) =>
      createSignLink(staff, 'entry', {
        account: { ...account!, name: o.name ?? account!.name },
        entry: {
          ...pay.entry,
          date: o.date ?? pay.entry.date,
          details: o.details ?? pay.entry.details,
        },
        payerName: o.payerName ?? 'شركة الضبيبي',
        ttlMinutes: 60,
        pendingForEntry: [],
      });
    await assertFails(make({ payerName: 'أي أحد' }));
    await assertFails(make({ name: 'مورد آخر' }));
    await assertFails(make({ date: '2026-01-01' }));
    await assertFails(make({ details: 'مبلغ مختلف' }));
    await assertSucceeds(make({}));
  });
});

describe('accounts and users', () => {
  it('a manager cannot hide an account outside the archive, or reach its audit/legacy fields', async () => {
    const admin = as('admin');
    for (const patch of [{ deleted: true }, { auditId: 'whatever' }, { legacyId: 5 }])
      await assertFails(
        updateDoc(doc(admin, 'accounts', ACC_A), {
          ...patch,
          updatedAt: serverTimestamp(),
          updatedBy: 'admin',
        }),
      );
  });
  it('an account migrated with an old-format phone can still be archived', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore() as unknown as Firestore, 'accounts', ACC_A), {
        phone: '+966501234567',
      });
    });
    await setArchived(as('admin'), 'admin', { id: ACC_A, archived: false }, true);
    expect((await rawOf(`accounts/${ACC_A}`)).archived).toBe(true);
  });
  it("a manager cannot change a user's email; names cannot be blank", async () => {
    const admin = as('admin');
    await assertFails(
      updateDoc(doc(admin, 'users', 'entry'), {
        email: 'owner@example.com',
        updatedAt: serverTimestamp(),
        updatedBy: 'admin',
      }),
    );
    await assertFails(
      updateDoc(doc(admin, 'users', 'entry'), {
        name: '   ',
        updatedAt: serverTimestamp(),
        updatedBy: 'admin',
      }),
    );
    await assertFails(
      updateDoc(doc(admin, 'accounts', ACC_A), {
        name: '  ',
        updatedAt: serverTimestamp(),
        updatedBy: 'admin',
      }),
    );
  });
});
