import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage, reportError } from '../../../core/errors';
import { fb } from '../../../core/firebase';
import { logout, type SessionState } from '../../../core/session';
import { clock12, longDay } from '../../../shared/lib/dates';
import { useDesktop, useNow } from '../../../shared/ui/hooks';
import { getFailures } from '../../auth/data/lockoutRepo';
import { MAX_FAILED_ATTEMPTS, remainingAttempts } from '../../auth/domain/lockout';
import { biometricErrorMessage, biometricProof, hasBiometric } from '../data/biometric';
import { deviceId } from '../data/device';
import { isDenied, unlockWithProof } from '../data/screenLockRepo';
import { normalizeDigits, PIN_LENGTH, pinProof } from '../domain/pin';

type Locked = Extract<SessionState, { status: 'screenLocked' }>;
type Msg = { text: string; kind: 'err' | 'info' } | null;

const LOCKED_OUT = `أُقفل الحساب بعد ${MAX_FAILED_ATTEMPTS} محاولات خاطئة. لا يفتحه إلا المالك.`;

/**
 * Approved lock screens: «د الحبر الليلي» on phones, «ط» on screens ≥ 900 px.
 * Unlocking is checked by the rules; on success the session snapshot flips
 * back to «ready» and the user is on the same page as before.
 */
export function LockScreen({ session }: { session: Locked }) {
  const { user, profile, settings, screen } = session;
  const wide = useDesktop();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [lockedOut, setLockedOut] = useState(false);
  const [shake, setShake] = useState(0);
  const [bio, setBio] = useState(() => hasBiometric(user.uid));
  const busyRef = useRef(false);
  const pinRef = useRef('');

  const fail = useCallback(async (text: string) => {
    pinRef.current = '';
    setPin('');
    setShake((n) => n + 1);
    setMsg({ text, kind: 'err' });
  }, []);

  const tryProof = useCallback(
    async (proof: string) => {
      busyRef.current = true;
      setBusy(true);
      setMsg(null);
      const { db } = fb();
      try {
        const r = await unlockWithProof(db, user.uid, user.email ?? '', proof, deviceId());
        if (r === 'ok') {
          setMsg({ text: 'تم الفتح', kind: 'info' });
          return; // the session switches back to the app
        }
        const left = remainingAttempts(await getFailures(db, user.email ?? ''));
        if (left === 0) {
          setLockedOut(true);
          return fail(LOCKED_OUT);
        }
        await fail(`رمز غير صحيح. تبقّى ${left} من ${MAX_FAILED_ATTEMPTS} محاولات.`);
      } catch (e) {
        reportError('unlock', e);
        if (isDenied(e)) {
          setLockedOut(true);
          return fail(LOCKED_OUT);
        }
        await fail(errorMessage(e));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [user, fail],
  );

  const press = useCallback(
    (k: string) => {
      if (busyRef.current || lockedOut) return;
      setMsg(null);
      const p = pinRef.current;
      const next = k === 'del' ? p.slice(0, -1) : p.length < PIN_LENGTH ? p + k : p;
      pinRef.current = next;
      setPin(next);
      if (next.length === PIN_LENGTH && p.length < PIN_LENGTH)
        void pinProof(user.uid, next).then(tryProof);
    },
    [lockedOut, tryProof, user.uid],
  );

  const unlockWithBiometric = useCallback(async () => {
    if (busyRef.current || lockedOut) return;
    setMsg(null);
    try {
      const r = await biometricProof(user.uid, screen.pinVer);
      if (r.kind === 'proof') return tryProof(r.proof);
      setBio(false);
      setMsg({
        text:
          r.kind === 'stale'
            ? 'تغيّر الرمز بعد تفعيل البصمة على هذا الجهاز. اكتب الرمز الجديد، ثم فعّل البصمة من «حسابي».'
            : 'البصمة غير مفعّلة على هذا الجهاز.',
        kind: 'err',
      });
    } catch (e) {
      reportError('biometric', e);
      setMsg({
        text: biometricErrorMessage(e) ?? errorMessage(e),
        kind: 'err',
      });
    }
  }, [lockedOut, screen.pinVer, tryProof, user.uid]);

  // Physical keyboard (desktop): digits incl. Arabic, Backspace.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const d = normalizeDigits(e.key);
      if (/^[0-9]$/.test(d)) {
        e.preventDefault();
        press(d);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        press('del');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press]);

  const roleLabel = settings.roleLabels[profile.role];
  const dots = (
    <div key={shake} className={`lock-dots${shake ? ' shake' : ''}`} aria-hidden="true">
      {Array.from({ length: PIN_LENGTH }, (_, i) => (
        <span key={i} className={i < pin.length ? 'on' : ''} />
      ))}
    </div>
  );
  const status = (
    <div
      className={`lock-msg${msg?.kind === 'err' ? ' err' : ''}`}
      role="status"
      aria-live="polite"
    >
      {busy ? 'جارٍ التحقق…' : (msg?.text ?? `أدخلت ${pin.length} من ${PIN_LENGTH} أرقام`)}
    </div>
  );
  const passwordLink = (
    <button type="button" className="lock-link" onClick={() => void logout()}>
      {lockedOut ? 'تسجيل الخروج' : 'الدخول بكلمة المرور'}
    </button>
  );

  if (wide)
    return (
      <main className="lock-wide" aria-label="البرنامج مقفل">
        <aside className="lock-side">
          <div className="lock-brand">دفتر حسابات الموردين</div>
          <Clock big />
        </aside>
        <section className="lock-main">
          <div className="lock-who">
            <span className="lock-avatar" aria-hidden="true">
              {profile.name.trim().charAt(0)}
            </span>
            <h1>{profile.name}</h1>
            <div className="muted">{roleLabel} · البرنامج مقفل</div>
          </div>
          {dots}
          {status}
          <Keypad variant="paper" onPress={press} disabled={busy || lockedOut} />
          <div className="lock-actions">
            {bio && (
              <button
                type="button"
                className="btn btn-go-outline"
                onClick={() => void unlockWithBiometric()}
                disabled={busy || lockedOut}
              >
                البصمة / الوجه
              </button>
            )}
            <button type="button" className="btn" onClick={() => void logout()}>
              {lockedOut ? 'تسجيل الخروج' : 'كلمة المرور'}
            </button>
          </div>
          <p className="lock-hint">يمكنك كتابة الرمز من لوحة المفاتيح مباشرة.</p>
        </section>
      </main>
    );

  return (
    <main className="lock-ink" aria-label="البرنامج مقفل">
      <Clock />
      <div className="lock-name">{profile.name}</div>
      {dots}
      {status}
      <Keypad
        variant="ink"
        onPress={press}
        disabled={busy || lockedOut}
        onBiometric={bio ? () => void unlockWithBiometric() : undefined}
      />
      {passwordLink}
    </main>
  );
}

function Clock({ big = false }: { big?: boolean }) {
  const now = useNow(15_000);
  const c = clock12(now);
  return (
    <div className="lock-clock-wrap">
      <div className={`lock-clock${big ? ' big' : ''}`}>
        <span className="ltr num">{c.time}</span> <small>{c.period}</small>
      </div>
      <div className="lock-date">{longDay(now)}</div>
    </div>
  );
}

const FINGERPRINT =
  'M6.5 10.5a5.5 5.5 0 0 1 11 0v2.5M9 21c1.5-2 2.2-4.6 2.2-7.5v-3a.8.8 0 0 1 1.6 0v3c0 3.4-.9 6.4-2.6 8.6M14.6 21.4c.9-1.9 1.4-4.3 1.4-6.9M4 13.5v-3a8 8 0 0 1 13.9-5.4';

function Keypad({
  variant,
  onPress,
  disabled,
  onBiometric,
}: {
  variant: 'ink' | 'paper';
  onPress: (k: string) => void;
  disabled: boolean;
  onBiometric?: () => void;
}) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'bio', '0', 'del'];
  return (
    <div className={`lock-pad ${variant}`}>
      {keys.map((k) => {
        if (k === 'bio')
          return onBiometric ? (
            <button
              key={k}
              type="button"
              className="plain"
              aria-label="البصمة أو الوجه"
              onClick={onBiometric}
              disabled={disabled}
            >
              <svg
                viewBox="0 0 24 24"
                width="28"
                height="28"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d={FINGERPRINT} />
              </svg>
            </button>
          ) : (
            <span key={k} aria-hidden="true" />
          );
        if (k === 'del')
          return (
            <button
              key={k}
              type="button"
              className="plain"
              aria-label="مسح رقم"
              onClick={() => onPress('del')}
              disabled={disabled}
            >
              مسح
            </button>
          );
        return (
          <button
            key={k}
            type="button"
            aria-label={`الرقم ${k}`}
            onClick={() => onPress(k)}
            disabled={disabled}
          >
            {k}
          </button>
        );
      })}
    </div>
  );
}
