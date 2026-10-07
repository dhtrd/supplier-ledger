import type { SheetData } from 'write-excel-file/browser';
import { displayDate } from '../../../shared/lib/dates';
import { balanceSide, SIDE_LABEL } from '../../../shared/lib/money';
import type { Statement } from '../domain/statement';
import { ENTRY_LABEL, type Entry } from '../domain/types';

const MONEY = '#,##0.00';
const riyals = (h: number) => h / 100;

/**
 * Excel rows for a statement: oldest first, opening balance before the first
 * row, totals at the end (owner's decision). Pure, so it is unit-tested.
 */
export function statementSheet(accountName: string, s: Statement<Entry>): SheetData {
  const bold = { fontWeight: 'bold' as const };
  const money = (h: number, b = false) => ({
    value: riyals(h),
    type: Number,
    format: MONEY,
    ...(b ? bold : {}),
  });
  const side = (h: number) => SIDE_LABEL[balanceSide(h)];

  const rows: SheetData = [
    [{ value: `كشف حساب: ${accountName}`, ...bold, fontSize: 14 }],
    [`من ${displayDate(s.range.from)} إلى ${displayDate(s.range.to)}`],
    [],
    ['التاريخ', 'النوع', 'رقم السند', 'البيان', 'له', 'عليه', 'الرصيد', ''].map((h) => ({
      value: h,
      ...bold,
      backgroundColor: '#E4DDCC',
    })),
    [
      { value: displayDate(s.range.from), fontStyle: 'italic' as const },
      { value: 'رصيد افتتاحي', fontStyle: 'italic' as const },
      null,
      { value: 'الرصيد السابق قبل بداية الفترة', fontStyle: 'italic' as const },
      null,
      null,
      money(Math.abs(s.opening)),
      side(s.opening),
    ],
  ];
  for (const { entry: e, balance } of s.rows) {
    rows.push([
      displayDate(e.date),
      ENTRY_LABEL[e.type],
      e.voucherNo !== null ? { value: e.voucherNo, type: Number } : null,
      e.details,
      e.type === 'invoice' ? money(e.amount) : null,
      e.type === 'payment' ? money(e.amount) : null,
      money(Math.abs(balance)),
      side(balance),
    ]);
  }
  rows.push([
    { value: 'إجمالي الفترة', ...bold },
    null,
    null,
    null,
    money(s.totalLah, true),
    money(s.totalAlayh, true),
    money(Math.abs(s.closing), true),
    { value: side(s.closing), ...bold },
  ]);
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
): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  await writeXlsxFile(statementSheet(accountName, s), {
    sheet: 'كشف الحساب',
    rightToLeft: true,
    columns: [
      { width: 12 },
      { width: 9 },
      { width: 10 },
      { width: 40 },
      { width: 13 },
      { width: 13 },
      { width: 14 },
      { width: 7 },
    ],
    stickyRowsCount: 4,
  }).toFile(statementFileName(accountName, s));
}
