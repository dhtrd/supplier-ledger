import { formatAmount } from '../../../shared/lib/money';
import { amountInWords } from '../../../shared/lib/tafqit';
import { sideWord, type DocTemplate } from '../domain/template';
import type { ConfirmDoc } from './ConfirmTemplate';
import type { DocAccount } from './parts';
import type { StatementDoc } from './StatementTemplate';
import type { VoucherDoc } from './VoucherTemplate';

/**
 * Example documents for the editor preview: the account's real name, phone
 * and logo with example figures (no ledger is read to show a preview).
 */
const SAMPLE_DATE = '2026/10/15';
const sar = (h: number) => `${formatAmount(h)} ر.س`;

export function sampleVoucher(account: DocAccount, payerName: string): VoucherDoc {
  const h = 500_000;
  return {
    account,
    payerName,
    amount: sar(h),
    amountNum: formatAmount(h),
    words: amountInWords(h),
    no: '128',
    date: SAMPLE_DATE,
    details: 'دفعة من حساب فواتير شهر سبتمبر',
    signature: null,
    balanceAfter: `${formatAmount(1_266_000)} له`,
  };
}

export function sampleConfirm(account: DocAccount, payerName: string): ConfirmDoc {
  const h = 1_266_000;
  return {
    account,
    payerName,
    balance: sar(h),
    balanceNum: formatAmount(h),
    words: amountInWords(h),
    side: 'لصالحنا',
    no: 'م-7',
    date: SAMPLE_DATE,
    details: '',
    signature: null,
  };
}

/** [date, type, no, details, +invoice / −payment] — balances follow. */
const ROWS: [string, string, string, string, number][] = [
  ['2026/10/02', 'فاتورة', '', 'توريد مواد — فاتورة 4471', 850_000],
  ['2026/10/05', 'دفعة', '121', 'دفعة نقدية', -300_000],
  ['2026/10/09', 'فاتورة', '', 'توريد مواد — فاتورة 4502', 616_000],
  ['2026/10/12', 'دفعة', '', 'مرتجع بضاعة', -100_000],
  ['2026/10/15', 'دفعة', '128', 'دفعة من حساب فواتير شهر سبتمبر', -500_000],
];

export function sampleStatement(account: DocAccount, t: DocTemplate): StatementDoc {
  const withSide = (h: number) =>
    `${formatAmount(Math.abs(h))} ${sideWord(t, h > 0 ? 'lah' : h < 0 ? 'alayh' : 'settled')}`;
  const opening = 700_000;
  let bal = opening;
  let lah = 0;
  let alayh = 0;
  const rows = ROWS.map(([date, type, no, details, signed], i) => {
    bal += signed;
    if (signed > 0) lah += signed;
    else alayh -= signed;
    return {
      id: String(i),
      date,
      type,
      no,
      details,
      lah: signed > 0 ? formatAmount(signed) : '',
      alayh: signed < 0 ? formatAmount(-signed) : '',
      balance: withSide(bal),
    };
  });
  return {
    account,
    from: '2026/10/01',
    to: '2026/10/15',
    rows,
    opening: withSide(opening),
    closing: withSide(bal),
    totalLah: formatAmount(lah),
    totalAlayh: formatAmount(alayh),
  };
}
