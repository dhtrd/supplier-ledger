/**
 * One-time import of the old «دفتر الحسابات» backup into Firestore.
 *
 *   node scripts/migrate/migrate.ts --db <path/to/backup.db> [--dry-run] [--force]
 *
 * Credentials come from the environment (see scripts/lib/admin.ts). The
 * script refuses to run twice unless --force, writes with fixed ids (L<id>)
 * so a rerun overwrites instead of duplicating, and verifies counts and every
 * account balance against the source after writing. Any mismatch → exit 1.
 */
import { DatabaseSync } from 'node:sqlite';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb, arg, flag, runMain } from '../lib/admin.ts';
import {
  balancesByAccount,
  mapAccounts,
  mapEntries,
  type LegacyCustomer,
  type LegacyTransaction,
} from './legacy.ts';

const MIGRATION_UID = 'migration';

runMain(async () => {
  const dbPath = arg('db');
  if (!dbPath) throw new Error('Usage: --db <path to old backup .db>');
  const src = new DatabaseSync(dbPath, { readOnly: true });
  const customers = src
    .prepare('SELECT ID, name, gsm, g_id FROM customers')
    .all() as unknown as LegacyCustomer[];
  const txs = src
    .prepare('SELECT ID, cus_id, "in", out, date_, remarks, now_, param2 FROM transactions')
    .all() as unknown as LegacyTransaction[];

  const accounts = mapAccounts(customers);
  const entries = mapEntries(txs, new Set(customers.map((c) => c.ID)));
  const expected = balancesByAccount(entries);
  const total = [...expected.values()].reduce((a, b) => a + b, 0);
  console.log(
    `source: ${accounts.length} accounts, ${entries.length} entries, net balance ${total / 100} SAR`,
  );
  if (flag('dry-run')) return;

  const db = adminDb();
  const existing = await db.collection('accounts').limit(1).get();
  if (!existing.empty && !flag('force'))
    throw new Error('Accounts already exist. Re-run with --force to overwrite the imported ids.');

  const now = Timestamp.now();
  let batch = db.batch();
  let ops = 0;
  const flush = async () => {
    if (ops) await batch.commit();
    batch = db.batch();
    ops = 0;
  };
  const add = async (fn: () => void) => {
    fn();
    if (++ops >= 400) await flush();
  };

  for (const a of accounts) {
    await add(() =>
      batch.set(db.doc(`accounts/${a.id}`), {
        name: a.name,
        phone: a.phone,
        group: a.group,
        deleted: false,
        legacyId: a.legacyId,
        createdAt: now,
        createdBy: MIGRATION_UID,
      }),
    );
  }
  let maxVoucher = 0;
  for (const e of entries) {
    const data: Record<string, unknown> = {
      type: e.type,
      amount: e.amount,
      signed: e.signed,
      date: e.date,
      details: e.details,
      attachments: [],
      deleted: false,
      legacyId: e.legacyId,
      createdAt: Timestamp.fromMillis(e.createdAtMs),
      createdBy: MIGRATION_UID,
    };
    if (e.voucherNo !== undefined) {
      data.voucherNo = e.voucherNo;
      maxVoucher = Math.max(maxVoucher, e.voucherNo);
    }
    await add(() => batch.set(db.doc(`accounts/${e.accountId}/entries/${e.id}`), data));
  }
  await add(() => batch.set(db.doc('counters/vouchers'), { next: maxVoucher }, { merge: true }));
  await flush();

  // ---- verification (criterion 1) ----
  let count = 0;
  for (const a of accounts) {
    const snap = await db
      .collection(`accounts/${a.id}/entries`)
      .where('deleted', '==', false)
      .get();
    count += snap.size;
    const sum = snap.docs.reduce((s, d) => s + (d.get('signed') as number), 0);
    const want = expected.get(a.id) ?? 0;
    if (sum !== want)
      throw new Error(`Balance mismatch for ${a.name}: got ${sum}, expected ${want}`);
  }
  if (count !== entries.length)
    throw new Error(`Entry count mismatch: got ${count}, expected ${entries.length}`);
  console.log(
    `verified: ${accounts.length} accounts, ${count} entries, every balance matches; voucher counter = ${maxVoucher}`,
  );
});
