import { displayDate, formatDateTime } from '../../../shared/lib/dates';
import { Logo } from '../../../shared/ui/Logo';
import type { Account } from '../../accounts/domain/types';
import type { Entry } from '../../ledger/domain/types';
import { confirmLabel, letterParts } from '../domain/confirmation';

/**
 * A4 «إقرار مطابقة رصيد» — approved form «٢ خطاب إقرار رسمي»: a letter
 * from the supplier/customer (its logo and name) to the payer, the balance
 * inside the text, then «وعلى ذلك جرى التوقيع» and the signer's block.
 */
export function ConfirmationPrint({
  account,
  entry,
  payerName,
}: {
  account: Pick<Account, 'name' | 'phone' | 'logo'>;
  entry: Entry;
  payerName: string;
}) {
  const p = letterParts({
    accountName: account.name,
    payerName,
    date: entry.date,
    balance: entry.confirmBalance ?? 0,
  });
  const no = confirmLabel(entry.confirmNo ?? 0);
  const sig = entry.signature;
  return (
    <article className="a4 single letter" dir="rtl">
      <header
        className="row-between"
        style={{ paddingBottom: 18, borderBottom: '2px solid var(--ink)', alignItems: 'center' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Logo data={account.logo} size={84} placeholder="" hideEmpty />
          <div>
            <div className="serif" style={{ fontSize: 28, lineHeight: 1.25 }}>
              {account.name}
            </div>
            {account.phone && (
              <div className="muted num" style={{ fontSize: 15, marginTop: 4 }}>
                {account.phone}
              </div>
            )}
          </div>
        </div>
        <div className="num" style={{ textAlign: 'left', fontSize: 15, lineHeight: 1.9 }}>
          <div>الرقم: {no}</div>
          <div>التاريخ: {displayDate(entry.date)}</div>
        </div>
      </header>

      <h1 className="serif" style={{ margin: '6mm 0 0', fontSize: 32, textAlign: 'center' }}>
        إقرار مطابقة رصيد
      </h1>

      <div className="letter-body">
        <p>
          السادة / <strong>{payerName}</strong>
        </p>
        <p>
          {p.opening}{' '}
          {p.amount ? (
            <>
              <strong className="num letter-amount">{p.amount}</strong> ({p.words}){' '}
              <strong>{p.side}</strong>، {p.closing}
            </>
          ) : (
            p.closing
          )}
        </p>
        {entry.details && <p>البيان: {entry.details}</p>}
        <p>وعلى ذلك جرى التوقيع.</p>
      </div>

      <section className="letter-sign">
        <div style={{ fontSize: 16, fontWeight: 600 }}>عن {account.name}</div>
        <div className="letter-sign-box">
          {sig?.image.startsWith('data:image/png;base64,') && (
            <img
              src={sig.image}
              alt={`توقيع ${sig.name}`}
              style={{ maxHeight: '100%', maxWidth: '100%' }}
            />
          )}
        </div>
        <div style={{ fontSize: 16 }}>
          الاسم: {sig ? sig.name : '................................................'}
        </div>
        {sig && sig.signedAtMs > 0 && (
          <div className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>
            وُقّع إلكترونياً عبر رابط مؤقت · {formatDateTime(sig.signedAtMs)}
          </div>
        )}
      </section>

      <footer
        className="row-between"
        style={{
          paddingTop: 14,
          borderTop: '1px solid var(--rule)',
          fontSize: 12,
          color: '#5e584c',
        }}
      >
        <span>{account.name}</span>
        <span className="num">إقرار مطابقة {no}</span>
      </footer>
    </article>
  );
}
