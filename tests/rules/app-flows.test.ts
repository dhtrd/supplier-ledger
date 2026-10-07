/**
 * Runs the app's own data-layer functions against the emulator with the real
 * rules, so a rules/client mismatch fails CI instead of failing in production.
 */
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
  type Firestore,
} from 'firebase/firestore';
import { ACC_A, ACC_B, createEnv, seed } from './setup';
import {
  accountTotals,
  createAccount,
  getAccounts,
  listAccounts,
  updateAccount,
} from '../../src/features/accounts/data/accountsRepo';
import {
  createEntry,
  deleteEntry,
  getAttachment,
  getEntry,
  updateEntry,
} from '../../src/features/ledger/data/entriesRepo';
import {
  createSignLink,
  getPublicLink,
  signLink,
  syncSignedLink,
  toLink,
} from '../../src/features/signing/data/signLinksRepo';
import { renameSelf, updateUser } from '../../src/features/users/data/usersRepo';
import {
  getBackupMeta,
  listAudit,
  saveSettings,
} from '../../src/features/settings/data/settingsRepo';
import { DEFAULT_SETTINGS } from '../../src/features/settings/domain/types';
import {
  clearOwnFailures,
  getFailures,
  recordFailure,
  unlockAccount,
} from '../../src/features/auth/data/lockoutRepo';
import { listBackupRequests, requestBackup } from '../../src/features/backup/data/backupRepo';

let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore() as unknown as Firestore;
const anon = () => env.unauthenticatedContext().firestore() as unknown as Firestore;

beforeAll(async () => {
  env = await createEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await seed(env);
});

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('accounts', () => {
  it('managers create/update with a logo; entry users see only assigned accounts', async () => {
    const id = await createAccount(
      as('admin'),
      'admin',
      { name: 'مورد جديد', phone: '٠٥٥٠٠٠٠٠٠١', group: 'customers' },
      new Uint8Array(1000),
    );
    await updateAccount(
      as('owner'),
      'owner',
      id,
      { name: 'مورد معدل', phone: '0550000001', group: 'suppliers' },
      null,
    );
    const all = await listAccounts(as('owner'));
    expect(all.map((a) => a.name)).toContain('مورد معدل');
    expect((await getAccounts(as('entry'), [ACC_A])).map((a) => a.id)).toEqual([ACC_A]);
    await assertFails(listAccounts(as('entry')));
    await assertFails(getAccounts(as('entry'), [ACC_B]));
    await assertFails(
      createAccount(as('entry'), 'entry', { name: 'x', phone: '', group: 'general' }, null),
    );
  });

  it('a phone WhatsApp cannot use is refused by the rules too', async () => {
    const db = as('owner');
    const ref = doc(db, 'accounts', ACC_A);
    const base = { updatedAt: serverTimestamp(), updatedBy: 'owner' };
    for (const bad of ['055755359', '0676173525', '+966557553590', '05575535901'])
      await assertFails(updateDoc(ref, { ...base, phone: bad }));
    await assertSucceeds(updateDoc(ref, { ...base, phone: '0557553590' }));
    await assertSucceeds(updateDoc(ref, { ...base, phone: '' }));
  });

  it('computes balance and count server-side, ignoring deleted entries', async () => {
    const t = await accountTotals(as('entry'), ACC_A);
    expect(t).toEqual({ balance: 50000, count: 2 });
  });
});

describe('entries', () => {
  it('payment takes the next voucher number atomically; invoice stores images', async () => {
    const db = as('entry');
    const p1 = await createEntry(
      db,
      'entry',
      ACC_A,
      { type: 'payment', amount: 1500, signed: -1500, date: '2026-10-01', details: 'دفعة' },
      [],
    );
    const p2 = await createEntry(
      db,
      'entry',
      ACC_A,
      { type: 'payment', amount: 700, signed: -700, date: '2026-10-01', details: '' },
      [],
    );
    expect([p1.voucherNo, p2.voucherNo]).toEqual([101, 102]);
    const inv = await createEntry(
      db,
      'entry',
      ACC_A,
      { type: 'invoice', amount: 9900, signed: 9900, date: '2026-10-02', details: 'فاتورة 1' },
      [{ data: new Uint8Array(2048), thumb: new Uint8Array(512), mime: 'image/webp' }],
    );
    expect(inv.voucherNo).toBeNull();
    const snap = await getEntry(db, ACC_A, inv.id);
    expect(snap?.entry.attachments).toHaveLength(1);
    const att = await getAttachment(db, ACC_A, snap!.entry.attachments[0]!);
    expect(att?.data?.byteLength).toBe(2048);
    expect(att?.thumb?.byteLength).toBe(512);
    await createEntry(
      db,
      'entry',
      ACC_A,
      { type: 'note', amount: 0, signed: 0, date: '2026-10-02', details: 'ملاحظة' },
      [],
    );
    await assertFails(
      createEntry(
        db,
        'entry',
        ACC_B,
        { type: 'invoice', amount: 1, signed: 1, date: '2026-10-02', details: '' },
        [],
      ),
    );
  });

  it('edit and soft delete are audited; managers can read the audit log', async () => {
    const db = as('entry');
    const cur = (await getEntry(db, ACC_A, 'inv1'))!;
    await updateEntry(
      db,
      'entry',
      ACC_A,
      cur,
      { amount: 120000, signed: 120000, date: '2026-09-03', details: 'معدلة', keepAttachments: [] },
      [],
    );
    const after = (await getEntry(db, ACC_A, 'inv1'))!;
    expect(after.entry.amount).toBe(120000);
    await deleteEntry(db, 'entry', ACC_A, after);
    expect((await getEntry(db, ACC_A, 'inv1'))!.entry.deleted).toBe(true);
    const log = await listAudit(as('admin'));
    expect(log.map((l) => l.action).sort()).toEqual(['delete', 'update']);
    expect(log.find((l) => l.action === 'update')?.before.amount).toBe(100000);
    await assertFails(listAudit(db));
    expect(await accountTotals(db, ACC_A)).toEqual({ balance: -50000, count: 1 });
  });
});

describe('signing flow', () => {
  it('link → public sign → sync onto the entry → entry is frozen', async () => {
    const staff = as('entry');
    const pay = (await getEntry(staff, ACC_A, 'pay1'))!;
    const [account] = await getAccounts(staff, [ACC_A]);
    const old = await createSignLink(staff, 'entry', {
      account: account!,
      entry: pay.entry,
      payerName: 'شركة الضبيبي',
      ttlMinutes: 60,
      pendingForEntry: [],
    });
    const oldLink = toLink(await getDoc(doc(staff, 'signLinks', old)));
    const token = await createSignLink(staff, 'entry', {
      account: account!,
      entry: pay.entry,
      payerName: 'شركة الضبيبي',
      ttlMinutes: 60,
      pendingForEntry: [oldLink],
    });
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    // The older link is revoked, so it is dead for the public.
    await assertFails(getPublicLink(anon(), old));

    const pub = await getPublicLink(anon(), token);
    expect(pub?.amountWords).toBe('خمسمائة ريال سعودي لا غير');
    await signLink(anon(), token, 'عبد المجيد', PNG);
    await assertFails(signLink(anon(), token, 'مرة ثانية', PNG));

    const signed = toLink(await getDoc(doc(staff, 'signLinks', token)));
    await syncSignedLink(staff, 'entry', signed);
    const frozen = (await getEntry(staff, ACC_A, 'pay1'))!;
    expect(frozen.entry.signature?.name).toBe('عبد المجيد');
    await assertFails(
      deleteEntry(staff, 'entry', ACC_A, {
        ...frozen,
        entry: { ...frozen.entry, signature: null },
      }),
    );
  });

  it('editing a payment revokes its open link; a signature for another amount is never attached', async () => {
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
    // Recipient signs the 500 voucher; meanwhile the amount is changed behind its back.
    await signLink(anon(), token, 'عبد المجيد', PNG);
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { updateDoc } = await import('firebase/firestore');
      await updateDoc(
        doc(ctx.firestore() as unknown as Firestore, `accounts/${ACC_A}/entries/pay1`),
        { amount: 90000, signed: -90000 },
      );
    });
    const signed = toLink(await getDoc(doc(staff, 'signLinks', token)));
    await assertFails(syncSignedLink(staff, 'entry', signed));

    // Normal path: the client revokes open links in the same batch as the edit.
    const t2 = await createSignLink(staff, 'entry', {
      account: account!,
      entry: { ...pay.entry, amount: 90000, signed: -90000 },
      payerName: 'x',
      ttlMinutes: 60,
      pendingForEntry: [],
    });
    const cur = (await getEntry(staff, ACC_A, 'pay1'))!;
    await updateEntry(
      staff,
      'entry',
      ACC_A,
      cur,
      { amount: 1000, signed: -1000, date: cur.entry.date, details: '', keepAttachments: [] },
      [],
      [t2],
    );
    await assertFails(getPublicLink(anon(), t2));
  });

  it('a link with a stale TTL (settings changed) is refused', async () => {
    const staff = as('admin');
    const pay = (await getEntry(staff, ACC_A, 'pay1'))!;
    const [account] = await getAccounts(staff, [ACC_A]);
    await assertFails(
      createSignLink(staff, 'admin', {
        account: account!,
        entry: pay.entry,
        payerName: 'x',
        ttlMinutes: 30,
        pendingForEntry: [],
      }),
    );
  });
});

describe('users and settings', () => {
  it('owner saves settings and renames himself; admin cannot change settings', async () => {
    await saveSettings(as('owner'), 'owner', {
      ...DEFAULT_SETTINGS,
      linkMinutes: 30,
      payerName: 'شركة',
    });
    await renameSelf(as('owner'), 'owner', 'أنور');
    await assertFails(saveSettings(as('admin'), 'admin', DEFAULT_SETTINGS));
    await assertFails(
      updateUser(as('admin'), 'admin', 'owner', {
        name: 'x',
        role: 'admin',
        active: true,
        assignedAccounts: [],
      }),
    );
    await updateUser(as('admin'), 'admin', 'entry', {
      name: 'مدخل',
      role: 'entry',
      active: true,
      assignedAccounts: [ACC_A, ACC_B],
    });
    expect((await getAccounts(as('entry'), [ACC_B])).length).toBe(1);
    expect((await getBackupMeta(as('owner'))).lastBackupMs).not.toBeNull();
    await assertFails(getBackupMeta(as('admin')));
    expect((await getDocs(collection(as('owner'), 'users'))).size).toBe(4);
  });
});

describe('5 failed attempts lock the account (all roles)', () => {
  const withEmail = (uid: string) =>
    env
      .authenticatedContext(uid, { email: `${uid}@example.com` })
      .firestore() as unknown as Firestore;

  it('anonymous failures count to 5 and no further; a locked user loses all access', async () => {
    for (let i = 0; i < 5; i++) await recordFailure(anon(), 'Entry@Example.com');
    await assertFails(recordFailure(anon(), 'entry@example.com'));
    const me = withEmail('entry');
    expect(await getFailures(me, 'entry@example.com')).toBe(5);
    await assertFails(getAccounts(me, [ACC_A]));
    await assertFails(clearOwnFailures(me, 'entry@example.com'));
    // The owner unlocks; access returns.
    await unlockAccount(withEmail('owner'), 'owner', 'entry@example.com');
    expect((await getAccounts(me, [ACC_A])).length).toBe(1);
  });

  it('applies to the owner too; only the console (Admin) can unlock the owner', async () => {
    for (let i = 0; i < 5; i++) await recordFailure(anon(), 'owner@example.com');
    const owner = withEmail('owner');
    await assertFails(listAccounts(owner));
    await assertFails(unlockAccount(owner, 'owner', 'owner@example.com'));
  });

  it('a successful sign-in clears its own counter; others cannot read or reset it', async () => {
    await recordFailure(anon(), 'admin@example.com');
    await recordFailure(anon(), 'admin@example.com');
    await assertFails(getFailures(withEmail('entry'), 'admin@example.com'));
    await assertFails(unlockAccount(withEmail('entry'), 'entry', 'admin@example.com'));
    await assertFails(getFailures(anon(), 'admin@example.com'));
    await clearOwnFailures(withEmail('admin'), 'admin@example.com');
    expect(await getFailures(withEmail('owner'), 'admin@example.com')).toBe(0);
  });
});

describe('returns, discounts and backup requests', () => {
  it('a payment may be a return/discount; it can never get a signing link', async () => {
    const staff = as('entry');
    const { doc: d, setDoc, serverTimestamp } = await import('firebase/firestore');
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(d(ctx.firestore() as unknown as Firestore, `accounts/${ACC_A}/entries/ret1`), {
        type: 'payment',
        subtype: 'return',
        amount: 1000,
        signed: -1000,
        date: '2026-09-03',
        details: 'مرتجع',
        attachments: [],
        voucherNo: 120,
        deleted: false,
        createdAt: serverTimestamp(),
        createdBy: 'import',
      });
    });
    const ret = (await getEntry(staff, ACC_A, 'ret1'))!;
    expect(ret.entry.subtype).toBe('return');
    const [account] = await getAccounts(staff, [ACC_A]);
    await assertFails(
      createSignLink(staff, 'entry', {
        account: account!,
        entry: ret.entry,
        payerName: 'x',
        ttlMinutes: 60,
        pendingForEntry: [],
      }),
    );
    // Editing keeps the mark; removing or adding it is refused.
    await updateEntry(
      staff,
      'entry',
      ACC_A,
      ret,
      { amount: 900, signed: -900, date: ret.entry.date, details: 'مرتجع', keepAttachments: [] },
      [],
    );
    const invoice = {
      type: 'invoice',
      amount: 100,
      signed: 100,
      date: '2026-09-03',
      details: '',
      attachments: [],
      deleted: false,
      createdAt: serverTimestamp(),
      createdBy: 'entry',
    };
    await assertFails(
      setDoc(d(staff, `accounts/${ACC_A}/entries/bad`), { ...invoice, subtype: 'return' }),
    );
    await setDoc(d(staff, `accounts/${ACC_A}/entries/ok`), invoice);
  });

  it('managers request an on-demand backup; data-entry users cannot', async () => {
    await requestBackup(as('admin'), 'admin');
    await assertFails(requestBackup(as('entry'), 'entry'));
    expect((await listBackupRequests(as('owner'))).length).toBe(1);
  });
});
