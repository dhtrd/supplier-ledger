import { NavLink, Outlet } from 'react-router-dom';
import { can } from '../features/users/domain/types';
import { Icon } from '../shared/ui/Icon';
import { useReady } from './session';

export function Shell() {
  const { profile, settings } = useReady();
  const tabs = [
    { to: '/', label: 'الحسابات', icon: 'ledger' as const, end: true },
    ...(can.manageUsers(profile.role)
      ? [{ to: '/users', label: 'المستخدمون', icon: 'users' as const, end: false }]
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
        <NavLink to="/" className="brand">
          دفتر الموردين
        </NavLink>
        <nav aria-label="التنقل الرئيسي">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end}>
              {t.label}
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
          <NavLink key={t.to} to={t.to} end={t.end}>
            <Icon name={t.icon} />
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
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
