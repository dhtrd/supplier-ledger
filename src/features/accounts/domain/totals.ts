/**
 * Running totals kept on each account document (owner decision 2026-10-07:
 * fewer reads). The account list reads them instead of summing every entry.
 * Every entry write updates them in the same transaction, and the rules check
 * the arithmetic, so they cannot drift; the nightly backup re-verifies them.
 */
export interface RunningTotals {
  /** Sum of `signed` of live entries, in halalas (positive = له). */
  balance: number;
  /** Live (not deleted) entries. */
  entryCount: number;
  /** Latest entry date ever recorded (YYYY-MM-DD, '' when none). Never goes back. */
  lastDate: string;
}

export interface EntryState {
  deleted: boolean;
  signed: number;
  date: string;
}

export const ZERO_TOTALS: RunningTotals = { balance: 0, entryCount: 0, lastDate: '' };

const live = (e: EntryState | null): e is EntryState => !!e && !e.deleted;

/** Totals after one entry goes from `before` to `after` (null = does not exist). */
export function nextTotals(
  cur: RunningTotals,
  before: EntryState | null,
  after: EntryState | null,
): RunningTotals {
  const bal = (e: EntryState | null) => (live(e) ? e.signed : 0);
  const cnt = (e: EntryState | null) => (live(e) ? 1 : 0);
  return {
    balance: cur.balance + bal(after) - bal(before),
    entryCount: cur.entryCount + cnt(after) - cnt(before),
    lastDate: live(after) && after.date > cur.lastDate ? after.date : cur.lastDate,
  };
}

/** Totals computed from scratch (backfill and nightly verification). */
export function totalsOf(entries: readonly EntryState[]): RunningTotals {
  return entries.reduce<RunningTotals>((t, e) => nextTotals(t, null, e), ZERO_TOTALS);
}

/** Reads totals from an account document; null when not initialised yet. */
export function readTotals(d: Record<string, unknown>): RunningTotals | null {
  if (typeof d.balance !== 'number' || typeof d.entryCount !== 'number') return null;
  return {
    balance: d.balance,
    entryCount: d.entryCount,
    lastDate: typeof d.lastDate === 'string' ? d.lastDate : '',
  };
}
