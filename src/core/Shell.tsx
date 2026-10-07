import { NavLink, Outlet } from 'react-router-dom';
import {
  NotificationsProvider,
  useNotifications,
} from '../features/notifications/ui/NotificationsProvider';
import { can } from '../features/users/domain/types';
import { APP_NAME, BrandMark } from '../shared/ui/BrandMark';
import { Icon } from '../shared/ui/Icon';
import { useReady } from './session';

export function Shell() {
  return (
    <NotificationsProvider>
      <ShellFrame />
    </NotificationsProvider>
  );
}

function ShellFrame() {
  const { profile, settings } = useReady();
  const { unread } = useNotifications();
  const badge = unread > 0 ? (unread > 99 ? '99+' : String(unread)) : null;
  const tabs = [
    { to: '/', label: 'الحسابات', icon: 'ledger' as const, end: true },
    ...(can.manageUsers(profile.role)
      ? [{ to: '/users', label: 'المستخدمون', icon: 'users' as const, end: false }]
      : []),
    ...(can.viewNotifications(profile.role)
      ? [{ to: '/notifications', label: 'التنبيهات', icon: 'bell' as const, end: false, badge }]
      : []),
    {
      to: '/settings',
      label: can.editSettings(profile.role) ? 'الإعدادات' : 'حسابي',
      icon: 'settings' as const,
      end: false,
    },
  ];
  return (
    <div className="shell">
      <header className="topbar no-print">
        <NavLink to="/" className="brand" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BrandMark size={30} />
          {APP_NAME}
        </NavLink>
        <nav aria-label="التنقل الرئيسي">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end}>
              {t.label}
              <TabBadge value={'badge' in t ? t.badge : null} />
            </NavLink>
          ))}
        </nav>
        <div className="muted" style={{ fontSize: 14 }}>
          {settings.roleLabels[profile.role]} · {profile.name}
        </div>
      </header>
      <main className="shell-main">
        <Outlet />
      </main>
      <nav className="tabbar no-print" aria-label="التنقل الرئيسي">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className="tab-link">
            <Icon name={t.icon} />
            {t.label}
            <TabBadge value={'badge' in t ? t.badge : null} />
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function TabBadge({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  return (
    <span className="tab-badge num" aria-label={`${value} غير مقروء`}>
      {value}
    </span>
  );
}

export function Loading({ label = 'جارٍ التحميل…' }: { label?: string }) {
  return (
    <div
      className="empty"
      role="status"
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}
    >
      <div className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="pad">
      <div className="banner banner-err" role="alert">
        {message}
      </div>
      {onRetry && (
        <button type="button" className="btn" style={{ marginTop: 12 }} onClick={onRetry}>
          إعادة المحاولة
        </button>
      )}
    </div>
  );
}
