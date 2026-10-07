import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import { useState, type FormEvent } from 'react';
import { errorMessage, reportError } from '../../../core/errors';
import { fb } from '../../../core/firebase';
import { recordFailure } from '../data/lockoutRepo';
import { MAX_FAILED_ATTEMPTS, WRONG_PASSWORD_CODES as WRONG_PASSWORD } from '../domain/lockout';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    if (!email.trim() || !password) return setError('أدخل البريد وكلمة المرور.');
    setBusy(true);
    try {
      await signInWithEmailAndPassword(fb().auth, email.trim(), password);
    } catch (err) {
      reportError('login', err);
      const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : '';
      if (WRONG_PASSWORD.has(code)) {
        // Count the failure (rules lock the account at 5). The counter cannot
        // grow past 5, so a refused write means the account is already locked.
        try {
          await recordFailure(fb().db, email);
          setError(
            `البريد أو كلمة المرور غير صحيحة. بعد ${MAX_FAILED_ATTEMPTS} محاولات فاشلة يُقفل الحساب ولا يفتحه إلا المالك.`,
          );
        } catch (e2) {
          reportError('login-failure-count', e2);
          setError(
            'البريد أو كلمة المرور غير صحيحة، وقد يكون الحساب مقفلاً بعد محاولات فاشلة. راجع المالك.',
          );
        }
      } else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setError('');
    setNotice('');
    if (!email.trim()) return setError('اكتب بريدك أولاً ثم اضغط «نسيت كلمة المرور».');
    setBusy(true);
    try {
      await sendPasswordResetEmail(fb().auth, email.trim());
    } catch (err) {
      // Unknown emails are not revealed; real failures are.
      const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : '';
      if (code !== 'auth/user-not-found') {
        reportError('reset', err);
        setBusy(false);
        return setError(errorMessage(err));
      }
    }
    setBusy(false);
    setNotice('إن كان البريد مسجلاً فسيصلك رابط لتعيين كلمة المرور. تحقق من البريد المهمل أيضاً.');
  };

  return (
    <main className="center-page">
      <form className="card" onSubmit={submit} noValidate>
        <div>
          <div className="serif" style={{ fontSize: 30, lineHeight: 1.3 }}>
            دفتر الموردين
          </div>
          <div className="muted" style={{ fontSize: 14 }}>
            تسجيل الدخول
          </div>
        </div>
        <div className="field">
          <label htmlFor="email">البريد الإلكتروني</label>
          <input
            id="email"
            className="input ltr"
            style={{ textAlign: 'right' }}
            type="email"
            autoComplete="username"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={200}
          />
        </div>
        <div className="field">
          <label htmlFor="password">كلمة المرور</label>
          <input
            id="password"
            className="input ltr"
            style={{ textAlign: 'right' }}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <div className="banner banner-err" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="banner banner-ok" role="status">
            {notice}
          </div>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'جارٍ…' : 'دخول'}
        </button>
        <button type="button" className="btn-link" onClick={reset} disabled={busy}>
          نسيت كلمة المرور
        </button>
      </form>
    </main>
  );
}
