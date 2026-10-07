/**
 * Maps a supplier statement kept in Excel (columns: التاريخ · رقم السند ·
 * التفاصيل · دفعات · فواتير · الرصيد) to ledger entries. Pure and unit-tested.
 *
 * Owner's rules (2026-10-07):
 *  - فواتير → invoice (له); دفعات → payment (عليه); both empty/0 → note.
 *  - A payment whose details mention «مرتجع» / «خصم» is marked as a return /
 *    discount (still a payment, but shown as such and never sent for signing).
 *  - «رقم السند» goes into the details (supplier invoice no. / old voucher
 *    no.); payments get NEW voucher numbers from the app's counter.
 *  - Row order is kept inside each day.
 */

export type ImportedEntry = {
  row: number;
  type: 'invoice' | 'payment' | 'note';
  subtype: 'return' | 'discount' | null;
  amount: number;
  signed: number;
  date: string;
  details: string;
};

export interface ParsedLedger {
  entries: ImportedEntry[];
  totalInvoices: number;
  totalPayments: number;
  /** Positive = له (we owe the supplier), in halalas. */
  balance: number;
  /** Checks against the totals/balance written in the sheet itself. */
  sheetTotals: { invoices: number | null; payments: number | null; balance: number | null };
}

const HEAD = {
  date: 'التاريخ',
  no: 'رقم السند',
  details: 'التفاصيل',
  pay: 'دفعات',
  inv: 'فواتير',
  bal: 'الرصيد',
};

function halalas(v: unknown, where: string): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0)
    throw new Error(`${where}: invalid amount ${JSON.stringify(v)}`);
  const h = Math.round(v * 100);
  if (Math.abs(h - v * 100) > 1e-6) throw new Error(`${where}: more than 2 decimals`);
  return h;
}

function isoDate(v: unknown, where: string): string {
  const d = v instanceof Date ? v : typeof v === 'string' ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime()))
    throw new Error(`${where}: invalid date ${JSON.stringify(v)}`);
  return d.toISOString().slice(0, 10);
}

const clean = (s: unknown) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');

export function parseLedgerSheet(rows: unknown[][]): ParsedLedger {
  const h = rows.findIndex(
    (r) => r.includes(HEAD.date) && r.includes(HEAD.pay) && r.includes(HEAD.inv),
  );
  if (h < 0) throw new Error('Header row (التاريخ / دفعات / فواتير) not found');
  const header = rows[h]!;
  const col = (name: string) => header.indexOf(name);
  const c = {
    date: col(HEAD.date),
    no: col(HEAD.no),
    details: col(HEAD.details),
    pay: col(HEAD.pay),
    inv: col(HEAD.inv),
    bal: col(HEAD.bal),
  };
  if (c.details < 0) throw new Error('Column التفاصيل not found');

  // Totals row above the header (e.g. «أرصدة المورد»), if present.
  const totalsRow = rows
    .slice(0, h)
    .find((r) => typeof r[c.pay] === 'number' && typeof r[c.inv] === 'number');

  const entries: ImportedEntry[] = [];
  let lastBalance: number | null = null;
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i]!;
    const where = `row ${i + 1}`;
    const empty = [c.date, c.details, c.pay, c.inv].every(
      (k) => r[k] === null || r[k] === undefined || r[k] === '',
    );
    if (empty) continue;
    const date = isoDate(r[c.date], where);
    const pay = halalas(r[c.pay], where);
    const inv = halalas(r[c.inv], where);
    const no =
      c.no >= 0 && typeof r[c.no] === 'number' && (r[c.no] as number) > 0
        ? (r[c.no] as number)
        : null;
    const text = clean(r[c.details]);
    if (pay > 0 && inv > 0) throw new Error(`${where}: both دفعات and فواتير are filled`);
    if (c.bal >= 0 && typeof r[c.bal] === 'number') lastBalance = r[c.bal] as number;
    let e: ImportedEntry;
    if (inv > 0) {
      e = {
        row: i + 1,
        type: 'invoice',
        subtype: null,
        amount: inv,
        signed: inv,
        date,
        details: no ? `${text} — رقم ${no}` : text,
      };
    } else if (pay > 0) {
      const subtype = /مرتجع/.test(text) ? 'return' : /خصم/.test(text) ? 'discount' : null;
      e = {
        row: i + 1,
        type: 'payment',
        subtype,
        amount: pay,
        signed: -pay,
        date,
        details: no ? `${text} — رقم سابق ${no}` : text,
      };
    } else {
      e = {
        row: i + 1,
        type: 'note',
        subtype: null,
        amount: 0,
        signed: 0,
        date,
        details: text || 'ملاحظة',
      };
    }
    if (e.details.length > 500) throw new Error(`${where}: details longer than 500 characters`);
    entries.push(e);
  }
  const totalInvoices = entries.reduce((s, e) => s + (e.type === 'invoice' ? e.amount : 0), 0);
  const totalPayments = entries.reduce((s, e) => s + (e.type === 'payment' ? e.amount : 0), 0);
  return {
    entries,
    totalInvoices,
    totalPayments,
    balance: totalInvoices - totalPayments,
    sheetTotals: {
      invoices: totalsRow ? halalas(totalsRow[c.inv], 'totals') : null,
      payments: totalsRow ? halalas(totalsRow[c.pay], 'totals') : null,
      // The sheet shows له as a negative balance (payments − invoices).
      balance: lastBalance === null ? null : Math.round(-lastBalance * 100),
    },
  };
}

/** Throws unless every figure the sheet states matches what was parsed. */
export function verifyAgainstSheet(p: ParsedLedger): void {
  const s = p.sheetTotals;
  if (s.invoices !== null && s.invoices !== p.totalInvoices)
    throw new Error(`Invoice total mismatch: sheet ${s.invoices}, parsed ${p.totalInvoices}`);
  if (s.payments !== null && s.payments !== p.totalPayments)
    throw new Error(`Payment total mismatch: sheet ${s.payments}, parsed ${p.totalPayments}`);
  if (s.balance !== null && s.balance !== p.balance)
    throw new Error(`Balance mismatch: sheet ${s.balance}, parsed ${p.balance}`);
}
