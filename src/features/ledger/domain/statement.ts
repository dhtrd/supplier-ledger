import type { Range } from '../../../shared/lib/dates';

/** The minimum an entry needs for statement maths (keeps this module pure). */
export interface StatementInput {
  id: string;
  type: 'invoice' | 'payment' | 'note';
  amount: number;
  signed: number;
  date: string;
  /** Tie-breaker inside one day: original entry order (ms since epoch). */
  order: number;
  deleted: boolean;
}

export interface StatementRow<T extends StatementInput> {
  entry: T;
  /** Running balance after this entry, in halalas (positive = له). */
  balance: number;
}

export interface Statement<T extends StatementInput> {
  range: Range;
  /** Balance of everything strictly before range.from — the opening balance. */
  opening: number;
  closing: number;
  totalLah: number;
  totalAlayh: number;
  /** Chronological (oldest → newest), as accounting statements and exports require. */
  rows: StatementRow<T>[];
}

export function compareEntries(a: StatementInput, b: StatementInput): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.order !== b.order) return a.order - b.order;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Builds an account statement for a date range.
 * Deleted entries are ignored. Rows are chronological; the screen reverses
 * them for "newest first" while exports keep this order.
 */
export function buildStatement<T extends StatementInput>(
  entries: readonly T[],
  range: Range,
): Statement<T> {
  const live = entries
    .filter((e) => !e.deleted)
    .slice()
    .sort(compareEntries);
  let opening = 0;
  for (const e of live) if (e.date < range.from) opening += e.signed;

  let balance = opening;
  let totalLah = 0;
  let totalAlayh = 0;
  const rows: StatementRow<T>[] = [];
  for (const e of live) {
    if (e.date < range.from || e.date > range.to) continue;
    balance += e.signed;
    if (e.type === 'invoice') totalLah += e.amount;
    if (e.type === 'payment') totalAlayh += e.amount;
    rows.push({ entry: e, balance });
  }
  return { range, opening, closing: balance, totalLah, totalAlayh, rows };
}

/** Balance of all live entries (the account's current balance). */
export function accountBalance(entries: readonly StatementInput[]): number {
  return entries.reduce((sum, e) => (e.deleted ? sum : sum + e.signed), 0);
}

/** The whole history: first entry (or today) through the later of today and the last entry. */
export function fullRange(entries: readonly StatementInput[], today: string): Range {
  let from = today;
  let to = today;
  for (const e of entries) {
    if (e.deleted) continue;
    if (e.date < from) from = e.date;
    if (e.date > to) to = e.date;
  }
  return { from, to };
}
