/** Per-supplier document templates (owner decisions 2026-10-17). */
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
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { ACC_A, ACC_B, createEnv, seed } from './setup';
import { getAccounts } from '../../src/features/accounts/data/accountsRepo';
import { getEntry } from '../../src/features/ledger/data/entriesRepo';
import { createSignLink, getPublicLink } from '../../src/features/signing/data/signLinksRepo';
import {
  getRawTemplate,
  getTemplates,
  saveTemplate,
} from '../../src/features/templates/data/templatesRepo';
import { defaultTemplate } from '../../src/features/templates/domain/template';

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

const raw = (over: Record<string, unknown>) => ({
  ...defaultTemplate('confirm', 'c05'),
  ...over,
});

/** A raw template write with its audit record (as the app does it). */
async function putRaw(
  db: Firestore,
  uid: string,
  data: Record<string, unknown>,
  audit: Record<string, unknown> = {},
): Promise<void> {
  const cur = await getDoc(doc(db, 'templates', ACC_A));
  const a = doc(collection(db, 'auditLog'));
  const b = writeBatch(db);
  b.set(a, {
    actor: uid,
    action: 'template',
    kind: 'confirm',
    path: `templates/${ACC_A}`,
    before: cur.exists() ? cur.data() : {},
    at: serverTimestamp(),
    ...audit,
  });
  b.set(doc(db, 'templates', ACC_A), {
    updatedAt: serverTimestamp(),
    updatedBy: uid,
    auditId: a.id,
    ...data,
  });
  await b.commit();
}

describe('saving templates', () => {
  it('managers save and reset; entry users read their accounts only and cannot save', async () => {
    const v = { ...defaultTemplate('voucher', 'v04'), title: 'سند استلام', sub: 'س.ت 1' };
    await saveTemplate(as('admin'), 'admin', ACC_A, 'voucher', v);
    await saveTemplate(as('owner'), 'owner', ACC_A, 'statement', {
      ...defaultTemplate('statement', 'tacct'),
      sides: 'dc',
      columns: ['date', 'details', 'lah', 'alayh'],
    });
    const t = await getTemplates(as('entry'), ACC_A);
    expect([t.voucher?.layout, t.voucher?.sub, t.statement?.sides, t.confirm]).toEqual([
      'v04',
      'س.ت 1',
      'dc',
      undefined,
    ]);
    await assertFails(getTemplates(as('entry'), ACC_B));
    await assertFails(saveTemplate(as('entry'), 'entry', ACC_A, 'voucher', v));
    await saveTemplate(as('admin'), 'admin', ACC_A, 'voucher', null);
    expect((await getTemplates(as('owner'), ACC_A)).voucher).toBeUndefined();
  });

  it('refuses a confirmation text without the balance, date or side, and bad values', async () => {
    const put = (confirm: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      putRaw(as('owner'), 'owner', { confirm, ...extra });
    await assertSucceeds(put(raw({})));
    await assertFails(put(raw({ body: 'نقرّ بأن الرصيد {الرصيد} حتى {التاريخ}' })));
    await assertFails(put(raw({ color: 'red' })));
    await assertFails(put(raw({ font: 'comic' })));
    await assertFails(put(raw({ title: '   ' })));
    await assertFails(put(raw({ body: 'x'.repeat(801) })));
    await assertFails(put(raw({ script: '<b>' })));
    await assertFails(put(raw({}), { other: 1 }));
  });
});

describe('every template save is logged', () => {
  it('writes an audit record with the previous document', async () => {
    const v = defaultTemplate('voucher', 'v04');
    await saveTemplate(as('admin'), 'admin', ACC_A, 'voucher', v);
    await saveTemplate(as('owner'), 'owner', ACC_A, 'voucher', { ...v, layout: 'v07' });
    const log = (await getDocs(collection(as('owner'), 'auditLog'))).docs
      .map((d) => d.data())
      .filter((d) => d.action === 'template');
    expect(log).toHaveLength(2);
    const second = log.find((d) => d.actor === 'owner')!;
    expect([second.kind, second.path, second.before.voucher.layout]).toEqual([
      'voucher',
      `templates/${ACC_A}`,
      'v04',
    ]);
  });

  it('refuses a save without a new audit record, or with a forged one', async () => {
    const owner = as('owner');
    const t = raw({});
    // No audit at all.
    await assertFails(
      setDoc(doc(owner, 'templates', ACC_A), {
        confirm: t,
        updatedAt: serverTimestamp(),
        updatedBy: 'owner',
      }),
    );
    await assertSucceeds(putRaw(owner, 'owner', { confirm: t }));
    // Reusing the previous audit id.
    const prev = (await getDoc(doc(owner, 'templates', ACC_A))).get('auditId') as string;
    await assertFails(
      setDoc(doc(owner, 'templates', ACC_A), {
        confirm: t,
        updatedAt: serverTimestamp(),
        updatedBy: 'owner',
        auditId: prev,
      }),
    );
    // A false «before», a wrong action, a missing kind.
    await assertFails(putRaw(owner, 'owner', { confirm: t }, { before: {} }));
    await assertFails(putRaw(owner, 'owner', { confirm: t }, { action: 'update' }));
    await assertFails(putRaw(owner, 'owner', { confirm: t }, { kind: 'other' }));
    // A data-entry user cannot log (or save) a template change.
    await assertFails(putRaw(as('entry'), 'entry', { confirm: t }));
    // A correct save still works after the refusals.
    await assertSucceeds(putRaw(owner, 'owner', { confirm: t }));
  });
});

describe('the template travels with the signing link', () => {
  it('a link template must be exactly the stored one', async () => {
    await saveTemplate(as('owner'), 'owner', ACC_A, 'voucher', defaultTemplate('voucher', 'v02'));
    const staff = as('entry');
    const pay = (await getEntry(staff, ACC_A, 'pay1'))!;
    const [acc] = await getAccounts(staff, [ACC_A]);
    const args = {
      account: acc!,
      entry: pay.entry,
      payerName: 'شركة الضبيبي',
      ttlMinutes: 60,
      pendingForEntry: [],
    };
    // Without a template the link shows the default document (allowed).
    await assertSucceeds(createSignLink(staff, 'entry', { ...args, template: null }));
    const stored = await getRawTemplate(staff, ACC_A, 'voucher');
    await assertFails(
      createSignLink(staff, 'entry', { ...args, template: { ...stored, color: '#000000' } }),
    );
    const token = await createSignLink(staff, 'entry', { ...args, template: stored });
    const pub = (await getPublicLink(anon(), token))!;
    expect([pub.template?.layout, pub.template?.title]).toEqual(['v02', 'سند استلام دفعة']);
    // Without a template the link carries none.
    const [accB] = await getAccounts(as('owner'), [ACC_B]);
    const payB = (await getEntry(as('owner'), ACC_B, 'pay1'))!;
    await assertSucceeds(
      createSignLink(as('owner'), 'owner', { ...args, account: accB!, entry: payB.entry }),
    );
    // A template on an account that has none is refused.
    await assertFails(
      createSignLink(as('owner'), 'owner', {
        ...args,
        account: accB!,
        entry: payB.entry,
        template: stored,
      }),
    );
    expect((await getDoc(doc(as('owner'), 'templates', ACC_B))).exists()).toBe(false);
  });
});
