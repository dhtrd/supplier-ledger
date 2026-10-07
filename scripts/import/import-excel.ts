/**
 * Imports a supplier statement kept in Excel as a NEW account.
 *
 *   node scripts/import/import-excel.ts --file statement.xlsx --name "بدر زين" [--dry-run]
 *
 * Verifies the sheet's own totals and balance before writing, refuses to
 * import over an existing account with the same name, gives payments new
 * voucher numbers from counters/vouchers, and re-checks count + balance in
 * Firestore afterwards. Any mismatch → exit 1. Prints counts only.
 */
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { readSheet } from 'read-excel-file/node';
import { adminDb, arg, flag, runMain } from '../lib/admin.ts';
import { parseLedgerSheet, verifyAgainstSheet } from './excelLedger.ts';

const GROUPS = ['suppliers', 'customers', 'general'];

runMain(async () => {
  const file = arg('file');
  const name = arg('name')?.trim();
  const group = arg('group') ?? 'suppliers';
  if (!file || !name)
    throw new Error('Usage: --file <xlsx> --name <account name> [--group suppliers]');
  if (!GROUPS.includes(group)) throw new Error(`--group must be one of ${GROUPS.join(', ')}`);

  const parsed = parseLedgerSheet((await readSheet(file)) as unknown[][]);
  verifyAgainstSheet(parsed);
  const payments = parsed.entries.filter((e) => e.type === 'payment');
  const marked = payments.filter((e) => e.subtype).length;
  console.log(
    `sheet ok: ${parsed.entries.length} entries (${payments.length} payments incl. ${marked} returns/discounts), balance ${parsed.balance / 100} SAR له`,
  );
  if (flag('dry-run')) return;

  const db = adminDb();
  const same = await db.collection('accounts').where('name', '==', name).get();
  if (same.docs.some((d) => d.get('deleted') !== true))
    throw new Error(`An account named «${name}» already exists. Nothing was written.`);
  const accountId = `imp-${createHash('sha256').update(name).digest('hex').slice(0, 12)}`;

  // Reserve a block of voucher numbers atomically.
  const counter = db.doc('counters/vouchers');
  const first = await db.runTransaction(async (tx) => {
    const c = await tx.get(counter);
    if (!c.exists) throw new Error('counters/vouchers is missing (run bootstrap/owner.ts first)');
    const start = (c.get('next') as number) + 1;
    tx.update(counter, { next: start + payments.length - 1 });
    return start;
  });

  let next = first;
  let batch = db.batch();
  let ops = 0;
  for (const [i, e] of parsed.entries.entries()) {
    const data: Record<string, unknown> = {
      type: e.type,
      amount: e.amount,
      signed: e.signed,
      date: e.date,
      details: e.details,
      attachments: [],
      deleted: false,
      legacyId: e.row,
      createdAt: Timestamp.fromMillis(Date.parse(`${e.date}T00:00:00Z`) + i * 1000),
      createdBy: 'import',
    };
    if (e.type === 'payment') data.voucherNo = next++;
    if (e.subtype) data.subtype = e.subtype;
    batch.set(db.doc(`accounts/${accountId}/entries/I${String(e.row).padStart(5, '0')}`), data);
    if (++ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  // The account appears last, so a half-finished import is never visible.
  batch.set(db.doc(`accounts/${accountId}`), {
    name,
    phone: '',
    group,
    logo: null,
    deleted: false,
    createdAt: Timestamp.now(),
    createdBy: 'import',
  });
  await batch.commit();

  const written = await db
    .collection(`accounts/${accountId}/entries`)
    .where('deleted', '==', false)
    .get();
  const sum = written.docs.reduce((s, d) => s + (d.get('signed') as number), 0);
  if (written.size !== parsed.entries.length || sum !== parsed.balance)
    throw new Error(`Verification failed: ${written.size} entries, balance ${sum}`);
  console.log(
    `imported «${name}» as ${accountId}: ${written.size} entries, balance ${sum / 100} SAR له, vouchers ${first}–${next - 1}`,
  );
});
