import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { errorMessage, reportError } from '../../../core/errors';
import { fb } from '../../../core/firebase';
import { useReady } from '../../../core/session';
import { ErrorBox, Loading } from '../../../core/Shell';
import { formatDateTime } from '../../../shared/lib/dates';
import { useToast } from '../../../shared/ui/Toast';
import { can } from '../../users/domain/types';
import { markRead, NOTIFICATIONS_SHOWN } from '../data/notificationsRepo';
import { confirmNote, isUnread, KIND_LABEL, type AppNotification } from '../domain/notification';
import { useNotifications } from './NotificationsProvider';

/** «التنبيهات» tab (approved option «ب»): newest first, per-user read state. */
export function NotificationsPage() {
  const { user, profile } = useReady();
  const { rows, unread, error } = useNotifications();
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  if (!can.viewNotifications(profile.role))
    return <ErrorBox message="التنبيهات للمالك والإدارة فقط." />;
  if (error) return <ErrorBox message={error} />;
  if (!rows) return <Loading />;

  const read = async (ids: string[]) => {
    if (!ids.length) return;
    try {
      await markRead(fb().db, user.uid, ids);
    } catch (e) {
      reportError('notifications-read', e);
      toast.error(errorMessage(e));
    }
  };

  const open = async (n: AppNotification) => {
    if (isUnread(n, user.uid)) await read([n.id]);
    // A deleted entry is no longer in the statement: it lives in the trash.
    navigate(
      n.kind === 'delete' || n.kind === 'accountDelete'
        ? '/trash'
        : n.kind === 'accountRestore'
          ? `/a/${n.accountId}`
          : `/a/${n.accountId}?e=${encodeURIComponent(n.entryId)}`,
    );
  };

  const readAll = async () => {
    setBusy(true);
    await read(rows.filter((n) => isUnread(n, user.uid)).map((n) => n.id));
    setBusy(false);
  };

  return (
    <>
      <header className="page-head">
        <div className="row-between">
          <h1>التنبيهات</h1>
          {unread > 0 && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void readAll()}
              disabled={busy}
            >
              تعليم الكل كمقروء
            </button>
          )}
        </div>
        <p className="hint" style={{ margin: 0 }}>
          تعديل السندات الموقّعة والفواتير، والنقل إلى سلة المهملات والاسترجاع منها، وأي تغيير في
          رصيد فترة عليها إقرار مطابقة موقّع. لا تظهر لك العمليات التي نفّذتها أنت. آخر{' '}
          {NOTIFICATIONS_SHOWN} تنبيه.
        </p>
      </header>
      {rows.length === 0 ? (
        <div className="empty">لا تنبيهات.</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {rows.map((n) => {
            const fresh = isUnread(n, user.uid);
            return (
              <li key={n.id}>
                <button
                  type="button"
                  className={`note-row${fresh ? ' unread' : ''}`}
                  onClick={() => void open(n)}
                  aria-label={`${fresh ? 'غير مقروء: ' : ''}${KIND_LABEL[n.kind]} — ${n.title} — ${n.accountName}`}
                >
                  <span className="note-dot" aria-hidden="true" />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: fresh ? 700 : 500 }}>
                      {KIND_LABEL[n.kind]}: {n.title} — {n.accountName}
                    </span>
                    {n.confirmDate && (
                      <span className="stamp stamp-warn" style={{ marginInline: 0 }}>
                        {confirmNote(n.confirmDate)}
                      </span>
                    )}
                    {n.changes.length > 0 && (
                      <ul className="note-lines">
                        {n.changes.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    )}
                    <span
                      className="muted"
                      style={{ display: 'block', fontSize: 12, marginTop: 2 }}
                    >
                      {n.actorName} · {n.atMs ? formatDateTime(n.atMs) : 'الآن'}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
