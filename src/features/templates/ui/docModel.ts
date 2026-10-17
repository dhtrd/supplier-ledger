import { displayDate } from '../../../shared/lib/dates';
import { balanceSide, formatAmount } from '../../../shared/lib/money';
import { amountInWords } from '../../../shared/lib/tafqit';
import { confirmLabel, confirmSummary, signerSide } from '../../confirmations/domain/confirmation';
import type { Statement } from '../../ledger/domain/statement';
import { entryLabel, type Entry } from '../../ledger/domain/types';
import { sideWord, type DocTemplate } from '../domain/template';
import type { ConfirmDoc } from './ConfirmTemplate';
import type { DocAccount } from './parts';
import type { StatementDoc } from './StatementTemplate';
import type { VoucherDoc } from './VoucherTemplate';

const sar = (h: number) => `${formatAmount(Math.abs(h))} ر.س`;

export function voucherDoc(
  account: DocAccount,
  e: Entry,
  payerName: string,
  balanceAfter: string | null,
): VoucherDoc {
  return {
    account,
    payerName,
    amount: sar(e.amount),
    amountNum: formatAmount(e.amount),
    words: amountInWords(e.amount),
    no: String(e.voucherNo ?? ''),
    date: displayDate(e.date),
    details: e.details.trim(),
    signature: e.signature,
    balanceAfter,
  };
}

export function confirmDoc(account: DocAccount, e: Entry, payerName: string): ConfirmDoc {
  const b = e.confirmBalance ?? 0;
  return {
    account,
    payerName,
    balance: sar(b),
    balanceNum: formatAmount(Math.abs(b)),
    words: amountInWords(Math.abs(b)),
    side: signerSide(b) ?? '',
    no: confirmLabel(e.confirmNo ?? 0),
    date: displayDate(e.date),
    details: e.details.trim(),
    signature: e.signature,
  };
}

export function statementDoc(
  account: DocAccount,
  s: Statement<Entry>,
  t: DocTemplate,
  showBalances: boolean,
): StatementDoc {
  const withSide = (h: number) => `${formatAmount(Math.abs(h))} ${sideWord(t, balanceSide(h))}`;
  return {
    account,
    from: displayDate(s.range.from),
    to: displayDate(s.range.to),
    rows: s.rows.map(({ entry: e, balance }) => ({
      id: e.id,
      date: displayDate(e.date),
      type: entryLabel(e),
      no:
        e.voucherNo !== null
          ? String(e.voucherNo)
          : e.confirmNo !== null
            ? confirmLabel(e.confirmNo)
            : '',
      details: e.type === 'confirm' ? confirmSummary(e) : e.details,
      lah: e.type === 'invoice' ? formatAmount(e.amount) : '',
      alayh: e.type === 'payment' ? formatAmount(e.amount) : '',
      balance: withSide(balance),
    })),
    opening: showBalances ? withSide(s.opening) : null,
    closing: showBalances ? withSide(s.closing) : null,
    totalLah: formatAmount(s.totalLah),
    totalAlayh: formatAmount(s.totalAlayh),
  };
}
