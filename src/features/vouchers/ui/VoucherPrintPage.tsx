import { useMemo, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useReady } from '../../../core/session';
import { ErrorBox, Loading } from '../../../core/Shell';
import { displayDate, formatDateTime, todayRiyadh } from '../../../shared/lib/dates';
import { balanceSide, formatAmount, SIDE_LABEL } from '../../../shared/lib/money';
import { amountInWords } from '../../../shared/lib/tafqit';
import { Icon } from '../../../shared/ui/Icon';
import { Logo } from '../../../shared/ui/Logo';
import { Money } from '../../../shared/ui/RiyalSign';
import { buildStatement, fullRange } from '../../ledger/domain/statement';
import { useLedger } from '../../ledger/ui/useLedger';
import { isCashPayment } from '../../ledger/domain/types';
import { ConfirmationPrint } from '../../confirmations/ui/ConfirmationPrint';
import { can } from '../../users/domain/types';
import './print.css';

export function PrintToolbar({ back, children }: { back: string; children?: ReactNode }) {
  return (
    <div className="print-toolbar no-print">
      <Link to={back} className="icon-btn" aria-label="رجوع">
        <Icon name="back" />
      </Link>
      <button type="button" className="btn btn-primary" onClick={() => window.print()}>
        <Icon name="print" size={20} />
        طباعة / حفظ PDF
      </button>
      {children}
    </div>
  );
}

/** A4 payment voucher, branded with the supplier/customer (approved mockup «VoucherA4»). */
export function VoucherPrintPage() {
  const { accountId = '', entryId = '' } = useParams();
  const { user, settings, profile } = useReady();
  const ledger = useLedger(accountId, user.uid);
  const entries = useMemo(() => (ledger.entries ?? []).map((s) => s.entry), [ledger.entries]);
  const statement = useMemo(
    () => buildStatement(entries, fullRange(entries, todayRiyadh())),
    [entries],
  );

  if (ledger.error) return <ErrorBox message={ledger.error} />;
  if (ledger.account === undefined || ledger.entries === undefined) return <Loading />;
  const account = ledger.account;
  const row = statement.rows.find((r) => r.entry.id === entryId);
  if (account && row?.entry.type === 'confirm')
    return (
      <>
        <PrintToolbar back={`/a/${accountId}`} />
        <div className="print-stage">
          <ConfirmationPrint account={account} entry={row.entry} payerName={settings.payerName} />
        </div>
      </>
    );
  if (!account || !row || !isCashPayment(row.entry)) return <ErrorBox message="السند غير موجود." />;
  const e = row.entry;
  const sig = e.signature;

  return (
    <>
      <PrintToolbar back={`/a/${accountId}`} />
      <div className="print-stage">
        <article className="a4 single" dir="rtl" style={{ gap: 32 }}>
          <header
            className="row-between"
            style={{ paddingBottom: 22, borderBottom: '2px solid var(--ink)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
              <Logo data={account.logo} size={96} placeholder="" hideEmpty />
              <div>
                <div className="serif" style={{ fontSize: 32, lineHeight: 1.25 }}>
                  {account.name}
                </div>
                {account.phone && (
                  <div className="muted num" style={{ fontSize: 16, marginTop: 4 }}>
                    {account.phone}
                  </div>
                )}
              </div>
            </div>
            <div className="serif" style={{ fontSize: 30 }}>
              سند استلام دفعة
            </div>
          </header>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 200px', gap: 32 }}>
            <main style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <p style={{ margin: 0, fontSize: 20, lineHeight: 1.9 }}>
                استلمنا دفعة من <strong>{settings.payerName}</strong> بمبلغ وقدره:
              </p>
              <div
                style={{
                  padding: '20px 24px',
                  border: '1px solid var(--ink)',
                  borderRadius: 12,
                  background: 'var(--paper)',
                }}
              >
                <div style={{ fontSize: 44, fontWeight: 600 }}>
                  <Money halalas={e.amount} />
                </div>
                <div style={{ fontSize: 20, fontWeight: 500, marginTop: 8 }}>
                  {amountInWords(e.amount)}
                </div>
              </div>
            </main>
            <aside
              style={{
                display: 'flex',
                flexDirection: 'column',
                fontSize: 15,
                borderInlineStart: '1px solid var(--rule)',
                paddingInlineStart: 20,
              }}
            >
              <Side label="رقم السند" value={<span className="num">{e.voucherNo}</span>} />
              <Side label="التاريخ" value={<span className="num">{displayDate(e.date)}</span>} />
              <Side
                label="البيان"
                value={e.details || '—'}
                plain
                last={!can.seeBalances(profile.role)}
              />
              {can.seeBalances(profile.role) && (
                <Side
                  label="الرصيد بعد السند"
                  value={
                    <span className="num">
                      {formatAmount(Math.abs(row.balance))} {SIDE_LABEL[balanceSide(row.balance)]}
                    </span>
                  }
                  last
                />
              )}
            </aside>
          </div>

          <section
            style={{
              marginTop: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              maxWidth: 380,
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 600 }}>توقيع المستلم</div>
            <div
              style={{
                height: 140,
                border: '1px solid var(--rule-strong)',
                borderRadius: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              }}
            >
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
            <span className="num">سند {e.voucherNo}</span>
          </footer>
        </article>
      </div>
    </>
  );
}

function Side({
  label,
  value,
  last,
  plain,
}: {
  label: string;
  value: ReactNode;
  last?: boolean;
  plain?: boolean;
}) {
  return (
    <div style={{ padding: '10px 0', borderBottom: last ? 0 : '1px solid var(--rule)' }}>
      <div className="muted" style={{ fontSize: 13 }}>
        {label}
      </div>
      <div style={{ fontWeight: plain ? 400 : 600, overflowWrap: 'anywhere' }}>{value}</div>
    </div>
  );
}
