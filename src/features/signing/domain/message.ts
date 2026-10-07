import { displayDate } from '../../../shared/lib/dates';
import { formatAmount } from '../../../shared/lib/money';

/**
 * WhatsApp text sent with a signing link (owner decision): voucher number,
 * amount, date, then the link on its own line.
 */
export function signLinkMessage(v: {
  payerName: string;
  voucherNo: number;
  amount: number; // halalas
  date: string; // YYYY-MM-DD
  minutes: number;
  url: string;
}): string {
  return [
    `سند دفعة من ${v.payerName}`,
    `رقم السند: ${v.voucherNo}`,
    `المبلغ: ${formatAmount(v.amount)} ريال`,
    `التاريخ: ${displayDate(v.date)}`,
    `للإقرار بالاستلام والتوقيع (الرابط صالح ${v.minutes} دقيقة ولمرة واحدة):`,
    v.url,
  ].join('\n');
}
