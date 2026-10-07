import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { useEffect, useState, type FormEvent } from 'react';
import { errorMessage, reportError } from '../../../core/errors';
import { fb } from '../../../core/firebase';
import { useReady } from '../../../core/session';
import { useToast } from '../../../shared/ui/Toast';
import { recordFailure } from '../../auth/data/lockoutRepo';
import { WRONG_PASSWORD_CODES } from '../../auth/domain/lockout';
import {
  biometricErrorMessage,
  disableBiometric,
  enableBiometric,
  hasBiometric,
  platformAuthenticatorAvailable,
} from '../data/biometric';
import { deviceId } from '../data/device';
import { removePin, setPin } from '../data/screenLockRepo';
import { normalizeDigits, validatePin } from '../domain/pin';

/** «حسابي» → quick unlock: optional for every role. */
export function QuickUnlockSettings() {
  const { user, profile, screen } = useReady();
  const toast = useToast();
  const [form, setForm] = useState<null | { bio: boolean }>(null);
  const [password, setPassword] = useState('');
  const [pin, setPinText] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [bioHere, setBioHere] = useState(() => hasBiometric(user.uid));
  const [bioAvailable, setBioAvailable] = useState(false);

  useEffect(() => {
    let alive = true;
    void platformAuthenticatorAvailable().then((ok) => alive && setBioAvailable(ok));
    return () => {
      alive = false;
    };
  }, []);

  const open = (bio: boolean) => {
    setForm({ bio });
    setPassword('');
    setPinText('');
    setPin2('');
    setError('');
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const email = user.email ?? '';
    const pinErr = validatePin(pin);
    if (!password) return setError('اكتب كلمة المرور الحالية.');
    if (pinErr) return setError(pinErr);
    if (normalizeDigits(pin) !== normalizeDigits(pin2)) return setError('الرمزان غير متطابقين.');
    setBusy(true);
    setError('');
    const { db } = fb();
    try {
      // The rules accept a new PIN only within 5 minutes of a password check.
      try {
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(email, password));
        await user.getIdToken(true);
      } catch (err) {
        const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : '';
        if (WRONG_PASSWORD_CODES.has(code)) {
          await recordFailure(db, email).catch((e2: unknown) => reportError('reauth-count', e2));
          return setError('كلمة المرور غير صحيحة. تُحسب ضمن المحاولات الخمس.');
        }
        throw err;
      }
      const { proof, pinVer } = await setPin(db, user.uid, pin, deviceId(), screen.atMs > 0);
      // A fingerprint key made for the old PIN is useless now.
      disableBiometric(user.uid);
      setBioHere(false);
      if (form.bio) {
        try {
          await enableBiometric({ uid: user.uid, email, name: profile.name }, proof, pinVer);
          setBioHere(true);
        } catch (err) {
          reportError('biometric-enable', err);
          toast.error(
            `حُفظ الرمز، لكن تعذّر تفعيل البصمة/الوجه: ${biometricErrorMessage(err) ?? errorMessage(err)}`,
          );
          setForm(null);
          return;
        }
      }
      toast.info(
        form.bio ? 'حُفظ الرمز وفُعّلت البصمة/الوجه على هذا الجهاز.' : 'حُفظ رمز الدخول السريع.',
      );
      setForm(null);
    } catch (err) {
      reportError('pin-save', err);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      setPassword('');
    }
  };

  const turnOff = async () => {
    setBusy(true);
    try {
      await removePin(fb().db, user.uid);
      disableBiometric(user.uid);
      setBioHere(false);
      setConfirmOff(false);
      toast.info('أُوقف الدخول السريع. بعد مدة الخمول يُسجَّل خروجك.');
    } catch (err) {
      reportError('pin-remove', err);
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="stack" style={{ gap: 10 }} aria-labelledby="qu-title">
      <h2 id="qu-title" className="serif" style={{ margin: 0, fontSize: 20 }}>
        الدخول السريع
      </h2>
      <p className="hint" style={{ margin: 0, lineHeight: 1.8 }}>
        {screen.pinSet
          ? 'مفعّل: بعد مدة الخمول يُقفل البرنامج، ويُفتح برمزك المكوّن من 6 أرقام على كل أجهزتك.'
          : 'غير مفعّل: بعد مدة الخمول يُسجَّل خروجك وتدخل بكلمة المرور.'}
      </p>
      {screen.pinSet && (
        <p className="hint" style={{ margin: 0 }}>
          البصمة/الوجه على هذا الجهاز: <strong>{bioHere ? 'مفعّلة' : 'غير مفعّلة'}</strong>
        </p>
      )}

      {!form && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={() => open(false)} disabled={busy}>
            {screen.pinSet ? 'تغيير الرمز' : 'تفعيل الدخول السريع'}
          </button>
          {screen.pinSet && bioAvailable && !bioHere && (
            <button
              type="button"
              className="btn btn-go-outline"
              onClick={() => open(true)}
              disabled={busy}
            >
              تفعيل البصمة/الوجه هنا
            </button>
          )}
          {bioHere && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                disableBiometric(user.uid);
                setBioHere(false);
                toast.info('أُوقفت البصمة/الوجه على هذا الجهاز.');
              }}
            >
              إيقاف البصمة هنا
            </button>
          )}
          {screen.pinSet &&
            (confirmOff ? (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void turnOff()}
                disabled={busy}
              >
                تأكيد إيقاف الدخول السريع
              </button>
            ) : (
              <button type="button" className="btn btn-danger" onClick={() => setConfirmOff(true)}>
                إيقاف الدخول السريع
              </button>
            ))}
        </div>
      )}

      {form && (
        <form className="stack" style={{ gap: 10 }} onSubmit={(e) => void save(e)} noValidate>
          {form.bio && (
            <p className="hint" style={{ margin: 0 }}>
              اكتب رمزك الحالي (أو رمزاً جديداً) ليُربط بالبصمة/الوجه على هذا الجهاز.
            </p>
          )}
          <label htmlFor="qu-pw" style={{ fontSize: 14, fontWeight: 500 }}>
            كلمة المرور الحالية
          </label>
          <input
            id="qu-pw"
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <label htmlFor="qu-pin" style={{ fontSize: 14, fontWeight: 500 }}>
            رمز الدخول السريع (6 أرقام)
          </label>
          <input
            id="qu-pin"
            className="input num ltr"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={6}
            value={pin}
            onChange={(e) => setPinText(normalizeDigits(e.target.value).replace(/\D/g, ''))}
          />
          <label htmlFor="qu-pin2" style={{ fontSize: 14, fontWeight: 500 }}>
            تأكيد الرمز
          </label>
          <input
            id="qu-pin2"
            className="input num ltr"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={6}
            value={pin2}
            onChange={(e) => setPin2(normalizeDigits(e.target.value).replace(/\D/g, ''))}
          />
          {bioAvailable && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
              <input
                type="checkbox"
                checked={form.bio}
                onChange={(e) => setForm({ bio: e.target.checked })}
              />
              استخدام البصمة/الوجه على هذا الجهاز أيضاً
            </label>
          )}
          {error && (
            <div className="banner banner-err" role="alert">
              {error}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'جارٍ الحفظ…' : 'حفظ'}
            </button>
            <button type="button" className="btn" onClick={() => setForm(null)} disabled={busy}>
              إلغاء
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
