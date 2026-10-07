import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage, reportError } from '../../../core/errors';
import { fb } from '../../../core/firebase';
import { useReady } from '../../../core/session';
import { ErrorBox, Loading } from '../../../core/Shell';
import { displayDate, formatDateTime } from '../../../shared/lib/dates';
import { formatAmount } from '../../../shared/lib/money';
import { Icon } from '../../../shared/ui/Icon';
import { useToast } from '../../../shared/ui/Toast';
import { listAllAccounts, setAccountDeleted } from '../../accounts/data/accountsRepo';
import type { Account } from '../../accounts/domain/types';
import { listTrash, restoreEntry, type TrashItem } from '../../ledger/data/entriesRepo';
import { entryTitle } from '../../notifications/domain/notification';
import { listUsers } from '../../users/data/usersRepo';
import { can } from '../../users/domain/types';

/** «سلة المهملات»: every deleted entry; restore brings it back as it was. */
export function TrashPage() {
  const { user, profile } = useReady();
  const toast = useToast();
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [accounts, setAccounts] = useState<Record<string, string>>({});
  const [deletedAccounts, setDeletedAccounts] = useState<Account[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const allowed = can.restoreFromTrash(profile.role);

  const load = useCallback(() => {
    const { db } = fb();
    Promise.all([listTrash(db), listAllAccounts(db), listUsers(db)])
      .then(([t, a, u]) => {
        setItems(t);
        setAccounts(Object.fromEntries(a.map((x) => [x.id, x.name])));
        setDeletedAccounts(a.filter((x) => x.deleted));
        setNames(Object.fromEntries(u.map((x) => [x.id, x.name])));
      })
      .catch((e) => {
        reportError('trash', e);
        setError(errorMessage(e));
      });
  }, []);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  if (!allowed) return <ErrorBox message="سلة المهملات للمالك والإدارة فقط." />;

  const restore = async (it: TrashItem) => {
    setBusyId(it.snap.entry.id);
    try {
      await restoreEntry(fb().db, user.uid, it.accountId, it.snap, {
        actorName: profile.name,
        accountName: accounts[it.accountId] ?? '',
      });
      toast.info(
        `استُرجعت ${entryTitle(it.snap.entry)} إلى كشف «${accounts[it.accountId] ?? ''}».`,
      );
      setItems((list) => list?.filter((x) => x !== it) ?? null);
    } catch (e) {
      reportError('restore', e);
      toast.error(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const restoreAccount = async (a: Account) => {
    setBusyId(a.id);
    try {
      await setAccountDeleted(fb().db, user.uid, a, false, profile.name);
      toast.info(`استُرجع «${a.name}» إلى قائمة الحسابات بكل عملياته.`);
      setDeletedAccounts((l) => l.filter((x) => x.id !== a.id));
    } catch (e) {
      reportError('restore-account', e);
      toast.error(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div
        className="form-head"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '8px 8px 12px',
          borderBottom: '2px solid var(--ink)',
        }}
      >
        <Link to="/settings" className="icon-btn" aria-label="رجوع">
          <Icon name="back" />
        </Link>
        <div>
          <h1 className="serif" style={{ margin: 0, fontSize: 22 }}>
            سلة المهملات
          </h1>
          <div className="muted" style={{ fontSize: 13 }}>
            لا يُحذف شيء نهائياً؛ «استرجاع» يعيد العملية إلى كشفها كما كانت.
          </div>
        </div>
      </div>
      {error ? (
        <ErrorBox
          message={error}
          onRetry={() => {
            setError('');
            load();
          }}
        />
      ) : !items ? (
        <Loading />
      ) : items.length === 0 && deletedAccounts.length === 0 ? (
        <div className="empty">السلة فارغة.</div>
      ) : (
        <>
          {deletedAccounts.length > 0 && (
            <>
              <h2 className="serif trash-head">حسابات ({deletedAccounts.length})</h2>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} className="trash-list">
                {deletedAccounts.map((a) => (
                  <li key={a.id} className="list-row" style={{ cursor: 'default' }}>
                    <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                      <span style={{ display: 'block', fontWeight: 600 }}>حساب: {a.name}</span>
                      <span className="muted num" style={{ display: 'block', fontSize: 13 }}>
                        {a.totals ? `${a.totals.entryCount} عملية تعود معه` : 'تعود معه كل عملياته'}
                      </span>
                    </span>
                    <Link to={`/a/${a.id}`} className="btn btn-sm btn-quiet">
                      عرض
                    </Link>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => void restoreAccount(a)}
                      disabled={busyId !== null}
                    >
                      <Icon name="restore" size={18} />
                      {busyId === a.id ? 'جارٍ…' : 'استرجاع'}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {items.length > 0 && <h2 className="serif trash-head">عمليات ({items.length})</h2>}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} className="trash-list">
            {items.map((it) => {
              const e = it.snap.entry;
              return (
                <li
                  key={`${it.accountId}/${e.id}`}
                  className="list-row"
                  style={{ cursor: 'default' }}
                >
                  <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 600 }}>
                      {entryTitle(e)} · {accounts[it.accountId] ?? 'حساب محذوف'}
                    </span>
                    <span className="muted num" style={{ display: 'block', fontSize: 13 }}>
                      {displayDate(e.date)}
                      {e.type !== 'note' && ` · ${formatAmount(e.amount)}`}
                      {e.details && ` · ${e.details.slice(0, 60)}`}
                      {e.signature && ` · موقّع من ${e.signature.name}`}
                    </span>
                    <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                      حذفها {names[it.deletedBy] ?? (e.legacy ? 'البرنامج القديم' : 'مستخدم')}
                      {it.deletedAtMs > 0 && ` · ${formatDateTime(it.deletedAtMs)}`}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => void restore(it)}
                    disabled={busyId !== null}
                  >
                    <Icon name="restore" size={18} />
                    {busyId === e.id ? 'جارٍ…' : 'استرجاع'}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
