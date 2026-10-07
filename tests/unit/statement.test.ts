import { describe, expect, it } from 'vitest';
import {
  accountBalance,
  buildStatement,
  type StatementInput,
} from '../../src/features/ledger/domain/statement';

// Real rows from مفروشات الجيزاني (old دفتر الحسابات), amounts in halalas.
// Everything before 2026-08-15 is collapsed into one opening invoice of 5,600.
let order = 0;
const e = (
  date: string,
  type: StatementInput['type'],
  riyals: number,
  deleted = false,
): StatementInput => {
  const amount = riyals * 100;
  const signed = type === 'invoice' ? amount : type === 'payment' ? -amount : 0;
  return { id: `e${++order}`, type, amount, signed, date, order, deleted };
};
const ROWS: StatementInput[] = [
  e('2026-08-01', 'invoice', 5600),
  e('2026-08-15', 'payment', 1700),
  e('2026-08-25', 'payment', 1500),
  e('2026-09-01', 'invoice', 1150),
  e('2026-09-01', 'payment', 2000),
  e('2026-09-05', 'invoice', 1550),
  e('2026-09-05', 'payment', 1500),
  e('2026-09-15', 'invoice', 7100),
  e('2026-09-15', 'payment', 5000),
  e('2026-09-16', 'invoice', 4050),
  e('2026-09-16', 'note', 0),
  e('2026-09-17', 'invoice', 9999, true), // deleted → ignored
];

describe('buildStatement', () => {
  it('reproduces the old app balance (7,750 له) and period totals', () => {
    const s = buildStatement(ROWS, { from: '2026-08-15', to: '2026-09-16' });
    expect(s.opening).toBe(560000);
    expect(s.totalLah).toBe(1385000);
    expect(s.totalAlayh).toBe(1170000);
    expect(s.closing).toBe(775000);
    expect(s.opening + s.totalLah - s.totalAlayh).toBe(s.closing);
  });
  it('uses everything before the range as the opening balance', () => {
    const s = buildStatement(ROWS, { from: '2026-09-05', to: '2026-09-30' });
    expect(s.opening).toBe(155000); // 5600 − 1700 − 1500 + 1150 − 2000
    expect(s.rows.map((r) => r.balance / 100)).toEqual([3100, 1600, 8700, 3700, 7750, 7750]);
  });
  it('keeps same-day entries in entry order and stays chronological', () => {
    const s = buildStatement([...ROWS].reverse(), { from: '2026-09-01', to: '2026-09-01' });
    expect(s.rows.map((r) => r.entry.type)).toEqual(['invoice', 'payment']);
  });
  it('an empty range returns opening = closing and no rows', () => {
    const s = buildStatement(ROWS, { from: '2027-01-01', to: '2027-01-31' });
    expect(s.rows).toHaveLength(0);
    expect(s.opening).toBe(s.closing);
    expect(s.closing).toBe(775000);
  });
  it('ignores deleted entries in the account balance', () => {
    expect(accountBalance(ROWS)).toBe(775000);
  });
});
