import { useEffect, useState } from 'react';
import { errorMessage, reportError } from '../../../core/errors';
import { fb, withSecondaryAuth } from '../../../core/firebase';
import { useReady } from '../../../core/session';
import { ErrorBox, Loading } from '../../../core/Shell';
import { Sheet } from '../../../shared/ui/Sheet';
import { useToast } from '../../../shared/ui/Toast';
import { listAccounts } from '../../accounts/data/accountsRepo';
import type { Account } from '../../accounts/domain/types';
import { createUser, listUsers, renameSelf, sendReset, updateUser } from '../data/usersRepo';
import {
  can,
  validatePassword,
  validateUserForm,
  type Role,
  type UserProfile,
} from '../domain/types';
import { getFailures, unlockAccount } from '../../auth/data/lockoutRepo';
import { isLocked, MAX_FAILED_ATTEMPTS } from '../../auth/domain/lockout';

type Editing = { mode: 'new' } | { mode: 'edit'; user: UserProfile };

export function UsersPage() {
  const { profile, settings } = useReady();
  const [users, setUsers] = useState<UserProfile[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);
  // Failed-attempt counters by user id (readable by the owner only).
  const [fails, setFails] = useState<Record<string, number>>({});

  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => {
    setError('');
    setReloadKey((k) => k + 1);
  };

  useEffect(() => {
    let alive = true;
    const { db } = fb();
    Promise.all([listUsers(db), listAccounts(db)])
      .then(async ([u, a]) => {
        if (!alive) return;
        setUsers(u);
        setAccounts(a.sort((x, y) => x.name.localeCompare(y.name, 'ar')));
        if (profile.role === 'owner') {
          const counts = await Promise.all(u.map((x) => getFailures(db, x.email)));
          if (alive) setFails(Object.fromEntries(u.map((x, i) => [x.id, counts[i] ?? 0])));
        }
      })
      .catch((e) => {
        reportError('users', e);
        if (alive) setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [reloadKey, profile.role]);

  if (!can.manageUsers(profile.role))
    return <ErrorBox message="إدارة المستخدمين للمالك والإدارة فقط." />;

  const chip = (r: Role) =>
    r === 'owner'
      ? { background: 'var(--ink)', color: 'var(--paper)' }
      : r === 'admin'
        ? { border: '1.5px solid var(--ink)' }
        : { background: 'var(--fill)' };

  return (
    <>
      <header className="page-head">
        <div className="row-between">
          <h1>المستخدمون</h1>
          <button
            type="button"
            className="btn btn-primary"
            style={{ minHeight: 44 }}
            onClick={() => setEditing({ mode: 'new' })}
          >
            + مستخدم
          </button>
        </div>
      </header>
      {error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : !users ? (
        <Loading />
      ) : (
        <>
          {users.map((u) => (
            <button
              key={u.id}
              type="button"
              className="list-row"
              style={{ minHeight: 76 }}
              onClick={() => setEditing({ mode: 'edit', user: u })}
            >
              <span
                className="avatar"
                style={{ background: 'var(--fill)', border: 0 }}
                aria-hidden="true"
              >
                {[...u.name][0] ?? '؟'}
              </span>
              <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 600 }}>
                  {u.name}
                  {u.id === profile.id && (
                    <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
                      {' '}
                      (أنت)
                    </span>
                  )}
                </span>
                <span
                  className="muted"
                  style={{
                    display: 'block',
                    fontSize: 13,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {u.role === 'entry'
                    ? `${u.assignedAccounts.length} حساب مسند · `
                    : u.role === 'owner'
                      ? 'محمي · '
                      : 'كل الحسابات · '}
                  {u.active ? 'مفعّل' : 'موقوف'} · <span className="ltr">{u.email}</span>
                </span>
              </span>
              {isLocked(fails[u.id] ?? 0) && (
                <span
                  className="chip"
                  style={{ background: 'var(--alayh-bg)', color: 'var(--alayh-ink)' }}
                >
                  مقفل
                </span>
              )}
              <span className="chip" style={chip(u.role)}>
                {settings.roleLabels[u.role]}
              </span>
            </button>
          ))}
          <p
            className="muted"
            style={{ margin: 0, padding: '16px var(--gutter)', fontSize: 13, lineHeight: 1.7 }}
          >
            {settings.roleLabels.entry} يرى الحسابات المسندة له فقط. مسميات الأدوار تُغيَّر من
            الإعدادات، والصلاحيات ثابتة لكل دور.
          </p>
        </>
      )}
      {editing && (
        <UserSheet
          editing={editing}
          accounts={accounts}
          fails={editing.mode === 'edit' ? (fails[editing.user.id] ?? 0) : 0}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </>
  );
}

function UserSheet({
  editing,
  accounts,
  fails,
  onClose,
  onSaved,
}: {
  editing: Editing;
  accounts: Account[];
  fails: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user: me, profile, settings } = useReady();
  const toast = useToast();
  const target = editing.mode === 'edit' ? editing.user : null;
  const isOwnerTarget = target?.role === 'owner';
  const isSelf = target?.id === profile.id;
  // Owner: only his own name. Others: managers edit non-owner users other than themselves.
  const canEditAll = !target || can.editUser(profile, target);
  const canRename = canEditAll || (isSelf && profile.role === 'owner');

  const [name, setName] = useState(target?.name ?? '');
  const [email, setEmail] = useState(target?.email ?? '');
  const [role, setRole] = useState<'admin' | 'entry'>(target?.role === 'admin' ? 'admin' : 'entry');
  const [active, setActive] = useState(target?.active ?? true);
  const [assigned, setAssigned] = useState<string[]>(target?.assignedAccounts ?? []);
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [errors, setErrors] = useState<Partial<Record<'name' | 'email' | 'password', string>>>({});
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const errs: Partial<Record<'name' | 'email' | 'password', string>> = validateUserForm({
      name,
      email,
    });
    if (!target) {
      const pe = validatePassword(password);
      if (pe) errs.password = pe;
      else if (password !== password2) errs.password = 'كلمتا المرور غير متطابقتين.';
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const { db } = fb();
      if (!target) {
        await createUser(
          db,
          me.uid,
          { name, email, role, active, assignedAccounts: assigned },
          password,
          withSecondaryAuth,
        );
        setPassword('');
        setPassword2('');
        toast.info(
          'أُنشئ المستخدم. سلّمه كلمة المرور بنفسك؛ ويغيّرها لاحقاً من «نسيت كلمة المرور».',
        );
      } else if (isSelf && profile.role === 'owner') {
        await renameSelf(db, me.uid, name);
        toast.info('حُفظ الاسم.');
      } else {
        await updateUser(db, me.uid, target.id, { name, role, active, assignedAccounts: assigned });
        toast.info('حُفظت بيانات المستخدم.');
      }
      onSaved();
    } catch (e) {
      reportError('user-save', e);
      toast.error(errorMessage(e));
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await sendReset(fb().auth, target.email);
      toast.info(`أُرسل رابط تعيين كلمة المرور إلى ${target.email}.`);
    } catch (e) {
      reportError('user-reset', e);
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const unlock = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await unlockAccount(fb().db, me.uid, target.email);
      toast.info(`فُكّ إيقاف ${target.name}.`);
      onSaved();
    } catch (e) {
      reportError('user-unlock', e);
      toast.error(errorMessage(e));
      setBusy(false);
    }
  };

  const roleCard = (k: 'admin' | 'entry', sub: string) => (
    <button
      type="button"
      aria-pressed={role === k}
      onClick={() => setRole(k)}
      disabled={!canEditAll}
      style={{
        minHeight: 64,
        padding: '8px 12px',
        textAlign: 'right',
        borderRadius: 12,
        fontSize: 14,
        background: role === k ? 'var(--ink)' : 'var(--white)',
        color: role === k ? 'var(--paper)' : 'var(--ink)',
        border: `1.5px solid ${role === k ? 'var(--ink)' : 'var(--rule)'}`,
      }}
    >
      <span style={{ display: 'block', fontWeight: 600 }}>{settings.roleLabels[k]}</span>
      <span style={{ display: 'block', fontSize: 12, marginTop: 2, opacity: 0.85 }}>{sub}</span>
    </button>
  );

  return (
    <Sheet
      title={target ? 'تعديل المستخدم' : 'مستخدم جديد'}
      onClose={onClose}
      badge={
        isOwnerTarget ? (
          <span className="chip" style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}>
            حساب محمي
          </span>
        ) : undefined
      }
    >
      <div className="field">
        <label htmlFor="u-name">الاسم</label>
        <input
          id="u-name"
          className="input"
          style={{ background: 'var(--white)' }}
          value={name}
          maxLength={80}
          disabled={!canRename}
          aria-invalid={!!errors.name}
          onChange={(e) => setName(e.target.value)}
        />
        {errors.name && <div className="error-text">{errors.name}</div>}
      </div>
      <div className="field">
        <label htmlFor="u-mail">البريد الإلكتروني (لتسجيل الدخول)</label>
        <input
          id="u-mail"
          type="email"
          className="input ltr"
          style={{ background: 'var(--white)', textAlign: 'right' }}
          value={email}
          maxLength={200}
          disabled={!!target}
          aria-invalid={!!errors.email}
          placeholder="name@example.com"
          onChange={(e) => setEmail(e.target.value)}
        />
        {errors.email && <div className="error-text">{errors.email}</div>}
      </div>
      {!target && (
        <div className="field">
          <label htmlFor="u-pass">كلمة المرور الأولى</label>
          <input
            id="u-pass"
            type="password"
            autoComplete="new-password"
            className="input ltr"
            style={{ background: 'var(--white)', textAlign: 'right' }}
            value={password}
            maxLength={128}
            aria-invalid={!!errors.password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <label htmlFor="u-pass2" className="sr-only">
            تأكيد كلمة المرور
          </label>
          <input
            id="u-pass2"
            type="password"
            autoComplete="new-password"
            placeholder="أعد كتابتها للتأكيد"
            className="input ltr"
            style={{ background: 'var(--white)', textAlign: 'right' }}
            value={password2}
            maxLength={128}
            onChange={(e) => setPassword2(e.target.value)}
          />
          {errors.password ? (
            <div className="error-text">{errors.password}</div>
          ) : (
            <span className="hint">10 أحرف على الأقل، فيها حروف وأرقام. لا تُحفظ في البرنامج.</span>
          )}
        </div>
      )}
      {target && profile.role === 'owner' && isLocked(fails) && (
        <div className="banner banner-err row-between" role="alert">
          <span>الحساب مقفل بعد {MAX_FAILED_ATTEMPTS} محاولات فاشلة.</span>
          <button type="button" className="btn btn-sm" onClick={unlock} disabled={busy}>
            فك الإيقاف
          </button>
        </div>
      )}

      {isOwnerTarget ? (
        <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.7 }}>
          دور المالك وصلاحياته لا تتغير ولا يُحذف حسابه. يمكن تعديل الاسم فقط، ومسمى الدور من
          الإعدادات.
        </p>
      ) : isSelf ? (
        <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.7 }}>
          لا يمكنك تعديل دورك أو صلاحياتك بنفسك. يعدّلها المالك.
        </p>
      ) : (
        <>
          <div className="field">
            <span className="label">الدور</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {roleCard('admin', 'كل الحسابات والمستخدمين')}
              {roleCard('entry', 'حساباته المسندة فقط')}
            </div>
          </div>
          {role === 'entry' && (
            <div className="field">
              <span className="label">الحسابات المسندة ({assigned.length})</span>
              {accounts.length === 0 && <span className="hint">لا توجد حسابات بعد.</span>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {accounts.map((a) => {
                  const on = assigned.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setAssigned(on ? assigned.filter((x) => x !== a.id) : [...assigned, a.id])
                      }
                      style={{
                        minHeight: 40,
                        padding: '0 12px',
                        borderRadius: 999,
                        fontSize: 13,
                        background: on ? 'var(--lah)' : 'var(--white)',
                        color: on ? 'var(--white)' : 'var(--ink)',
                        border: `1.5px solid ${on ? 'var(--lah)' : 'var(--rule)'}`,
                      }}
                    >
                      {on && '✓ '}
                      {a.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div
            className="row-between"
            style={{ padding: '10px 0', borderTop: '1px solid var(--rule)' }}
          >
            <span>
              <span style={{ display: 'block', fontSize: 15, fontWeight: 500 }}>الحساب مفعّل</span>
              <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                الإيقاف يمنع الوصول للبيانات دون حذف السجل
              </span>
            </span>
            <button
              type="button"
              className="switch"
              role="switch"
              aria-checked={active}
              aria-label="تفعيل الحساب"
              onClick={() => setActive(!active)}
            />
          </div>
        </>
      )}

      {target && !isSelf && (
        <button
          type="button"
          className="btn-link"
          style={{ alignSelf: 'flex-start', fontSize: 14 }}
          onClick={reset}
          disabled={busy}
        >
          إرسال رابط تعيين كلمة المرور
        </button>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={save}
          disabled={busy || !canRename}
        >
          {busy ? 'جارٍ…' : 'حفظ'}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          إلغاء
        </button>
      </div>
    </Sheet>
  );
}
