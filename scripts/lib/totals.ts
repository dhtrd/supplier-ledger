/**
 * Account running totals (balance / live entries / latest date) on the
 * server side: initial backfill and the nightly check. The app keeps them in
 * step in every entry transaction and the rules verify the arithmetic; this
 * catches anything written outside the app (imports, console edits).
 */
import type { Firestore } from 'firebase-admin/firestore';
import {
  readTotals,
  totalsOf,
  type RunningTotals,
} from '../../src/features/accounts/domain/totals.ts';
import { balanceAt } from '../../src/features/confirmations/domain/confirmation.ts';

export interface TotalsReport {
  accounts: number;
  /** Accounts that had no totals yet and were initialised. */
  initialised: number;
  /** Accounts whose stored totals were wrong and were corrected. */
  corrected: string[];
  /** Live balance confirmations whose period balance no longer matches what they state. */
  confirmChanged: number;
  /** Accounts whose «confirmed through» date was reset to the latest live signed confirmation. */
  confirmedFixed: number;
}

const same = (a: RunningTotals, b: RunningTotals) =>
  a.balance === b.balance && a.entryCount === b.entryCount && a.lastDate === b.lastDate;

export async function syncTotals(
  db: Firestore,
  { only }: { only?: string } = {},
): Promise<TotalsReport> {
  const accounts = only
    ? [await db.doc(`accounts/${only}`).get()].filter((d) => d.exists)
    : (await db.collection('accounts').get()).docs;
  const report: TotalsReport = {
    accounts: accounts.length,
    initialised: 0,
    corrected: [],
    confirmChanged: 0,
    confirmedFixed: 0,
  };
  for (const acc of accounts) {
    const docs = (await acc.ref.collection('entries').get()).docs.map((d) => d.data());
    const entries = docs.map((e) => ({
      deleted: e.deleted === true,
      signed: typeof e.signed === 'number' ? e.signed : 0,
      date: typeof e.date === 'string' ? e.date : '',
    }));
    // Balance confirmations (إقرار مطابقة): re-check what each one states, and
    // keep «confirmed through» = the latest live SIGNED one (the app only
    // raises it; a confirmation moved to the trash lowers it here).
    let through = '';
    for (const e of docs) {
      if (e.type !== 'confirm' || e.deleted === true) continue;
      if (balanceAt(entries, String(e.date)) !== e.confirmBalance) report.confirmChanged++;
      if (e.signature && String(e.date) > through) through = String(e.date);
    }
    const stored = acc.data()?.confirmedThrough;
    if ((stored ?? '') !== through) {
      await acc.ref.update({ confirmedThrough: through });
      report.confirmedFixed++;
    }
    const want = totalsOf(entries);
    const have = readTotals(acc.data() ?? {});
    // lastDate never goes back in the app; keep a later stored one.
    if (have && have.lastDate > want.lastDate) want.lastDate = have.lastDate;
    if (have && same(have, want)) continue;
    await acc.ref.update({ ...want });
    if (have) report.corrected.push(acc.id);
    else report.initialised++;
  }
  return report;
}
