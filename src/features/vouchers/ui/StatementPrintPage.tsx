import { useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useReady } from '../../../core/session';
import { ErrorBox, Loading } from '../../../core/Shell';
import { displayDate, isIsoDate, normalizeRange, todayRiyadh } from '../../../shared/lib/dates';
import { balanceSide, formatAmount, SIDE_LABEL } from '../../../shared/lib/money';
import { Logo } from '../../../shared/ui/Logo';
import { Money } from '../../../shared/ui/RiyalSign';
import { GROUP_LABEL } from '../../accounts/domain/types';
import { buildStatement, fullRange } from '../../ledger/domain/statement';
import { entryLabel } from '../../ledger/domain/types';
import { can } from '../../users/domain/types';
import { confirmLabel, confirmSummary } from '../../confirmations/domain/confirmation';
import { useLedger } from '../../ledger/ui/useLedger';
import { PrintToolbar } from './VoucherPrintPage';
import './print.css';

/** Statement for print / «Save as PDF»: oldest first with the opening balance (owner's rule for exports). */
export function StatementPrintPage() {
  const { accountId = '' } = useParams();
  const [params] = useSearchParams();
  const { user, profile } = useReady();
  const showBalances = can.seeBalances(profile.role);
  const ledger = useLedger(accountId, user.uid);
  const entries = useMemo(() => (ledger.entries ?? []).map((s) => s.entry), [ledger.entries]);
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const statement = useMemo(() => {
    const range =
      isIsoDate(from) && isIsoDate(to)
        ? normalizeRange({ from, to })
        : fullRange(entries, todayRiyadh());
    return buildStatement(entries, range);
  }, [entries, from, to]);

  if (ledger.error) return <ErrorBox message={ledger.error} />;
  if (ledger.account === undefined || ledger.entries === undefined) return <Loading />;
  const account = ledger.account;
  if (!account) return <ErrorBox message="الحساب غير موجود." />;
  const side = (h: number) => SIDE_LABEL[balanceSide(h)];

  return (
    <>
      <PrintToolbar
        back={`/a/${accountId}?from=${statement.range.from}&to=${statement.range.to}`}
      />
      <div className="print-stage">
        <article className="a4" dir="rtl">
          <header
            className="row-between"
            style={{ paddingBottom: 14, borderBottom: '2px solid var(--ink)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <Logo data={account.logo} size={64} placeholder="" hideEmpty />
              <div>
                <div className="serif" style={{ fontSize: 26, lineHeight: 1.25 }}>
                  {account.name}
                </div>
                <div className="muted num" style={{ fontSize: 13 }}>
                  {GROUP_LABEL[account.group]}
                  {account.phone && ` · ${account.phone}`}
                </div>
              </div>
            </div>
            <div style={{ textAlign: 'left' }}>
              <div className="serif" style={{ fontSize: 22 }}>
                كشف حساب
              </div>
              <div className="muted num" style={{ fontSize: 13 }}>
                من {displayDate(statement.range.from)} إلى {displayDate(statement.range.to)}
              </div>
            </div>
          </header>

          <table>
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>النوع</th>
                <th>البيان</th>
                <th className="n">له</th>
                <th className="n">عليه</th>
                {showBalances && <th className="n">الرصيد</th>}
              </tr>
            </thead>
            <tbody>
              {showBalances && (
                <tr style={{ fontStyle: 'italic', background: 'var(--band)' }}>
                  <td>{displayDate(statement.range.from)}</td>
                  <td>افتتاحي</td>
                  <td>الرصيد السابق قبل بداية الفترة</td>
                  <td className="n" />
                  <td className="n" />
                  <td className="n">
                    {formatAmount(Math.abs(statement.opening))} {side(statement.opening)}
                  </td>
                </tr>
              )}
              {statement.rows.map(({ entry: e, balance }) => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{displayDate(e.date)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {entryLabel(e)}
                    {e.voucherNo !== null && ` ${e.voucherNo}`}
                    {e.confirmNo !== null && ` ${confirmLabel(e.confirmNo)}`}
                    {e.signature && ' ✓'}
                  </td>
                  <td style={{ overflowWrap: 'anywhere' }}>
                    {e.type === 'confirm' ? confirmSummary(e) : e.details}
                  </td>
                  <td className="n" style={{ color: 'var(--lah)' }}>
                    {e.type === 'invoice' ? formatAmount(e.amount) : ''}
                  </td>
                  <td className="n" style={{ color: 'var(--alayh)' }}>
                    {e.type === 'payment' ? formatAmount(e.amount) : ''}
                  </td>
                  {showBalances && (
                    <td className="n" style={{ fontWeight: 600 }}>
                      {formatAmount(Math.abs(balance))} {side(balance)}
                    </td>
                  )}
                </tr>
              ))}
              <tr style={{ fontWeight: 600 }}>
                <td colSpan={3} style={{ borderTop: '2px solid var(--ink)' }}>
                  إجمالي الفترة ({statement.rows.length} عملية)
                </td>
                <td
                  className="n"
                  style={{ borderTop: '2px solid var(--ink)', color: 'var(--lah)' }}
                >
                  {formatAmount(statement.totalLah)}
                </td>
                <td
                  className="n"
                  style={{ borderTop: '2px solid var(--ink)', color: 'var(--alayh)' }}
                >
                  {formatAmount(statement.totalAlayh)}
                </td>
                {showBalances && (
                  <td className="n" style={{ borderTop: '2px solid var(--ink)' }}>
                    {formatAmount(Math.abs(statement.closing))} {side(statement.closing)}
                  </td>
                )}
              </tr>
            </tbody>
          </table>

          {showBalances && (
            <div
              className="row-between"
              style={{ alignItems: 'baseline', borderTop: '1px solid var(--rule)', paddingTop: 10 }}
            >
              <span className="muted" style={{ fontSize: 13 }}>
                الرصيد في نهاية الفترة
              </span>
              <span style={{ fontSize: 22, fontWeight: 600 }}>
                <Money halalas={statement.closing} abs /> {side(statement.closing)}
              </span>
            </div>
          )}
        </article>
      </div>
    </>
  );
}
