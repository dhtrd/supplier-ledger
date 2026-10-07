import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { errorMessage, reportError } from '../../../core/errors';
import { fb } from '../../../core/firebase';
import { useReady } from '../../../core/session';
import { can } from '../../users/domain/types';
import { watchNotifications } from '../data/notificationsRepo';
import { isUnread, visibleTo, type AppNotification } from '../domain/notification';

interface NotificationsState {
  /** null while loading; never includes the user's own actions. */
  rows: AppNotification[] | null;
  unread: number;
  error: string;
}

const Ctx = createContext<NotificationsState>({ rows: [], unread: 0, error: '' });

/** One live listener for the whole signed-in shell (owner and managers only). */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useReady();
  const enabled = can.viewNotifications(profile.role);
  const [all, setAll] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled) return;
    return watchNotifications(
      fb().db,
      (rows) => {
        setAll(rows);
        setError('');
      },
      (e) => {
        reportError('notifications', e);
        setError(errorMessage(e));
      },
    );
  }, [enabled]);

  const value = useMemo<NotificationsState>(() => {
    if (!enabled) return { rows: [], unread: 0, error: '' };
    const rows = all ? visibleTo(all, user.uid) : null;
    return { rows, unread: rows ? rows.filter((n) => isUnread(n, user.uid)).length : 0, error };
  }, [enabled, all, user.uid, error]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useNotifications = () => useContext(Ctx);
