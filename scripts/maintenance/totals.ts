/**
 * Initialise / verify every account's running totals.
 *
 *   node scripts/maintenance/totals.ts              all accounts
 *   node scripts/maintenance/totals.ts --account ID one account
 *
 * Run once after deploying the totals feature (the «Maintenance» workflow in
 * GitHub Actions does it), and after any import done outside the app. The
 * daily backup also runs the same check. Prints counts only (public logs).
 */
import { adminDb, arg, runMain } from '../lib/admin.ts';
import { syncTotals } from '../lib/totals.ts';

runMain(async () => {
  const only = arg('account');
  const r = await syncTotals(adminDb(), only ? { only } : {});
  console.log(
    `totals: ${r.accounts} accounts, ${r.initialised} initialised, ${r.corrected.length} corrected`,
  );
});
