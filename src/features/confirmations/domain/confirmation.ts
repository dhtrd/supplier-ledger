import { displayDate } from '../../../shared/lib/dates';
import { balanceSide, formatAmount, SIDE_LABEL } from '../../../shared/lib/money';
import { amountInWords } from '../../../shared/lib/tafqit';

/**
 * «إقرار مطابقة رصيد» (owner decision 2026-10-09): an entry with no effect on
 * the balance that states the balance up to its date; the supplier/customer
 * signs it through a WhatsApp link, like a payment voucher.
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

/** Number shown on screen and paper: «م-3». */
export function confirmLabel(no: number): string {
  return `م-${no}`;
}

/**
 * Wording from the signer's side (the supplier/customer speaks): a positive
 * balance (له) is owed to them — «لصالحنا»; negative (عليه) — «علينا».
 */
export function signerSide(balance: number): 'لصالحنا' | 'علينا' | null {
  if (balance > 0) return 'لصالحنا';
  if (balance < 0) return 'علينا';
  return null;
}

export interface LetterInput {
  accountName: string;
  payerName: string;
  date: string; // YYYY-MM-DD
  balance: number; // halalas, positive = له
}

/** The letter body (approved form «٢ خطاب إقرار رسمي»), as plain parts for layout. */
export function letterParts(v: LetterInput): {
  opening: string;
  amount: string | null;
  words: string | null;
  side: string | null;
  closing: string;
} {
  const side = signerSide(v.balance);
  const opening = `نقرّ نحن «${v.accountName}» بأننا راجعنا كشف حسابنا لديكم حتى تاريخ ${displayDate(v.date)}، ونقرّ بأن`;
  if (side === null)
    return {
      opening,
      amount: null,
      words: null,
      side: null,
      closing:
        'الحساب مسدَّد بالكامل ولا رصيد لأيٍّ من الطرفين في ذلك التاريخ، وأنه مطابق لما في سجلاتنا.',
    };
  return {
    opening: `${opening} الرصيد في ذلك التاريخ هو`,
    amount: `${formatAmount(Math.abs(v.balance))} ر.س`,
    words: amountInWords(Math.abs(v.balance)),
    side,
    closing: 'وأنه مطابق لما في سجلاتنا.',
  };
}

/** One-line text of the letter (WhatsApp, notifications, Excel). */
export function letterText(v: LetterInput): string {
  const p = letterParts(v);
  return p.amount
    ? `${p.opening} ${p.amount} (${p.words}) ${p.side}، ${p.closing}`
    : `${p.opening} ${p.closing}`;
}

/** WhatsApp text sent with a confirmation signing link. */
export function confirmLinkMessage(v: {
  payerName: string;
  confirmNo: number;
  accountName: string;
  balance: number;
  date: string;
  minutes: number;
  url: string;
}): string {
  const side = signerSide(v.balance);
  return [
    `إقرار مطابقة رصيد من ${v.payerName}`,
    `رقم الإقرار: ${confirmLabel(v.confirmNo)}`,
    `رصيد حسابكم حتى ${displayDate(v.date)}: ${
      side ? `${formatAmount(Math.abs(v.balance))} ريال ${side}` : 'مسدَّد (صفر)'
    }`,
    `للمراجعة والتوقيع بالإقرار (الرابط صالح ${v.minutes} دقيقة ولمرة واحدة):`,
    v.url,
  ].join('\n');
}

/**
 * State of a confirmation against the entries as they are now: 'changed' when
 * the balance up to its date is no longer what it states (owner decision:
 * keep it as signed, stamp it, notify the managers).
 */
export function confirmStatus(
  confirmBalance: number,
  date: string,
  entries: readonly DatedSigned[],
): { changed: boolean; current: number } {
  const current = balanceAt(entries, date);
  return { changed: current !== confirmBalance, current };
}

/**
 * Whether an entry change can move the balance on or before `through` (the
 * latest signed confirmation's date; '' = none). Mirrors firestore.rules.
 */
export function movesConfirmed(
  before: { signed: number; date: string } | null,
  after: { signed: number; date: string } | null,
  through: string,
): boolean {
  if (!through) return false;
  const o = before ?? { signed: 0, date: '' };
  const n = after ?? { signed: 0, date: '' };
  if (o.signed === 0 && n.signed === 0) return false;
  if (before && after && o.signed === n.signed && o.date === n.date) return false;
  return (!!before && o.date <= through) || (!!after && n.date <= through);
}

/** Statement / Excel text of a confirmation row: the stated balance, signed or not, and its note. */
export function confirmSummary(e: {
  confirmBalance: number | null;
  details: string;
  signature: { name: string } | null;
}): string {
  const b = e.confirmBalance ?? 0;
  const parts = [
    `الرصيد المُقرّ به ${formatAmount(Math.abs(b))} ${SIDE_LABEL[balanceSide(b)]}`,
    e.signature ? `موقّع من ${e.signature.name}` : 'بلا توقيع',
  ];
  if (e.details.trim()) parts.push(e.details.trim());
  return parts.join(' · ');
}
