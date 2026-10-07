import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import {
  balancesByAccount,
  mapAccounts,
  mapEntries,
  toHalalas,
  toIsoDate,
} from '../../scripts/migrate/legacy';
import { decode, encode } from '../../scripts/backup/snapshot';

const tx = (
  ID: number,
  cus_id: number,
  dir: string,
  out: string,
  date_: string,
  param2 = '10:00',
) => ({
  ID,
  cus_id,
  in: dir,
  out,
  date_,
  remarks: ` بيان ${ID} `,
  now_: '2026-09-01',
  param2,
});

describe('legacy migration mapping', () => {
  it('maps groups and keeps empty phones empty', () => {
    const a = mapAccounts([
      { ID: 27, name: 'نبيل سعد مهدي', gsm: '', g_id: 1 },
      { ID: 17, name: 'سداد مستحقات ', gsm: '0576173525', g_id: 0 },
    ]);
    expect(a.map((x) => [x.id, x.group, x.phone, x.name])).toEqual([
      ['L17', 'general', '0576173525', 'سداد مستحقات'],
      ['L27', 'suppliers', '', 'نبيل سعد مهدي'],
    ]);
  });
  it('maps invoices, payments and zero rows (notes) with signed halalas', () => {
    const e = mapEntries(
      [
        tx(1, 5, '1', '700.0', '23-04-2025'),
        tx(2, 5, '-1', '1500', '23-04-2025'),
        tx(3, 5, '-1', '0', '24-04-2025'),
      ],
      new Set([5]),
    );
    expect(e.map((x) => [x.type, x.amount, x.signed, x.date, x.voucherNo])).toEqual([
      ['invoice', 70000, 70000, '2025-04-23', undefined],
      ['payment', 150000, -150000, '2025-04-23', 2],
      ['note', 0, 0, '2025-04-24', undefined],
    ]);
    expect(e[0]?.details).toBe('بيان 1');
    expect(balancesByAccount(e).get('L5')).toBe(-80000);
  });
  it('keeps legacy entry order with strictly increasing timestamps', () => {
    const e = mapEntries(
      [tx(10, 5, '1', '5', '01-09-2026', '23:59'), tx(11, 5, '1', '5', '01-09-2026', '08:00')],
      new Set([5]),
    );
    expect(e[1]!.createdAtMs).toBeGreaterThan(e[0]!.createdAtMs);
  });
  it('fails loudly on bad data instead of guessing', () => {
    expect(() => toIsoDate('31-02-2026')).toThrow();
    expect(() => toHalalas('abc')).toThrow();
    expect(() => mapEntries([tx(1, 9, '1', '5', '01-01-2026')], new Set([5]))).toThrow(
      /unknown account/,
    );
    expect(() => mapEntries([tx(1, 5, '2', '5', '01-01-2026')], new Set([5]))).toThrow(/direction/);
  });
});

describe('backup snapshot encoding', () => {
  it('round-trips timestamps, bytes and nested values', () => {
    const v = {
      a: Timestamp.fromMillis(1_700_000_000_000),
      b: new Uint8Array([1, 2, 255]),
      c: [1, 'x', null],
      d: { e: true },
    };
    const back = decode(JSON.parse(JSON.stringify(encode(v)))) as typeof v;
    expect(back.a.toMillis()).toBe(1_700_000_000_000);
    expect(Array.from(back.b)).toEqual([1, 2, 255]);
    expect(back.c).toEqual([1, 'x', null]);
    expect(back.d).toEqual({ e: true });
  });
});
