import type { SheetData } from 'write-excel-file/browser';
import { displayDate } from '../../../shared/lib/dates';
import { balanceSide, SIDE_LABEL } from '../../../shared/lib/money';
import type { Statement } from '../domain/statement';
import { entryLabel, type Entry } from '../domain/types';
import { confirmLabel, confirmSummary } from '../../confirmations/domain/confirmation';
import {
  columnTitle,
  sideWord,
  type ColumnId,
  type DocTemplate,
} from '../../templates/domain/template';

const MONEY = '#,##0.00';
const riyals = (h: number) => h / 100;

/**
 * Excel rows for a statement: oldest first, opening balance before the first
 * row, totals at the end (owner's decision). Pure, so it is unit-tested.
 */
export function statementSheet(
  accountName: string,
  s: Statement<Entry>,
  opts: { balances: boolean } = { balances: true },
): SheetData {
  const bold = { fontWeight: 'bold' as const };
  const money = (h: number, b = false) => ({
    value: riyals(h),
    type: Number,
    format: MONEY,
    ...(b ? bold : {}),
  });
  const side = (h: number) => SIDE_LABEL[balanceSide(h)];

  const head = ['التاريخ', 'النوع', 'رقم السند', 'البيان', 'له', 'عليه'];
  if (opts.balances) head.push('الرصيد', '');
  const rows: SheetData = [
    [{ value: `كشف حساب: ${accountName}`, ...bold, fontSize: 14 }],
    [`من ${displayDate(s.range.from)} إلى ${displayDate(s.range.to)}`],
    [],
    head.map((h) => ({
      value: h,
      ...bold,
      backgroundColor: '#E4DDCC',
    })),
  ];
  if (opts.balances)
    rows.push([
      { value: displayDate(s.range.from), fontStyle: 'italic' as const },
      { value: 'رصيد افتتاحي', fontStyle: 'italic' as const },
      null,
      { value: 'الرصيد السابق قبل بداية الفترة', fontStyle: 'italic' as const },
      null,
      null,
      money(Math.abs(s.opening)),
      side(s.opening),
    ]);
  for (const { entry: e, balance } of s.rows) {
    rows.push([
      displayDate(e.date),
      entryLabel(e),
      e.voucherNo !== null
        ? { value: e.voucherNo, type: Number }
        : e.confirmNo !== null
          ? confirmLabel(e.confirmNo)
          : null,
      e.type === 'confirm' ? confirmSummary(e) : e.details,
      e.type === 'invoice' ? money(e.amount) : null,
      e.type === 'payment' ? money(e.amount) : null,
      ...(opts.balances ? [money(Math.abs(balance)), side(balance)] : []),
    ]);
  }
  rows.push([
    { value: 'إجمالي الفترة', ...bold },
    null,
    null,
    null,
    money(s.totalLah, true),
    money(s.totalAlayh, true),
    ...(opts.balances
      ? [money(Math.abs(s.closing), true), { value: side(s.closing), ...bold }]
      : []),
  ]);
  return rows;
}

/**
 * Excel rows in the supplier's statement template: its title, its columns in
 * its order with its headings, and its side words (له/عليه or دائن/مدين).
 */
export function templatedSheet(
  accountName: string,
  s: Statement<Entry>,
  t: DocTemplate,
  opts: { balances: boolean },
): SheetData {
  const bold = { fontWeight: 'bold' as const };
  const money = (h: number, b = false) => ({
    value: riyals(h),
    type: Number,
    format: MONEY,
    ...(b ? bold : {}),
  });
  const side = (h: number) => sideWord(t, balanceSide(h));
  const cols = t.columns.filter((c) => c !== 'balance' || opts.balances);
  const head = cols.flatMap((c) =>
    c === 'balance' ? [columnTitle(t, c), ''] : [columnTitle(t, c)],
  );
  type Cell = SheetData[number][number];
  const line = (pick: (c: ColumnId) => Cell | [Cell, Cell]): Cell[] =>
    cols.flatMap((c) => {
      const v = pick(c);
      return c === 'balance' ? (Array.isArray(v) ? v : [v, null]) : [Array.isArray(v) ? v[0] : v];
    });
  const rows: SheetData = [
    [{ value: `${t.title}: ${accountName}`, ...bold, fontSize: 14 }],
    ...(t.sub ? [[t.sub]] : []),
    [`من ${displayDate(s.range.from)} إلى ${displayDate(s.range.to)}`],
    [],
    head.map((h) => ({ value: h, ...bold, backgroundColor: '#E4DDCC' })),
  ];
  if (opts.balances)
    rows.push(
      line((c) =>
        c === 'date'
          ? displayDate(s.range.from)
          : c === 'details'
            ? 'الرصيد السابق (رصيد افتتاحي)'
            : c === 'balance'
              ? [money(Math.abs(s.opening)), side(s.opening)]
              : null,
      ),
    );
  for (const { entry: e, balance } of s.rows)
    rows.push(
      line((c) => {
        switch (c) {
          case 'date':
            return displayDate(e.date);
          case 'type':
            return entryLabel(e);
          case 'no':
            return e.voucherNo !== null
              ? { value: e.voucherNo, type: Number }
              : e.confirmNo !== null
                ? confirmLabel(e.confirmNo)
                : null;
          case 'details':
            return e.type === 'confirm' ? confirmSummary(e) : e.details;
          case 'lah':
            return e.type === 'invoice' ? money(e.amount) : null;
          case 'alayh':
            return e.type === 'payment' ? money(e.amount) : null;
          case 'balance':
            return [money(Math.abs(balance)), side(balance)];
        }
      }),
    );
  rows.push(
    line((c) =>
      c === 'details'
        ? { value: 'إجمالي الفترة', ...bold }
        : c === 'lah'
          ? money(s.totalLah, true)
          : c === 'alayh'
            ? money(s.totalAlayh, true)
            : c === 'balance'
              ? [money(Math.abs(s.closing), true), { value: side(s.closing), ...bold }]
              : null,
    ),
  );
  if (t.foot) rows.push([], [t.foot]);
  return rows;
}

export function statementFileName(accountName: string, s: Pick<Statement<Entry>, 'range'>): string {
  const safe =
    accountName
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .trim()
      .slice(0, 60) || 'حساب';
  return `كشف ${safe} ${s.range.from} - ${s.range.to}.xlsx`;
}

export async function downloadStatementXlsx(
  accountName: string,
  s: Statement<Entry>,
  opts: { balances: boolean; template?: DocTemplate | null },
): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const data = opts.template
    ? templatedSheet(accountName, s, opts.template, opts)
    : statementSheet(accountName, s, opts);
  await writeXlsxFile(data, {
    sheet: 'كشف الحساب',
    rightToLeft: true,
    columns: opts.template
      ? undefined
      : [
          { width: 12 },
          { width: 9 },
          { width: 10 },
          { width: 40 },
          { width: 13 },
          { width: 13 },
          { width: 14 },
          { width: 7 },
        ],
    stickyRowsCount: opts.template ? undefined : 4,
  }).toFile(statementFileName(accountName, s));
}
