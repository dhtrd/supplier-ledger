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
import { listAudit, type AuditAction, type AuditItem } from '../data/settingsRepo';
import { DOC_KINDS, DOC_LABEL, layoutOf, type DocKind } from '../../templates/domain/template';

const ACTION_LABEL: Record<AuditAction, string> = {
  create: 'إنشاء',
  update: 'تعديل',
  delete: 'نقل للسلة:',
  restore: 'استرجاع',
  archive: 'أرشفة',
  unarchive: 'إعادة من الأرشيف:',
  template: 'تعديل نموذج',
};

/** «before» of a template record: the kinds that had their own template then. */
function templatesBefore(b: Record<string, unknown>): string {
  const had = DOC_KINDS.filter((k) => b[k] && typeof b[k] === 'object').map((k) => {
    const layout = (b[k] as { layout?: unknown }).layout;
    const name = typeof layout === 'string' ? layoutOf(k, layout)?.name : undefined;
    return name ? `${DOC_LABEL[k]} («${name}»)` : DOC_LABEL[k];
  });
  return had.length ? `نماذج الحساب: ${had.join('، ')}` : 'لم يكن للحساب نماذج خاصة';
}

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
          const accountId = it.path.split('/')[1] ?? '';
          const isAccount = it.path.split('/').length === 2;
          const isTemplate = it.action === 'template';
          const type = (
            typeof b.type === 'string' && b.type in ENTRY_LABEL ? b.type : 'note'
          ) as EntryType;
          const sig = b.signature as { name?: unknown } | undefined;
          return (
            <div
              key={it.id}
              style={{ padding: '12px var(--gutter)', borderBottom: '1px solid var(--rule)' }}
            >
              <div className="row-between">
                <strong style={{ color: it.action === 'delete' ? 'var(--alayh)' : 'var(--ink)' }}>
                  {ACTION_LABEL[it.action]}{' '}
                  {isTemplate
                    ? `«${DOC_LABEL[it.kind as DocKind] ?? 'مستند'}»`
                    : isAccount
                      ? 'حساب'
                      : ENTRY_LABEL[type]}
                  {!isAccount && typeof b.voucherNo === 'number' && ` #${b.voucherNo}`}
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
              {isTemplate && (
                <div
                  style={{
                    fontSize: 13,
                    marginTop: 6,
                    padding: '6px 10px',
                    background: 'var(--band)',
                    borderRadius: 8,
                  }}
                >
                  قبل التغيير: {templatesBefore(b)}
                </div>
              )}
              {!isAccount && (
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
                  {sig && typeof sig.name === 'string' && ` · كان موقّعاً من ${sig.name}`}
                </div>
              )}
            </div>
          );
        })
      )}
    </>
  );
}
