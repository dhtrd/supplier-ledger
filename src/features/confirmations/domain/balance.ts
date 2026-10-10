/**
 * Balance-at-date maths for balance confirmations. Kept free of imports on
 * purpose: the Node scripts (nightly backup) load it directly, and Node only
 * resolves relative imports that carry their file extension.
 */

/** The minimum needed for balance-at-date maths. */
export interface DatedSigned {
  date: string;
  signed: number;
  deleted: boolean;
}

/** Balance at the end of `date`: every live entry dated on or before it. */
export function balanceAt(entries: readonly DatedSigned[], date: string): number {
  let sum = 0;
  for (const e of entries) if (!e.deleted && e.date <= date) sum += e.signed;
  return sum;
}
