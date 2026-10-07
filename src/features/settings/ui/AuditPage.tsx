import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage, reportError } from '../../../core/errors';
import { fb } from '../../../core/firebase';
import { useReady } from '../../../core/session';
import { ErrorBox, Loading } from '../../../core/Shell';
import { displayDate, formatDateTime } from '../../../shared/lib/dates';
import { formatAmount } from '../../../shared/lib/money';
import { Icon } from '../../../shared/ui/Icon';
import { ENTRY_LABEL, type EntryType } from '../../ledger/domain/types';
import { listUsers } from '../../users/data/usersRepo';
import { can } from '../../users/domain/types';
import { listAudit, type AuditItem } from '../data/settingsRepo';

/** Last 100 edits/deletes with the version before the change (managers only). */
export function AuditPage() {
  const { profile } = useReady();
  const [items, setItems] = useState<AuditItem[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    const { db } = fb();
    Promise.all([listAudit(db), listUsers(db)])
      .then(([a, u]) => {
        setItems(a);
        setNames(Object.fromEntries(u.map((x) => [x.id, x.name])));
      })
      .catch((e) => {
        reportError('audit', e);
        setError(errorMessage(e));
      });
  }, []);

  if (!can.viewAudit(profile.role))
    return <ErrorBox message="سجل التعديلات للمالك والإدارة فقط." />;

  return (
    <>
      <div
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
        <h1 className="serif" style={{ margin: 0, fontSize: 22 }}>
          سجل التعديلات
        </h1>
      </div>
      {error ? (
        <ErrorBox message={error} />
      ) : !items ? (
        <Loading />
      ) : items.length === 0 ? (
        <div className="empty">لا توجد تعديلات أو عمليات حذف بعد.</div>
      ) : (
        items.map((it) => {
          const b = it.before;
          const type = (
            typeof b.type === 'string' && b.type in ENTRY_LABEL ? b.type : 'note'
          ) as EntryType;
          const accountId = it.path.split('/')[1] ?? '';
          return (
            <div
              key={it.id}
              style={{ padding: '12px var(--gutter)', borderBottom: '1px solid var(--rule)' }}
            >
              <div className="row-between">
                <strong style={{ color: it.action === 'delete' ? 'var(--alayh)' : 'var(--ink)' }}>
                  {it.action === 'delete' ? 'حذف' : 'تعديل'} {ENTRY_LABEL[type]}
                  {typeof b.voucherNo === 'number' && ` #${b.voucherNo}`}
                </strong>
                <span className="muted num" style={{ fontSize: 12 }}>
                  {it.atMs ? formatDateTime(it.atMs, 'short') : ''}
                </span>
              </div>
              <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                بواسطة {names[it.actor] ?? 'مستخدم'} ·{' '}
                <Link to={`/a/${accountId}`} style={{ fontSize: 13 }}>
                  عرض الحساب
                </Link>
              </div>
              <div
                className="num"
                style={{
                  fontSize: 13,
                  marginTop: 6,
                  padding: '6px 10px',
                  background: 'var(--band)',
                  borderRadius: 8,
                }}
              >
                قبل التغيير: {typeof b.date === 'string' ? displayDate(b.date) : ''}
                {typeof b.amount === 'number' &&
                  b.amount > 0 &&
                  ` · ${formatAmount(b.amount)} ريال`}
                {typeof b.details === 'string' && b.details && ` · ${b.details}`}
              </div>
            </div>
          );
        })
      )}
    </>
  );
}
