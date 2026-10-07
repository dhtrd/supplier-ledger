import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage, reportError } from '../../../core/errors';
import { fb } from '../../../core/firebase';
import { useReady } from '../../../core/session';
import { ErrorBox, Loading } from '../../../core/Shell';
import { balanceSide, formatAmount, normalizeDigits, SIDE_LABEL } from '../../../shared/lib/money';
import { useBlobUrl } from '../../../shared/ui/hooks';
import { sniffMime } from '../../../shared/ui/Logo';
import { can } from '../../users/domain/types';
import { accountTotals, getAccounts, listAccounts, type AccountTotals } from '../data/accountsRepo';
import { GROUP_LABEL, initialOf, type Account, type AccountGroup } from '../domain/types';

type Row = Account & { totals: AccountTotals | null };

export function AccountsPage() {
  const { profile, settings } = useReady();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<AccountGroup | 'all'>('all');
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
      const totals = await Promise.all(accounts.map((a) => accountTotals(db, a.id)));
      if (alive) setRows(accounts.map((a, i) => ({ ...a, totals: totals[i] ?? null })));
    })().catch((e) => {
      reportError('accounts', e);
      if (alive) setError(errorMessage(e));
    });
    return () => {
      alive = false;
    };
  }, [isManager, assignedKey, reloadKey]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = normalizeDigits(q.trim()).toLowerCase();
    return rows.filter(
      (r) =>
        (group === 'all' || r.group === group) &&
        (!needle || r.name.toLowerCase().includes(needle) || r.phone.includes(needle)),
    );
  }, [rows, q, group]);

  const net = filtered.reduce((s, r) => s + (r.totals?.balance ?? 0), 0);

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
            <span>{filtered.length} حساب</span>
            <span>
              صافي الأرصدة:{' '}
              <strong className={`num ${net >= 0 ? 'lah' : 'alayh'}`}>
                {formatAmount(Math.abs(net))} {SIDE_LABEL[balanceSide(net)]}
              </strong>
            </span>
          </div>
          {filtered.length === 0 ? (
            <div className="empty">
              {rows.length === 0
                ? isManager
                  ? 'لا توجد حسابات بعد. أضف أول مورد أو عميل.'
                  : 'لم يُسند إليك أي حساب بعد. راجع الإدارة.'
                : 'لا نتائج مطابقة.'}
            </div>
          ) : (
            filtered.map((r) => <AccountRow key={r.id} row={r} />)
          )}
        </>
      )}
    </>
  );
}

function AccountRow({ row }: { row: Row }) {
  const logo = useBlobUrl(row.logo, sniffMime(row.logo));
  const bal = row.totals?.balance ?? 0;
  const side = balanceSide(bal);
  return (
    <Link to={`/a/${row.id}`} className="list-row">
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
        </span>
        <span className="muted num" style={{ display: 'block', fontSize: 13 }}>
          {GROUP_LABEL[row.group]}
          {row.phone && ` · ${row.phone}`}
          {row.totals && ` · ${row.totals.count} عملية`}
        </span>
      </span>
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
    </Link>
  );
}
