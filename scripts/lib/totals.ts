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

export interface TotalsReport {
  accounts: number;
  /** Accounts that had no totals yet and were initialised. */
  initialised: number;
  /** Accounts whose stored totals were wrong and were corrected. */
  corrected: string[];
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
  const report: TotalsReport = { accounts: accounts.length, initialised: 0, corrected: [] };
  for (const acc of accounts) {
    const entries = (await acc.ref.collection('entries').get()).docs.map((d) => {
      const e = d.data();
      return {
        deleted: e.deleted === true,
        signed: typeof e.signed === 'number' ? e.signed : 0,
        date: typeof e.date === 'string' ? e.date : '',
      };
    });
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
