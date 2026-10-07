import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { errorMessage, reportError } from '../../../core/errors';
import { useReady } from '../../../core/session';
import { ErrorBox, Loading } from '../../../core/Shell';
import {
  displayDate,
  isIsoDate,
  normalizeRange,
  todayRiyadh,
  type Range,
} from '../../../shared/lib/dates';
import { balanceSide, formatAmount, SIDE_LABEL } from '../../../shared/lib/money';
import { CalendarSheet } from '../../../shared/ui/Calendar';
import { useDesktop, useNow } from '../../../shared/ui/hooks';
import { Icon } from '../../../shared/ui/Icon';
import { Logo } from '../../../shared/ui/Logo';
import { Money } from '../../../shared/ui/RiyalSign';
import { Sheet } from '../../../shared/ui/Sheet';
import { useToast } from '../../../shared/ui/Toast';
import { fb } from '../../../core/firebase';
import { setAccountDeleted, setArchived } from '../../accounts/data/accountsRepo';
import { GROUP_LABEL } from '../../accounts/domain/types';
import { can } from '../../users/domain/types';
import type { EntrySnapshot } from '../data/entriesRepo';
import { accountBalance, buildStatement, fullRange } from '../domain/statement';
import { entryLabel, isCashPayment, SUBTYPE_LABEL, type Entry } from '../domain/types';
import { downloadStatementXlsx } from '../export/statementSheet';
import { EntrySheet } from './EntrySheet';
import { signStateOf } from './signState';
import { useLedger } from './useLedger';

type Filter = 'all' | 'invoice' | 'payment' | 'unsigned';

export function StatementPage() {
  const { id = '' } = useParams();
  const { user, profile } = useReady();
  const ledger = useLedger(id, user.uid);
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>('all');
  const [rangeOpen, setRangeOpen] = useState(false);
  // ?e=<entryId> opens that entry (links from the notifications tab), also
  // when the statement is already on screen.
  const eParam = params.get('e');
  const [selected, setSelected] = useState<string | null>(eParam);
  const [seenE, setSeenE] = useState(eParam);
  if (eParam !== seenE) {
    setSeenE(eParam);
    if (eParam) setSelected(eParam);
  }
  const [exporting, setExporting] = useState(false);
  const [archiveAsk, setArchiveAsk] = useState(false);
  const [deleteAsk, setDeleteAsk] = useState(false);
  const [archBusy, setArchBusy] = useState(false);
  const desktop = useDesktop();
  const now = useNow();
  const toast = useToast();
  const navigate = useNavigate();
  const today = todayRiyadh();

  const entries = useMemo(() => (ledger.entries ?? []).map((s) => s.entry), [ledger.entries]);
  const all = useMemo(() => fullRange(entries, today), [entries, today]);
  const pFrom = params.get('from') ?? '';
  const pTo = params.get('to') ?? '';
  const range: Range = useMemo(
    () => (isIsoDate(pFrom) && isIsoDate(pTo) ? normalizeRange({ from: pFrom, to: pTo }) : all),
    [pFrom, pTo, all],
  );
  const statement = useMemo(() => buildStatement(entries, range), [entries, range]);

  if (ledger.account?.archived && !can.archiveAccounts(profile.role))
    return <ErrorBox message="هذا الحساب مؤرشف. راجع الإدارة لإعادته." />;
  if (ledger.error) return <ErrorBox message={ledger.error} />;
  if (ledger.account === undefined || ledger.entries === undefined) return <Loading />;
  if (ledger.account === null)
    return <ErrorBox message="الحساب غير موجود أو لا تملك صلاحية عليه." />;
  const account = ledger.account;

  const showBalances = can.seeBalances(profile.role);
  // Owner decision: only vouchers recorded in this app are marked (migrated
  // ones were settled in the old app).
  const unsigned = (e: Entry) =>
    isCashPayment(e) && !e.legacy && signStateOf(e, ledger.links, now).kind !== 'signed';
  const unsignedCount = statement.rows.filter((r) => unsigned(r.entry)).length;
  const shown = statement.rows.filter((r) =>
    filter === 'all' ? true : filter === 'unsigned' ? unsigned(r.entry) : r.entry.type === filter,
  );
  const newestFirst = [...shown].reverse();
  const closingSide = balanceSide(statement.closing);
  const sideColor =
    closingSide === 'lah'
      ? 'var(--lah)'
      : closingSide === 'alayh'
        ? 'var(--alayh)'
        : 'var(--muted)';
  const rangeQuery = `from=${range.from}&to=${range.to}`;
  const selectedSnap: EntrySnapshot | undefined = ledger.entries.find(
    (s) => s.entry.id === selected,
  );

  const exportXlsx = async () => {
    setExporting(true);
    try {
      await downloadStatementXlsx(account.name, statement, { balances: showBalances });
      toast.info(
        showBalances
          ? 'صُدِّر الكشف إلى Excel (الأقدم أولاً مع الرصيد الافتتاحي).'
          : 'صُدِّر الكشف إلى Excel (الأقدم أولاً).',
      );
    } catch (e) {
      reportError('xlsx', e);
      toast.error(`تعذّر التصدير: ${errorMessage(e)}`);
    } finally {
      setExporting(false);
    }
  };

  const fullBalance = accountBalance(entries);
  const toggleArchive = async (archived: boolean) => {
    setArchBusy(true);
    try {
      await setArchived(fb().db, user.uid, account, archived);
      toast.info(
        archived
          ? `أُرشف «${account.name}». تجده في «المؤرشفة» أسفل قائمة الحسابات.`
          : `أُعيد «${account.name}» إلى قائمة الحسابات.`,
      );
      setArchiveAsk(false);
    } catch (e) {
      reportError('archive', e);
      toast.error(errorMessage(e));
    } finally {
      setArchBusy(false);
    }
  };

  const toggleDeleted = async (deleted: boolean) => {
    setArchBusy(true);
    try {
      await setAccountDeleted(fb().db, user.uid, account, deleted, profile.name);
      setDeleteAsk(false);
      if (deleted) {
        toast.info(`نُقل «${account.name}» إلى سلة المهملات. يُسترجع من الإعدادات ← سلة المهملات.`);
        navigate('/', { replace: true });
      } else toast.info(`استُرجع «${account.name}» إلى قائمة الحسابات.`);
    } catch (e) {
      reportError('account-trash', e);
      toast.error(errorMessage(e));
    } finally {
      setArchBusy(false);
    }
  };

  /** Approved design «ب»: a small stamp beside the voucher number. */
  const stamp = (e: Entry) => {
    if (!isCashPayment(e) || e.legacy) return null;
    return signStateOf(e, ledger.links, now).kind === 'signed' ? (
      <span className="stamp stamp-ok">موقّع</span>
    ) : (
      <span className="stamp stamp-no">بلا توقيع</span>
    );
  };

  const signCell = (e: Entry) => {
    const st = signStateOf(e, ledger.links, now);
    if (!isCashPayment(e)) return null;
    if (st.kind === 'signed') return null; // shown as the «موقّع» stamp
    if (st.kind === 'pending')
      return (
        <span style={{ fontSize: 13, color: 'var(--warn)' }}>
          بانتظار التوقيع · {st.minutesLeft} د
        </span>
      );
    // Migrated vouchers were settled in the old app: no button clutter, but
    // they can still be sent from the entry sheet.
    if (e.legacy) return null;
    return (
      <button
        type="button"
        className="btn btn-sm"
        onClick={(ev) => {
          ev.stopPropagation();
          setSelected(e.id);
        }}
      >
        إرسال للتوقيع
      </button>
    );
  };

  return (
    <>
      <div className="row-between no-print" style={{ padding: '8px 8px 0' }}>
        <Link to="/" className="icon-btn" aria-label="رجوع إلى الحسابات">
          <Icon name="back" />
        </Link>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {can.manageAccounts(profile.role) && (
            <Link
              to={`/a/${id}/edit`}
              className="btn-link"
              style={{ fontSize: 14, display: 'inline-flex', alignItems: 'center' }}
            >
              تعديل الحساب
            </Link>
          )}
          {can.archiveAccounts(profile.role) && !account.archived && (
            <button
              type="button"
              className="btn-link"
              style={{ fontSize: 14 }}
              onClick={() => setArchiveAsk(true)}
            >
              أرشفة
            </button>
          )}
          {can.archiveAccounts(profile.role) && !account.deleted && (
            <button
              type="button"
              className="btn-link"
              style={{ fontSize: 14, color: 'var(--alayh)' }}
              onClick={() => setDeleteAsk(true)}
            >
              حذف الحساب
            </button>
          )}
          <button
            type="button"
            className="btn-link"
            style={{ fontSize: 14 }}
            onClick={exportXlsx}
            disabled={exporting}
          >
            {exporting ? 'جارٍ…' : 'Excel'}
          </button>
          <Link
            to={`/print/statement/${id}?${rangeQuery}`}
            className="btn-link"
            style={{ fontSize: 14, display: 'inline-flex', alignItems: 'center' }}
          >
            PDF
          </Link>
        </div>
      </div>

      {account.deleted && (
        <div
          className="banner banner-err no-print"
          role="status"
          style={{ margin: '8px var(--gutter)' }}
        >
          هذا الحساب في سلة المهملات ولا يظهر في القائمة.{' '}
          {can.restoreFromTrash(profile.role) && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void toggleDeleted(false)}
              disabled={archBusy}
            >
              {archBusy ? 'جارٍ…' : 'استرجاعه'}
            </button>
          )}
        </div>
      )}
      {account.archived && (
        <div
          className="banner banner-warn no-print"
          role="status"
          style={{ margin: '8px var(--gutter)' }}
        >
          هذا الحساب مؤرشف ولا يظهر في قائمة الحسابات.{' '}
          {can.archiveAccounts(profile.role) && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void toggleArchive(false)}
              disabled={archBusy}
            >
              {archBusy ? 'جارٍ…' : 'إعادته إلى القائمة'}
            </button>
          )}
        </div>
      )}
      <section style={{ padding: '4px var(--gutter) 14px', borderBottom: '2px solid var(--ink)' }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <Logo data={account.logo} size={desktop ? 72 : 52} />
            <div style={{ minWidth: 0 }}>
              <h1
                className="serif"
                style={{ margin: 0, fontSize: desktop ? 36 : 26, lineHeight: 1.25 }}
              >
                {account.name}
              </h1>
              <div className="muted num" style={{ fontSize: 13 }}>
                {GROUP_LABEL[account.group]}
                {account.phone && ` · ${account.phone}`} · {entries.length} عملية
              </div>
            </div>
          </div>
          {showBalances && (
            <div style={{ textAlign: 'left', marginInlineStart: 'auto' }}>
              <div className="muted" style={{ fontSize: 14 }}>
                الرصيد في نهاية الفترة
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 8,
                  justifyContent: 'flex-end',
                }}
              >
                <span style={{ fontSize: desktop ? 40 : 30, fontWeight: 600, color: sideColor }}>
                  <Money halalas={statement.closing} abs />
                </span>
                <span className="side-badge" style={{ color: sideColor }}>
                  {SIDE_LABEL[closingSide]}
                </span>
              </div>
            </div>
          )}
        </div>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            marginTop: 12,
            alignItems: 'center',
          }}
        >
          <button
            type="button"
            className="picker-btn"
            style={{ flex: '1 1 280px', maxWidth: desktop ? 360 : undefined, minHeight: 48 }}
            onClick={() => setRangeOpen(true)}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="calendar" size={20} />
              <span className="num" style={{ fontWeight: 500 }}>
                من {displayDate(range.from)} إلى {displayDate(range.to)}
              </span>
            </span>
            <span className="muted" style={{ fontSize: 13 }}>
              تغيير
            </span>
          </button>
          <div className="pills" role="group" aria-label="تصفية العمليات">
            {(['all', 'invoice', 'payment'] as const).map((f) => (
              <button
                key={f}
                type="button"
                className="pill"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'الكل' : f === 'invoice' ? 'الفواتير' : 'الدفعات'}
              </button>
            ))}
            {(unsignedCount > 0 || filter === 'unsigned') && (
              <button
                type="button"
                className="pill"
                aria-pressed={filter === 'unsigned'}
                onClick={() => setFilter(filter === 'unsigned' ? 'all' : 'unsigned')}
              >
                غير الموقّعة <span className="num pill-count">{unsignedCount}</span>
              </button>
            )}
          </div>
          {desktop && (
            <div style={{ display: 'flex', gap: 10, marginInlineStart: 'auto' }}>
              <Link className="btn btn-primary" to={`/a/${id}/entry/new?type=invoice`}>
                + فاتورة
              </Link>
              <Link className="btn" to={`/a/${id}/entry/new?type=payment`}>
                + دفعة
              </Link>
              <Link className="btn btn-quiet" to={`/a/${id}/entry/new?type=note`}>
                + ملاحظة
              </Link>
            </div>
          )}
        </div>
      </section>

      {ledger.syncError && (
        <div className="pad" style={{ paddingBottom: 0 }}>
          <div className="banner banner-err" role="alert">
            {ledger.syncError}
          </div>
        </div>
      )}

      {desktop ? (
        <div style={{ overflowX: 'auto', padding: '8px var(--gutter) 24px' }}>
          <table
            className="num"
            style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse', fontSize: 15 }}
          >
            <thead>
              <tr className="muted" style={{ textAlign: 'right', fontSize: 13 }}>
                {['التاريخ', 'البيان', 'له', 'عليه', showBalances ? 'الرصيد' : '', ''].map(
                  (h, i) => (
                    <th
                      key={i}
                      style={{
                        padding: '10px 8px',
                        borderBottom: '2px solid var(--ink)',
                        fontWeight: 500,
                        textAlign: i >= 2 && i <= 4 ? 'left' : 'right',
                      }}
                    >
                      {h || <span className="sr-only">إجراءات</span>}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {showBalances && (
                <tr className="muted" style={{ fontStyle: 'italic', background: 'var(--band)' }}>
                  <td style={td}>{displayDate(range.from)}</td>
                  <td style={td}>الرصيد السابق (رصيد افتتاحي)</td>
                  <td style={td} />
                  <td style={td} />
                  <td style={{ ...td, textAlign: 'left' }}>
                    {formatAmount(Math.abs(statement.opening))}{' '}
                    {SIDE_LABEL[balanceSide(statement.opening)]}
                  </td>
                  <td style={td} />
                </tr>
              )}
              {shown.map(({ entry: e, balance }) => (
                <tr
                  key={e.id}
                  onClick={() => setSelected(e.id)}
                  style={{ cursor: 'pointer' }}
                  className="row-hover"
                >
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{displayDate(e.date)}</td>
                  <td style={td}>
                    {(e.type === 'note' || e.subtype) && (
                      <span
                        className="chip"
                        style={{ background: 'var(--fill)', marginInlineEnd: 6 }}
                      >
                        {e.subtype ? SUBTYPE_LABEL[e.subtype] : 'ملاحظة'}
                      </span>
                    )}
                    {e.voucherNo !== null && (
                      <span className="muted" style={{ marginInlineEnd: 6 }}>
                        #{e.voucherNo}
                      </span>
                    )}
                    {stamp(e)}
                    {e.details || <span className="muted">{entryLabel(e)}</span>}
                    {e.attachments.length > 0 && (
                      <span className="muted" style={{ marginInlineStart: 6 }}>
                        <Icon name="clip" size={16} label="مرفقات" />
                      </span>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: 'left', color: 'var(--lah)', fontWeight: 500 }}>
                    {e.type === 'invoice' ? formatAmount(e.amount) : ''}
                  </td>
                  <td style={{ ...td, textAlign: 'left', color: 'var(--alayh)', fontWeight: 500 }}>
                    {e.type === 'payment' ? formatAmount(e.amount) : ''}
                  </td>
                  <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>
                    {showBalances ? formatAmount(balance) : ''}
                  </td>
                  <td style={{ ...td, textAlign: 'left', whiteSpace: 'nowrap' }}>{signCell(e)}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 600 }}>
                <td style={tdTotal} colSpan={2}>
                  إجمالي الفترة
                </td>
                <td style={{ ...tdTotal, textAlign: 'left', color: 'var(--lah)' }}>
                  {formatAmount(statement.totalLah)}
                </td>
                <td style={{ ...tdTotal, textAlign: 'left', color: 'var(--alayh)' }}>
                  {formatAmount(statement.totalAlayh)}
                </td>
                <td style={{ ...tdTotal, textAlign: 'left' }}>
                  {showBalances ? formatAmount(statement.closing) : ''}
                </td>
                <td style={tdTotal} />
              </tr>
            </tbody>
          </table>
          {shown.length === 0 && <div className="empty">لا توجد عمليات في هذه الفترة.</div>}
        </div>
      ) : (
        <div>
          <div
            className="muted"
            style={{
              padding: '8px var(--gutter)',
              fontSize: 12,
              borderBottom: '1px solid var(--rule)',
            }}
          >
            الأحدث أولاً · {shown.length} عملية في الفترة
          </div>
          {newestFirst.length === 0 && <div className="empty">لا توجد عمليات في هذه الفترة.</div>}
          {newestFirst.map(({ entry: e, balance }) => (
            <div
              key={e.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelected(e.id)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault();
                  setSelected(e.id);
                }
              }}
              style={{
                padding: '12px var(--gutter)',
                borderBottom: '1px solid var(--rule)',
                cursor: 'pointer',
              }}
            >
              <div className="row-between" style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 500, overflowWrap: 'anywhere' }}>
                    {e.details || entryLabel(e)}
                  </div>
                  <div className="muted num" style={{ fontSize: 13, marginTop: 2 }}>
                    {displayDate(e.date)} · {entryLabel(e)}
                    {e.voucherNo !== null && ` #${e.voucherNo}`}
                    {stamp(e)}
                    {e.attachments.length > 0 && ` · 📎 ${e.attachments.length}`}
                  </div>
                </div>
                <div style={{ textAlign: 'left', flex: '0 0 auto' }}>
                  {e.type !== 'note' && (
                    <div
                      className="num"
                      style={{
                        fontWeight: 600,
                        color: e.type === 'invoice' ? 'var(--lah)' : 'var(--alayh)',
                      }}
                    >
                      {e.type === 'invoice' ? '+' : '−'}
                      {formatAmount(e.amount)}
                    </div>
                  )}
                  {showBalances && (
                    <div className="muted num" style={{ fontSize: 12 }}>
                      الرصيد {formatAmount(balance)}
                    </div>
                  )}
                </div>
              </div>
              {signCell(e) && <div style={{ marginTop: 6 }}>{signCell(e)}</div>}
            </div>
          ))}
          {showBalances && (
            <div
              className="row-between muted"
              style={{
                padding: '12px var(--gutter)',
                fontSize: 14,
                fontStyle: 'italic',
                borderBottom: '1px solid var(--rule)',
                background: 'var(--band)',
              }}
            >
              <span>الرصيد الافتتاحي قبل {displayDate(range.from)}</span>
              <span className="num" style={{ fontWeight: 600 }}>
                {formatAmount(Math.abs(statement.opening))}{' '}
                {SIDE_LABEL[balanceSide(statement.opening)]}
              </span>
            </div>
          )}
          <div
            className="num"
            style={{
              padding: '14px var(--gutter) 24px',
              display: 'grid',
              gridTemplateColumns: `repeat(${showBalances ? 3 : 2}, minmax(0,1fr))`,
              gap: 8,
              fontSize: 13,
            }}
          >
            <div>
              <div className="muted">له في الفترة</div>
              <div className="lah" style={{ fontWeight: 600 }}>
                {formatAmount(statement.totalLah)}
              </div>
            </div>
            <div>
              <div className="muted">عليه في الفترة</div>
              <div className="alayh" style={{ fontWeight: 600 }}>
                {formatAmount(statement.totalAlayh)}
              </div>
            </div>
            {showBalances && (
              <div>
                <div className="muted">الرصيد</div>
                <div style={{ fontWeight: 600 }}>{formatAmount(statement.closing)}</div>
              </div>
            )}
          </div>
          <div
            className="bottom-actions no-print"
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10 }}
          >
            <Link className="btn btn-primary" to={`/a/${id}/entry/new?type=invoice`}>
              + فاتورة
            </Link>
            <Link className="btn" to={`/a/${id}/entry/new?type=payment`}>
              + دفعة
            </Link>
            <Link
              className="btn btn-quiet"
              to={`/a/${id}/entry/new?type=note`}
              aria-label="إضافة ملاحظة"
            >
              + ملاحظة
            </Link>
          </div>
        </div>
      )}

      {rangeOpen && (
        <CalendarSheet
          mode="range"
          value={range}
          onCancel={() => setRangeOpen(false)}
          onDone={(r) => {
            const n = normalizeRange(r);
            setParams({ from: n.from, to: n.to }, { replace: true });
            setRangeOpen(false);
          }}
        />
      )}

      {archiveAsk && (
        <Sheet title={`أرشفة «${account.name}»؟`} onClose={() => setArchiveAsk(false)}>
          <p style={{ margin: 0, lineHeight: 1.8 }}>
            يختفي من قائمة الحسابات ويبقى كشفه وبياناته كما هي، ويظهر في «المؤرشفة» وفي البحث.
            {!can.seeBalances(profile.role) ? null : ' يبقى رصيده ضمن صافي الأرصدة.'} لا يراه مدخل
            البيانات حتى يُعاد.
          </p>
          {showBalances && fullBalance !== 0 && (
            <div className="banner banner-warn" role="note">
              رصيده ليس صفراً:{' '}
              <strong className="num">{formatAmount(Math.abs(fullBalance))}</strong>{' '}
              {SIDE_LABEL[balanceSide(fullBalance)]}.
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void toggleArchive(true)}
              disabled={archBusy}
            >
              {archBusy ? 'جارٍ…' : 'نعم، أرشفه'}
            </button>
            <button type="button" className="btn" onClick={() => setArchiveAsk(false)}>
              تراجع
            </button>
          </div>
        </Sheet>
      )}
      {deleteAsk && (
        <Sheet
          title={`نقل «${account.name}» إلى سلة المهملات؟`}
          onClose={() => setDeleteAsk(false)}
        >
          <p style={{ margin: 0, lineHeight: 1.8 }}>
            يختفي الحساب من القائمة ومن صافي الأرصدة ومن مدخل البيانات، وتبقى كل عملياته (
            {entries.length} عملية) كما هي. يستطيع المالك والإدارة استرجاعه كاملاً من «الإعدادات ←
            سلة المهملات»، ولا يُحذف شيء نهائياً. يصل تنبيه للمالك والإدارة.
          </p>
          {showBalances && fullBalance !== 0 && (
            <div className="banner banner-warn" role="note">
              رصيده ليس صفراً:{' '}
              <strong className="num">{formatAmount(Math.abs(fullBalance))}</strong>{' '}
              {SIDE_LABEL[balanceSide(fullBalance)]}. إن كان المقصود إخفاءه فقط فالأرشفة أنسب.
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void toggleDeleted(true)}
              disabled={archBusy}
            >
              {archBusy ? 'جارٍ…' : 'نعم، انقله للسلة'}
            </button>
            <button type="button" className="btn" onClick={() => setDeleteAsk(false)}>
              تراجع
            </button>
          </div>
        </Sheet>
      )}
      {selectedSnap && (
        <EntrySheet
          account={account}
          snap={selectedSnap}
          balanceAfter={
            showBalances
              ? (statement.rows.find((r) => r.entry.id === selectedSnap.entry.id)?.balance ?? null)
              : null
          }
          signState={signStateOf(selectedSnap.entry, ledger.links, now)}
          links={ledger.links}
          onClose={() => {
            setSelected(null);
            if (eParam) {
              const next = new URLSearchParams(params);
              next.delete('e');
              setParams(next, { replace: true });
            }
          }}
          onEdit={() => navigate(`/a/${id}/entry/${selectedSnap.entry.id}`)}
        />
      )}
    </>
  );
}

const td = { padding: '12px 8px', borderBottom: '1px solid var(--rule)' } as const;
const tdTotal = { padding: '14px 8px', borderTop: '2px solid var(--ink)' } as const;
