import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Bytes,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { ACC_A, ACC_B, createEnv, past, seed } from './setup';

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

const newInvoice = (uid: string, amount = 25000) => ({
  type: 'invoice',
  amount,
  signed: amount,
  date: '2026-10-01',
  details: 'فاتورة رقم 1',
  attachments: [],
  deleted: false,
  createdAt: serverTimestamp(),
  createdBy: uid,
});

/** Edit (or soft delete) an entry together with its audit record. */
async function auditedEdit(
  db: Firestore,
  uid: string,
  path: string,
  patch: Record<string, unknown>,
) {
  const auditId = `a_${Math.random().toString(36).slice(2)}`;
  const b = writeBatch(db);
  b.set(doc(db, `auditLog/${auditId}`), {
    actor: uid,
    action: patch.deleted ? 'delete' : 'update',
    path,
    before: {},
    at: serverTimestamp(),
  });
  b.update(doc(db, path), { ...patch, auditId, updatedBy: uid, updatedAt: serverTimestamp() });
  return b.commit();
}

// ---------------------------------------------------------------------------
describe('criterion 7 — data-entry isolation', () => {
  it('reads an assigned account and its entries', async () => {
    const db = as('entry');
    await assertSucceeds(getDoc(doc(db, `accounts/${ACC_A}`)));
    await assertSucceeds(getDocs(collection(db, `accounts/${ACC_A}/entries`)));
  });
  it('cannot read an unassigned account or its entries', async () => {
    const db = as('entry');
    await assertFails(getDoc(doc(db, `accounts/${ACC_B}`)));
    await assertFails(getDocs(collection(db, `accounts/${ACC_B}/entries`)));
    await assertFails(getDoc(doc(db, `accounts/${ACC_B}/entries/inv1`)));
  });
  it('cannot list all accounts', async () => {
    await assertFails(getDocs(collection(as('entry'), 'accounts')));
  });
  it('cannot write into an unassigned account', async () => {
    const db = as('entry');
    await assertFails(setDoc(doc(db, `accounts/${ACC_B}/entries/x`), newInvoice('entry')));
  });
  it('cannot read users, settings changes, or backups meta', async () => {
    const db = as('entry');
    await assertFails(getDoc(doc(db, 'users/admin')));
    await assertFails(getDocs(collection(db, 'users')));
    await assertFails(getDoc(doc(db, 'meta/backup')));
    await assertFails(getDocs(collection(db, 'auditLog')));
  });
  it('can read its own user document', async () => {
    await assertSucceeds(getDoc(doc(as('entry'), 'users/entry')));
  });
});

describe('criterion 6 — permissions table', () => {
  it('data entry adds an invoice in an assigned account', async () => {
    await assertSucceeds(
      setDoc(doc(as('entry'), `accounts/${ACC_A}/entries/n1`), newInvoice('entry')),
    );
  });
  it('data entry edits and soft-deletes with an audit record', async () => {
    const db = as('entry');
    const path = `accounts/${ACC_A}/entries/inv1`;
    await assertSucceeds(
      auditedEdit(db, 'entry', path, { details: 'تعديل', amount: 120000, signed: 120000 }),
    );
    await assertSucceeds(
      auditedEdit(db, 'entry', path, { deleted: true, deletedAt: serverTimestamp() }),
    );
  });
  it('an edit without an audit record is rejected', async () => {
    await assertFails(
      updateDoc(doc(as('entry'), `accounts/${ACC_A}/entries/inv1`), {
        details: 'تعديل',
        updatedBy: 'entry',
        updatedAt: serverTimestamp(),
      }),
    );
  });
  it('a hard delete is rejected for everyone', async () => {
    const { deleteDoc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(as('owner'), `accounts/${ACC_A}/entries/inv1`)));
  });
  it('only owner/admin create or edit supplier accounts', async () => {
    const acc = (uid: string) => ({
      name: 'مورد جديد',
      phone: '0511111111',
      group: 'suppliers',
      deleted: false,
      createdAt: serverTimestamp(),
      createdBy: uid,
    });
    await assertFails(setDoc(doc(as('entry'), 'accounts/new1'), acc('entry')));
    await assertSucceeds(setDoc(doc(as('admin'), 'accounts/new2'), acc('admin')));
    await assertSucceeds(setDoc(doc(as('owner'), 'accounts/new3'), acc('owner')));
  });
  it('admin creates a data-entry user but never an owner', async () => {
    const u = (role: string) => ({
      name: 'جديد',
      email: 'n@example.com',
      role,
      active: true,
      assignedAccounts: [ACC_A],
      createdAt: serverTimestamp(),
      createdBy: 'admin',
    });
    await assertSucceeds(setDoc(doc(as('admin'), 'users/n1'), u('entry')));
    await assertFails(setDoc(doc(as('admin'), 'users/n2'), u('owner')));
    await assertFails(setDoc(doc(as('entry'), 'users/n3'), { ...u('entry'), createdBy: 'entry' }));
  });
  it('admin reassigns accounts for a data-entry user', async () => {
    await assertSucceeds(
      updateDoc(doc(as('admin'), 'users/entry'), {
        assignedAccounts: [ACC_A, ACC_B],
        updatedBy: 'admin',
        updatedAt: serverTimestamp(),
      }),
    );
  });
  it('a data-entry user cannot promote or reassign himself', async () => {
    await assertFails(
      updateDoc(doc(as('entry'), 'users/entry'), {
        assignedAccounts: [ACC_A, ACC_B],
        updatedBy: 'entry',
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(as('entry'), 'users/entry'), {
        role: 'admin',
        updatedBy: 'entry',
        updatedAt: serverTimestamp(),
      }),
    );
  });
  it('an inactive user is locked out', async () => {
    await assertFails(getDoc(doc(as('inactive'), `accounts/${ACC_A}`)));
    await assertFails(
      setDoc(doc(as('inactive'), `accounts/${ACC_A}/entries/z`), newInvoice('inactive')),
    );
  });
  it('anonymous users read nothing', async () => {
    await assertFails(getDoc(doc(anon(), `accounts/${ACC_A}`)));
    await assertFails(getDoc(doc(anon(), 'settings/app')));
  });
});

describe('criterion 8 — owner protection', () => {
  it('admin cannot change, deactivate or demote the owner', async () => {
    await assertFails(
      updateDoc(doc(as('admin'), 'users/owner'), {
        active: false,
        updatedBy: 'admin',
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(as('admin'), 'users/owner'), {
        role: 'admin',
        updatedBy: 'admin',
        updatedAt: serverTimestamp(),
      }),
    );
  });
  it('the owner can rename himself, but not change role or active', async () => {
    await assertSucceeds(
      updateDoc(doc(as('owner'), 'users/owner'), {
        name: 'أنور',
        updatedBy: 'owner',
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(as('owner'), 'users/owner'), {
        role: 'admin',
        updatedBy: 'owner',
        updatedAt: serverTimestamp(),
      }),
    );
  });
  it('no one deletes a user', async () => {
    const { deleteDoc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(as('owner'), 'users/entry')));
    await assertFails(deleteDoc(doc(as('admin'), 'users/owner')));
  });
  it('only the owner edits settings (role labels, link minutes)', async () => {
    const patch = (uid: string, minutes: number) => ({
      linkMinutes: minutes,
      payerName: 'شركة الضبيبي',
      roleLabels: { owner: 'المالك', admin: 'المدير', entry: 'محاسب' },
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });
    await assertSucceeds(updateDoc(doc(as('owner'), 'settings/app'), patch('owner', 30)));
    await assertFails(updateDoc(doc(as('admin'), 'settings/app'), patch('admin', 30)));
    await assertFails(updateDoc(doc(as('owner'), 'settings/app'), patch('owner', 2)));
  });
  it('only the owner reads backup status', async () => {
    await assertSucceeds(getDoc(doc(as('owner'), 'meta/backup')));
    await assertFails(getDoc(doc(as('admin'), 'meta/backup')));
  });
});

describe('entry validation', () => {
  it('rejects a zero-amount invoice and a mismatched signed amount', async () => {
    const db = as('owner');
    await assertFails(setDoc(doc(db, `accounts/${ACC_A}/entries/z1`), newInvoice('owner', 0)));
    await assertFails(
      setDoc(doc(db, `accounts/${ACC_A}/entries/z2`), { ...newInvoice('owner'), signed: -25000 }),
    );
  });
  it('accepts a note with zero amount', async () => {
    await assertSucceeds(
      setDoc(doc(as('entry'), `accounts/${ACC_A}/entries/note1`), {
        ...newInvoice('entry'),
        type: 'note',
        amount: 0,
        signed: 0,
        details: 'مطابق الحساب',
      }),
    );
  });
  it('a payment must take the next voucher number in the same batch', async () => {
    const db = as('entry');
    const pay = { ...newInvoice('entry', 30000), type: 'payment', signed: -30000, voucherNo: 101 };
    await assertFails(setDoc(doc(db, `accounts/${ACC_A}/entries/p1`), pay));
    const b = writeBatch(db);
    b.update(doc(db, 'counters/vouchers'), { next: 101 });
    b.set(doc(db, `accounts/${ACC_A}/entries/p2`), pay);
    await assertSucceeds(b.commit());
  });
  it('rejects a forged creator or timestamp', async () => {
    await assertFails(
      setDoc(doc(as('entry'), `accounts/${ACC_A}/entries/f1`), {
        ...newInvoice('entry'),
        createdBy: 'owner',
      }),
    );
  });
});

// ---------------------------------------------------------------------------
async function createLink(token: string, ttl = 60, uid = 'entry') {
  return setDoc(doc(as(uid), `signLinks/${token}`), {
    accountId: ACC_A,
    entryId: 'pay1',
    accountName: 'حساب accA',
    accountPhone: '0500000000',
    payerName: 'شركة الضبيبي',
    amount: 50000,
    amountWords: 'خمسمائة ريال سعودي لا غير',
    date: '2026-09-02',
    details: 'دفعة',
    voucherNo: 99,
    ttlMinutes: ttl,
    status: 'pending',
    synced: false,
    createdAt: serverTimestamp(),
    createdBy: uid,
  });
}
const TOKEN = 'tok_aaaaaaaaaaaaaaaaaaaaaa';
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const sign = (db: Firestore, token = TOKEN, name = 'عبد الرحمن') =>
  updateDoc(doc(db, `signLinks/${token}`), {
    status: 'signed',
    signerName: name,
    signatureImage: PNG,
    signedAt: serverTimestamp(),
  });

describe('criteria 3–5 — signing links', () => {
  it('staff create a link only with the owner-set validity', async () => {
    await assertFails(createLink(TOKEN, 999));
    await assertSucceeds(createLink(TOKEN, 60));
  });
  it('cannot create a link for an unassigned account or a non-payment', async () => {
    await assertFails(
      setDoc(doc(as('entry'), `signLinks/${TOKEN}`), {
        accountId: ACC_B,
        entryId: 'pay1',
        accountName: 'x',
        accountPhone: '',
        payerName: 'x',
        amount: 50000,
        amountWords: 'x',
        date: '2026-09-02',
        details: 'x',
        voucherNo: 99,
        ttlMinutes: 60,
        status: 'pending',
        synced: false,
        createdAt: serverTimestamp(),
        createdBy: 'entry',
      }),
    );
  });
  it('the recipient opens and signs a live link without logging in', async () => {
    await createLink(TOKEN);
    await assertSucceeds(getDoc(doc(anon(), `signLinks/${TOKEN}`)));
    await assertSucceeds(sign(anon()));
  });
  it('criterion 4 — a link works once: second signature and re-open are refused', async () => {
    await createLink(TOKEN);
    await sign(anon());
    await assertFails(sign(anon(), TOKEN, 'شخص آخر'));
    await assertFails(getDoc(doc(anon(), `signLinks/${TOKEN}`)));
  });
  it('criterion 3 — an expired link cannot be read or signed', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore() as unknown as Firestore, `signLinks/${TOKEN}`), {
        accountId: ACC_A,
        entryId: 'pay1',
        accountName: 'x',
        accountPhone: '',
        payerName: 'x',
        amount: 50000,
        amountWords: 'x',
        date: '2026-09-02',
        details: 'x',
        voucherNo: 99,
        ttlMinutes: 60,
        status: 'pending',
        synced: false,
        createdAt: past(61),
        createdBy: 'entry',
      });
    });
    await assertFails(getDoc(doc(anon(), `signLinks/${TOKEN}`)));
    await assertFails(sign(anon()));
  });
  it('the recipient cannot alter the amount or other fields', async () => {
    await createLink(TOKEN);
    await assertFails(
      updateDoc(doc(anon(), `signLinks/${TOKEN}`), {
        status: 'signed',
        signerName: 'x y',
        signatureImage: PNG,
        signedAt: serverTimestamp(),
        amount: 1,
      }),
    );
  });
  it('criterion 5 — the link exposes nothing else (no listing, no other data)', async () => {
    await createLink(TOKEN);
    await assertFails(getDocs(collection(anon(), 'signLinks')));
    await assertFails(getDoc(doc(anon(), `accounts/${ACC_A}/entries/pay1`)));
  });
  it('rejects a non-PNG or oversized signature', async () => {
    await createLink(TOKEN);
    await assertFails(
      updateDoc(doc(anon(), `signLinks/${TOKEN}`), {
        status: 'signed',
        signerName: 'اسم',
        signatureImage: '<svg onload=alert(1)>',
        signedAt: serverTimestamp(),
      }),
    );
  });
  it('staff copy the signature to the entry, after which it cannot be edited', async () => {
    await createLink(TOKEN);
    await sign(anon());
    const db = as('entry');
    const link = (await getDoc(doc(db, `signLinks/${TOKEN}`))).data()!;
    const path = `accounts/${ACC_A}/entries/pay1`;
    await assertFails(
      updateDoc(doc(db, path), {
        signLinkId: TOKEN,
        signature: { name: 'مزوّر', image: link.signatureImage, signedAt: link.signedAt },
        updatedBy: 'entry',
        updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(
      updateDoc(doc(db, path), {
        signLinkId: TOKEN,
        signature: { name: link.signerName, image: link.signatureImage, signedAt: link.signedAt },
        updatedBy: 'entry',
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(auditedEdit(db, 'entry', path, { amount: 1, signed: -1 }));
    await assertFails(
      auditedEdit(db, 'entry', path, { deleted: true, deletedAt: serverTimestamp() }),
    );
  });
  it('staff list signed links of an assigned account only', async () => {
    await createLink(TOKEN);
    await sign(anon());
    await assertSucceeds(
      getDocs(
        query(
          collection(as('entry'), 'signLinks'),
          where('accountId', '==', ACC_A),
          where('status', '==', 'signed'),
        ),
      ),
    );
    await assertFails(
      getDocs(query(collection(as('entry'), 'signLinks'), where('accountId', '==', ACC_B))),
    );
  });
});

describe('attachments and the audit log', () => {
  it('accepts a compressed image ≤ 300 KB and rejects a larger one', async () => {
    const db = as('entry');
    const mk = (n: number) => {
      const data = Bytes.fromUint8Array(new Uint8Array(n));
      return {
        data,
        mime: 'image/webp',
        size: n,
        entryId: 'inv1',
        createdAt: serverTimestamp(),
        createdBy: 'entry',
      };
    };
    await assertSucceeds(setDoc(doc(db, `accounts/${ACC_A}/attachments/a1`), mk(200_000)));
    await assertFails(setDoc(doc(db, `accounts/${ACC_A}/attachments/a2`), mk(320_000)));
  });
  it('rejects a non-image attachment type', async () => {
    const db = as('entry');
    await assertFails(
      setDoc(doc(db, `accounts/${ACC_A}/attachments/a3`), {
        data: Bytes.fromUint8Array(new Uint8Array(10)),
        mime: 'text/html',
        size: 10,
        entryId: 'inv1',
        createdAt: serverTimestamp(),
        createdBy: 'entry',
      }),
    );
  });
  it('audit records cannot be forged, edited or deleted', async () => {
    const db = as('entry');
    await assertFails(
      setDoc(doc(db, 'auditLog/x1'), {
        actor: 'owner',
        action: 'update',
        path: 'p',
        before: {},
        at: serverTimestamp(),
      }),
    );
    await assertSucceeds(
      setDoc(doc(db, 'auditLog/x2'), {
        actor: 'entry',
        action: 'update',
        path: 'p',
        before: {},
        at: serverTimestamp(),
      }),
    );
    await assertFails(updateDoc(doc(as('owner'), 'auditLog/x2'), { path: 'q' }));
  });
  it('unknown collections are closed', async () => {
    await assertFails(setDoc(doc(as('owner'), 'random/doc'), { a: 1 }));
  });
});
