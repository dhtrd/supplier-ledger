import type { SheetData } from 'write-excel-file/browser';
import { displayDate } from '../../../shared/lib/dates';
import { balanceSide, SIDE_LABEL } from '../../../shared/lib/money';
import type { Statement } from '../domain/statement';
import { entryLabel, type Entry } from '../domain/types';
import { confirmLabel, confirmSummary } from '../../confirmations/domain/confirmation';

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
  opts: { balances: boolean },
): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  await writeXlsxFile(statementSheet(accountName, s, opts), {
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
