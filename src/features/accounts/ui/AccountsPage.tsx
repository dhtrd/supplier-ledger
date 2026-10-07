import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage, reportError } from '../../../core/errors';
import { fb } from '../../../core/firebase';
import { useReady } from '../../../core/session';
import { ErrorBox, Loading } from '../../../core/Shell';
import { balanceSide, formatAmount, SIDE_LABEL } from '../../../shared/lib/money';
import { searchKey } from '../../../shared/lib/text';
import { useBlobUrl } from '../../../shared/ui/hooks';
import { sniffMime } from '../../../shared/ui/Logo';
import { can } from '../../users/domain/types';
import { todayRiyadh } from '../../../shared/lib/dates';
import { useToast } from '../../../shared/ui/Toast';
import {
  accountTotals,
  getAccounts,
  lastMovement,
  listAccounts,
  setArchived,
  type AccountTotals,
} from '../data/accountsRepo';
import {
  ARCHIVE_SUGGEST_DAYS,
  archiveCandidates,
  needsLastMovement,
  SUGGEST_SNOOZE_DAYS,
} from '../domain/archive';
import { GROUP_LABEL, initialOf, type Account, type AccountGroup } from '../domain/types';

type Row = Account & { totals: AccountTotals | null };
type Filter = AccountGroup | 'all' | 'archived';

const SNOOZE_KEY = 'sl:archive-suggest-snooze';
function snoozed(): boolean {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY) ?? 0) > Date.now();
  } catch {
    return false;
  }
}
function snooze(): void {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SUGGEST_SNOOZE_DAYS * 86_400_000));
  } catch {
    /* storage unavailable: the suggestion just comes back next time */
  }
}

export function AccountsPage() {
  const { profile, settings } = useReady();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<Filter>('all');
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [suggest, setSuggest] = useState<string[]>([]);
  const [archiving, setArchiving] = useState(false);
  const { user } = useReady();
  const toast = useToast();
  const isManager = can.manageAccounts(profile.role);
  const assignedKey = profile.assignedAccounts.join(',');

  const [reloadKey, setReloadKey] = useState(0);
  const retry = () => {
    setError('');
    setRows(null);
    setReloadKey((k) => k + 1);
  };

  useEffect(() => {
    let alive = true;
    const { db } = fb();
    (async () => {
      const accounts = isManager
        ? await listAccounts(db)
        : await getAccounts(db, assignedKey ? assignedKey.split(',') : []);
      accounts.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
      // Data-entry users never see archived accounts (the rules close their statements).
      const visible = isManager ? accounts : accounts.filter((a) => !a.archived);
      const totals = await Promise.all(visible.map((a) => accountTotals(db, a.id)));
      const loaded = visible.map((a, i) => ({ ...a, totals: totals[i] ?? null }));
      if (alive) setRows(loaded);
      // Suggest archiving settled, idle accounts (managers; at most once per snooze).
      if (!isManager || snoozed()) return;
      const check = loaded.filter((r) =>
        needsLastMovement({
          archived: r.archived,
          balance: r.totals?.balance ?? 1,
          count: r.totals?.count ?? 0,
        }),
      );
      const dates = await Promise.all(check.map((r) => lastMovement(db, r.id)));
      const ids = archiveCandidates(
        check.map((r, i) => ({
          id: r.id,
          archived: r.archived,
          balance: r.totals?.balance ?? 1,
          count: r.totals?.count ?? 0,
          lastDate: dates[i] ?? null,
        })),
        todayRiyadh(),
      );
      if (alive) setSuggest(ids);
    })().catch((e) => {
      reportError('accounts', e);
      if (alive) setError(errorMessage(e));
    });
    return () => {
      alive = false;
    };
  }, [isManager, assignedKey, reloadKey]);

  const searching = q.trim().length > 0;
  /** Group + search match, archived included (the net balance counts them). */
  const matching = useMemo(() => {
    if (!rows) return [];
    const needle = searchKey(q);
    const phoneNeedle = needle.replace(/\D/g, '');
    return rows.filter(
      (r) =>
        (group === 'all' || group === 'archived' || r.group === group) &&
        (!needle ||
          searchKey(r.name).includes(needle) ||
          (phoneNeedle.length >= 3 && r.phone.includes(phoneNeedle))),
    );
  }, [rows, q, group]);
  const archivedRows = matching.filter((r) => r.archived);
  // Search finds archived accounts too (tagged); otherwise they stay out of the list.
  const filtered =
    group === 'archived' ? archivedRows : matching.filter((r) => searching || !r.archived);
  const archivedCount = rows?.filter((r) => r.archived).length ?? 0;

  const showBalances = can.seeBalances(profile.role);
  const net = matching.reduce((s, r) => s + (r.totals?.balance ?? 0), 0);
  const suggested = (rows ?? []).filter((r) => suggest.includes(r.id) && !r.archived);

  const archiveSuggested = async () => {
    setArchiving(true);
    try {
      for (const r of suggested) await setArchived(fb().db, user.uid, r, true);
      setRows(
        (list) => list?.map((r) => (suggest.includes(r.id) ? { ...r, archived: true } : r)) ?? null,
      );
      toast.info(`أُرشف ${suggested.length} حساب. تجدها في «المؤرشفة».`);
      setSuggest([]);
    } catch (e) {
      reportError('archive-suggested', e);
      toast.error(errorMessage(e));
      retry();
    } finally {
      setArchiving(false);
    }
  };

  return (
    <>
      <header className="page-head">
        <div className="row-between">
          <h1>الحسابات</h1>
          {isManager ? (
            <Link to="/a/new" className="btn btn-primary" style={{ minHeight: 44 }}>
              + حساب
            </Link>
          ) : (
            <span className="muted" style={{ fontSize: 13 }}>
              {settings.roleLabels[profile.role]}
            </span>
          )}
        </div>
        <label htmlFor="acc-search" className="sr-only">
          بحث في الحسابات
        </label>
        <input
          id="acc-search"
          type="search"
          className="input"
          placeholder="بحث بالاسم أو الجوال"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={60}
        />
        <div className="pills" role="group" aria-label="تصفية حسب المجموعة">
          {(['all', 'suppliers', 'customers', 'general'] as const).map((g) => (
            <button
              key={g}
              type="button"
              className="pill"
              aria-pressed={group === g}
              onClick={() => setGroup(g)}
            >
              {g === 'all' ? 'الكل' : GROUP_LABEL[g]}
            </button>
          ))}
          {isManager && archivedCount > 0 && (
            <button
              type="button"
              className="pill"
              aria-pressed={group === 'archived'}
              onClick={() => setGroup(group === 'archived' ? 'all' : 'archived')}
            >
              المؤرشفة <span className="num">{archivedCount}</span>
            </button>
          )}
        </div>
      </header>

      {error ? (
        <ErrorBox message={error} onRetry={retry} />
      ) : !rows ? (
        <Loading />
      ) : (
        <>
          <div
            className="row-between muted"
            style={{
              padding: '10px var(--gutter)',
              fontSize: 13,
              borderBottom: '1px solid var(--rule)',
            }}
          >
            <span>
              {filtered.length} حساب{group === 'archived' && ' مؤرشف'}
            </span>
            {showBalances && (
              <span>
                صافي الأرصدة:{' '}
                <strong className={`num ${net >= 0 ? 'lah' : 'alayh'}`}>
                  {formatAmount(Math.abs(net))} {SIDE_LABEL[balanceSide(net)]}
                </strong>
              </span>
            )}
          </div>
          {suggested.length > 0 && group !== 'archived' && (
            <div className="banner banner-warn archive-suggest" role="status">
              <span>
                {suggested.length} حساب مسوّى (رصيده صفر) بلا حركة منذ {ARCHIVE_SUGGEST_DAYS} يوماً
                أو أكثر: {suggested.map((r) => r.name).join('، ')}. أرشفتها تخفيها من القائمة فقط.
              </span>
              <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => void archiveSuggested()}
                  disabled={archiving}
                >
                  {archiving ? 'جارٍ…' : 'أرشفها'}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-quiet"
                  onClick={() => {
                    snooze();
                    setSuggest([]);
                  }}
                >
                  لاحقاً
                </button>
              </span>
            </div>
          )}
          {filtered.length === 0 ? (
            <div className="empty">
              {rows.length === 0
                ? isManager
                  ? 'لا توجد حسابات بعد. أضف أول مورد أو عميل.'
                  : 'لم يُسند إليك أي حساب بعد. راجع الإدارة.'
                : 'لا نتائج مطابقة.'}
            </div>
          ) : (
            filtered.map((r) => <AccountRow key={r.id} row={r} showBalance={showBalances} />)
          )}
          {isManager && group !== 'archived' && !searching && archivedRows.length > 0 && (
            <>
              <button
                type="button"
                className="fold-btn"
                aria-expanded={archivedOpen}
                onClick={() => setArchivedOpen((o) => !o)}
              >
                <span aria-hidden="true">{archivedOpen ? '▾' : '◂'}</span> المؤرشفة (
                <span className="num">{archivedRows.length}</span>)
              </button>
              {archivedOpen &&
                archivedRows.map((r) => (
                  <AccountRow key={r.id} row={r} showBalance={showBalances} />
                ))}
            </>
          )}
        </>
      )}
    </>
  );
}

function AccountRow({ row, showBalance }: { row: Row; showBalance: boolean }) {
  const logo = useBlobUrl(row.logo, sniffMime(row.logo));
  const bal = row.totals?.balance ?? 0;
  const side = balanceSide(bal);
  return (
    <Link to={`/a/${row.id}`} className={`list-row${row.archived ? ' is-archived' : ''}`}>
      <span className="avatar" aria-hidden="true">
        {logo ? <img src={logo} alt="" /> : initialOf(row.name)}
      </span>
      <span style={{ flex: '1 1 auto', minWidth: 0 }}>
        <span
          style={{
            display: 'block',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {row.name}
          {row.archived && <span className="tag-archived">مؤرشف</span>}
        </span>
        <span className="muted num" style={{ display: 'block', fontSize: 13 }}>
          {GROUP_LABEL[row.group]}
          {row.phone && ` · ${row.phone}`}
          {row.totals && ` · ${row.totals.count} عملية`}
        </span>
      </span>
      {showBalance && (
        <span style={{ textAlign: 'left', flex: '0 0 auto' }}>
          <span
            className="num"
            style={{
              display: 'block',
              fontWeight: 600,
              color:
                side === 'lah' ? 'var(--lah)' : side === 'alayh' ? 'var(--alayh)' : 'var(--muted)',
            }}
          >
            {formatAmount(Math.abs(bal))}
          </span>
          <span className="muted" style={{ display: 'block', fontSize: 12 }}>
            {SIDE_LABEL[side]}
          </span>
        </span>
      )}
    </Link>
  );
}
