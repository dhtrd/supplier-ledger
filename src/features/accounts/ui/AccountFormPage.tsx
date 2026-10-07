import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { errorMessage, reportError } from '../../../core/errors';
import { fb } from '../../../core/firebase';
import { useReady } from '../../../core/session';
import { ErrorBox, Loading } from '../../../core/Shell';
import { compressImage } from '../../../shared/lib/image';
import { Icon } from '../../../shared/ui/Icon';
import { Logo } from '../../../shared/ui/Logo';
import { useToast } from '../../../shared/ui/Toast';
import { can } from '../../users/domain/types';
import { createAccount, getAccounts, updateAccount } from '../data/accountsRepo';
import {
  GROUP_LABEL,
  LOGO_MAX_BYTES,
  validateAccountForm,
  type AccountForm,
  type AccountGroup,
} from '../domain/types';

export function AccountFormPage() {
  const { id } = useParams();
  const isNew = !id;
  const { user, profile } = useReady();
  const navigate = useNavigate();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<AccountForm>({ name: '', phone: '', group: 'suppliers' });
  const [logo, setLogo] = useState<Uint8Array | null>(null);
  const [loaded, setLoaded] = useState(isNew);
  const [loadError, setLoadError] = useState('');
  const [errors, setErrors] = useState<Partial<Record<keyof AccountForm, string>>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    getAccounts(fb().db, [id])
      .then(([a]) => {
        if (!a) return setLoadError('الحساب غير موجود.');
        setForm({ name: a.name, phone: a.phone, group: a.group });
        setLogo(a.logo);
        setLoaded(true);
      })
      .catch((e) => {
        reportError('account-load', e);
        setLoadError(errorMessage(e));
      });
  }, [id]);

  if (!can.manageAccounts(profile.role))
    return <ErrorBox message="إضافة الحسابات وتعديلها للمالك والإدارة فقط." />;
  if (loadError) return <ErrorBox message={loadError} />;
  if (!loaded) return <Loading />;

  const pickLogo = async (file: File | undefined) => {
    if (!file) return;
    try {
      const img = await compressImage(file, { maxBytes: LOGO_MAX_BYTES - 1024, maxSide: 400 });
      setLogo(img.data);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs = validateAccountForm(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const { db } = fb();
      if (id) {
        await updateAccount(db, user.uid, id, form, logo);
        toast.info('حُفظت بيانات الحساب.');
        navigate(`/a/${id}`, { replace: true });
      } else {
        const newId = await createAccount(db, user.uid, form, logo);
        toast.info('أُضيف الحساب.');
        navigate(`/a/${newId}`, { replace: true });
      }
    } catch (err) {
      reportError('account-save', err);
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <div
        className="row-between no-print"
        style={{
          padding: '8px 8px 12px',
          borderBottom: '2px solid var(--ink)',
          justifyContent: 'flex-start',
        }}
      >
        <Link to={id ? `/a/${id}` : '/'} className="icon-btn" aria-label="رجوع">
          <Icon name="back" />
        </Link>
        <h1 className="serif" style={{ margin: 0, fontSize: 22 }}>
          {isNew ? 'حساب جديد' : 'تعديل الحساب'}
        </h1>
      </div>
      <div className="pad stack" style={{ maxWidth: 640 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Logo data={logo} size={88} placeholder="شعار الحساب" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
              {logo ? 'تغيير الشعار' : 'إضافة شعار'}
            </button>
            {logo && (
              <button type="button" className="btn btn-sm btn-quiet" onClick={() => setLogo(null)}>
                إزالة الشعار
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => void pickLogo(e.target.files?.[0])}
            />
          </div>
        </div>
        <p className="hint" style={{ margin: 0 }}>
          الشعار والاسم يظهران على سندات الدفع وصفحة التوقيع لهذا الحساب.
        </p>

        <div className="field">
          <label htmlFor="a-name">اسم العرض</label>
          <input
            id="a-name"
            className="input"
            value={form.name}
            maxLength={120}
            aria-invalid={!!errors.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          {errors.name && <div className="error-text">{errors.name}</div>}
        </div>
        <div className="field">
          <label htmlFor="a-phone">الجوال (لإرسال رابط التوقيع عبر واتساب)</label>
          <input
            id="a-phone"
            className="input ltr num"
            style={{ textAlign: 'right' }}
            inputMode="tel"
            value={form.phone}
            maxLength={20}
            aria-invalid={!!errors.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="05XXXXXXXX"
          />
          {errors.phone && <div className="error-text">{errors.phone}</div>}
        </div>
        <div className="field">
          <span className="label">المجموعة</span>
          <div className="seg" role="group" aria-label="المجموعة">
            {(Object.keys(GROUP_LABEL) as AccountGroup[]).map((g) => (
              <button
                key={g}
                type="button"
                aria-pressed={form.group === g}
                onClick={() => setForm({ ...form, group: g })}
              >
                {GROUP_LABEL[g]}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="bottom-actions">
        <button
          type="submit"
          className="btn btn-primary btn-block"
          disabled={busy}
          style={{ maxWidth: 640 }}
        >
          {busy ? 'جارٍ الحفظ…' : 'حفظ'}
        </button>
      </div>
    </form>
  );
}
