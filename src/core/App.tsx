import { lazy, Suspense, type ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { LoginPage } from '../features/auth/ui/LoginPage';
import { AccountsPage } from '../features/accounts/ui/AccountsPage';
import { StatementPage } from '../features/ledger/ui/StatementPage';
import { SignPage } from '../features/signing/ui/SignPage';
import { ToastProvider } from '../shared/ui/Toast';
import { firebase } from './firebase';
import { logout, SessionProvider, useSession, type ReadySession } from './session';
import { LockScreen } from '../features/quickUnlock/ui/LockScreen';
import { useIdleLock } from '../features/quickUnlock/ui/useIdleLock';
import { IdleGuard } from './IdleGuard';
import { Loading, Shell } from './Shell';

// Less-used screens load on demand to keep the first load small on phones.
const AccountFormPage = lazy(() =>
  import('../features/accounts/ui/AccountFormPage').then((m) => ({ default: m.AccountFormPage })),
);
const EntryFormPage = lazy(() =>
  import('../features/ledger/ui/EntryFormPage').then((m) => ({ default: m.EntryFormPage })),
);
const UsersPage = lazy(() =>
  import('../features/users/ui/UsersPage').then((m) => ({ default: m.UsersPage })),
);
const SettingsPage = lazy(() =>
  import('../features/settings/ui/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const AuditPage = lazy(() =>
  import('../features/settings/ui/AuditPage').then((m) => ({ default: m.AuditPage })),
);
const VoucherPrintPage = lazy(() =>
  import('../features/vouchers/ui/VoucherPrintPage').then((m) => ({ default: m.VoucherPrintPage })),
);
const StatementPrintPage = lazy(() =>
  import('../features/vouchers/ui/StatementPrintPage').then((m) => ({
    default: m.StatementPrintPage,
  })),
);

export function App() {
  const fbState = firebase();
  if (!('app' in fbState)) return <ConfigMissing missing={fbState.missing} />;
  return (
    <ToastProvider>
      <HashRouter>
        <Routes>
          {/* Public: opened by the recipient from WhatsApp, no login. */}
          <Route path="/s/:token" element={<SignPage />} />
          <Route
            path="*"
            element={
              <SessionProvider>
                <Private />
              </SessionProvider>
            }
          />
        </Routes>
      </HashRouter>
    </ToastProvider>
  );
}

function Private() {
  const s = useSession();
  const loc = useLocation();
  if (s.status === 'loading')
    return (
      <Centered>
        <Loading />
      </Centered>
    );
  if (s.status === 'signedOut')
    return loc.pathname === '/login' ? <LoginPage /> : <Navigate to="/login" replace />;
  if (s.status === 'error')
    return (
      <Blocked title="تعذّر تحميل حسابك" text={s.message}>
        <button type="button" className="btn" onClick={() => location.reload()}>
          إعادة المحاولة
        </button>
      </Blocked>
    );
  if (s.status === 'noProfile')
    return (
      <Blocked
        title="لا توجد صلاحيات لهذا الحساب"
        text={`سجّلت الدخول بالبريد ${s.user.email ?? ''} لكن لم تُنشأ له صلاحيات. راجع المالك أو الإدارة.`}
      />
    );
  if (s.status === 'lockedOut')
    return (
      <Blocked
        title="الحساب مقفل"
        text="أُقفل الحساب بعد 5 محاولات دخول فاشلة. يفكّه المالك من صفحة المستخدمين."
      />
    );
  if (s.status === 'inactive')
    return (
      <Blocked title="الحساب موقوف" text="أوقفت الإدارة هذا الحساب. راجع المالك أو الإدارة." />
    );

  // Quick-unlock lock: nothing of the app is mounted (and the rules refuse
  // its data) until the PIN / fingerprint / a fresh sign-in unlocks.
  if (s.status === 'screenLocked') return <LockScreen session={s} />;

  if (s.status !== 'ready') return null; // unreachable; narrows the type

  return <SignedIn s={s} />;
}

function SignedIn({ s }: { s: ReadySession }) {
  const idle = useIdleLock(s);
  return (
    <IdleGuard
      idleMinutes={s.settings.idleMinutes}
      countdownSeconds={s.settings.idleCountdownSeconds}
      mode={idle.mode}
      onExpire={idle.onExpire}
      onActivity={idle.onActivity}
    >
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="/print/voucher/:accountId/:entryId" element={<VoucherPrintPage />} />
          <Route path="/print/statement/:accountId" element={<StatementPrintPage />} />
          <Route element={<Shell />}>
            <Route index element={<AccountsPage />} />
            <Route path="/a/new" element={<AccountFormPage />} />
            <Route path="/a/:id" element={<StatementPage />} />
            <Route path="/a/:id/edit" element={<AccountFormPage />} />
            <Route path="/a/:id/entry/new" element={<EntryFormPage />} />
            <Route path="/a/:id/entry/:entryId" element={<EntryFormPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </IdleGuard>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="center-page">{children}</div>;
}

function Blocked({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <Centered>
      <div className="card" role="alert">
        <div className="serif" style={{ fontSize: 24 }}>
          {title}
        </div>
        <p className="muted" style={{ margin: 0, lineHeight: 1.8 }}>
          {text}
        </p>
        {children}
        <button type="button" className="btn btn-danger" onClick={() => void logout()}>
          تسجيل الخروج
        </button>
      </div>
    </Centered>
  );
}

function ConfigMissing({ missing }: { missing: string[] }) {
  return (
    <Centered>
      <div className="card" role="alert">
        <div className="serif" style={{ fontSize: 24 }}>
          إعداد Firebase غير مكتمل
        </div>
        <p className="muted" style={{ margin: 0, lineHeight: 1.8 }}>
          أضف هذه المتغيرات في GitHub (Settings ← Secrets and variables ← Actions ← Variables) ثم
          أعد النشر:
        </p>
        <ul className="ltr num" style={{ margin: 0, textAlign: 'left', fontSize: 13 }}>
          {missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </div>
    </Centered>
  );
}
