import { formatDateTime } from '../../../shared/lib/dates';
import { useEffect, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage, reportError } from '../../../core/errors';
import { fb } from '../../../core/firebase';
import { logout, useReady } from '../../../core/session';
import { useToast } from '../../../shared/ui/Toast';
import { useDesktop } from '../../../shared/ui/hooks';
import { can, type Role } from '../../users/domain/types';
import { BackupNow } from '../../backup/ui/BackupNow';
import { QuickUnlockSettings } from '../../quickUnlock/ui/QuickUnlockSettings';
import { getBackupMeta, saveSettings, type BackupMeta } from '../data/settingsRepo';
import {
  ageLabel,
  backupState,
  COUNTDOWN_MAX,
  COUNTDOWN_MIN,
  IDLE_MINUTES_MAX,
  IDLE_MINUTES_MIN,
  LINK_MINUTES_MAX,
  LINK_MINUTES_MIN,
  validateSettings,
  type AppSettings,
} from '../domain/types';

const PRESETS = [
  { v: 15, l: '15 د' },
  { v: 30, l: '30 د' },
  { v: 60, l: 'ساعة' },
  { v: 120, l: 'ساعتان' },
];
const SPARK_BYTES = 1024 ** 3;

interface NavItem {
  id: string;
  label: string;
}

function navItems(role: Role): NavItem[] {
  const owner = can.editSettings(role);
  // Same order as the cards on the page.
  return [
    ...(owner
      ? [
          { id: 's-voucher', label: 'نص السندات' },
          { id: 's-link', label: 'رابط التوقيع' },
          { id: 's-idle', label: 'الخمول والخروج' },
          { id: 's-roles', label: 'مسميات الأدوار' },
        ]
      : []),
    ...(owner
      ? [
          { id: 's-backup', label: 'النسخ الاحتياطي' },
          { id: 's-storage', label: 'المساحة' },
        ]
      : []),
    { id: 's-quick', label: 'الدخول السريع' },
    ...(can.backupNow(role) ? [{ id: 's-snapshot', label: 'نسخة لحظية' }] : []),
    { id: 's-account', label: 'الحساب والسجل' },
  ];
}

export function SettingsPage() {
  const { profile, settings } = useReady();
  const isOwner = can.editSettings(profile.role);
  const desktop = useDesktop();
  const items = navItems(profile.role);
  const [currentId, setCurrentId] = useState(items[0]?.id ?? '');

  // Highlight the section in view (desktop side nav only).
  useEffect(() => {
    if (!desktop || typeof IntersectionObserver === 'undefined') return;
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (list) => {
        for (const e of list) seen.set(e.target.id, e.isIntersecting);
        const first = items.find((i) => seen.get(i.id));
        if (first) setCurrentId(first.id);
      },
      { rootMargin: '-10% 0px -60% 0px' },
    );
    for (const i of items) {
      const el = document.getElementById(i.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- items derive from the role only
  }, [desktop, profile.role]);

  const go = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    // Hash routing: a plain #id link would change the route, so scroll instead.
    e.preventDefault();
    setCurrentId(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <>
      <header className="page-head" style={{ gap: 2 }}>
        <h1>{isOwner ? 'الإعدادات' : 'حسابي'}</h1>
        <div className="muted" style={{ fontSize: 13 }}>
          {profile.name} · {settings.roleLabels[profile.role]} ·{' '}
          <span className="ltr">{profile.email}</span>
        </div>
      </header>
      <div className="pad set-layout">
        <nav className="set-nav" aria-label="أقسام الإعدادات">
          {items.map((i) => (
            <a
              key={i.id}
              href={`#${i.id}`}
              aria-current={currentId === i.id ? 'true' : undefined}
              onClick={(e) => go(e, i.id)}
            >
              {i.label}
            </a>
          ))}
        </nav>
        <div className="stack" style={{ gap: 22, maxWidth: desktop ? 760 : 640 }}>
          {isOwner && <OwnerSettings />}
          <QuickUnlockSettings />
          {can.backupNow(profile.role) && <BackupNow />}
          <section className="stack set-card" id="s-account" style={{ gap: 10 }}>
            {can.viewAudit(profile.role) && (
              <Link to="/audit" className="btn" style={{ justifyContent: 'space-between' }}>
                سجل التعديلات والحذف
                <span aria-hidden="true">←</span>
              </Link>
            )}
            <button type="button" className="btn btn-danger" onClick={() => void logout()}>
              تسجيل الخروج
            </button>
          </section>
        </div>
      </div>
    </>
  );
}

function OwnerSettings() {
  const { user, settings } = useReady();
  const toast = useToast();
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<BackupMeta | null>(null);
  const [metaError, setMetaError] = useState('');
  const [now] = useState(() => Date.now());

  useEffect(() => {
    getBackupMeta(fb().db)
      .then(setMeta)
      .catch((e) => {
        reportError('backup-meta', e);
        setMetaError(errorMessage(e));
      });
  }, []);

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const save = async () => {
    const err = validateSettings(draft);
    if (err) return toast.error(err);
    setBusy(true);
    try {
      await saveSettings(fb().db, user.uid, draft);
      toast.info('حُفظت الإعدادات.');
    } catch (e) {
      reportError('settings-save', e);
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const state = meta ? backupState(meta.lastBackupMs, now) : null;
  const min = draft.linkMinutes;
  const setMin = (v: number) =>
    setDraft({ ...draft, linkMinutes: Math.min(LINK_MINUTES_MAX, Math.max(LINK_MINUTES_MIN, v)) });

  return (
    <>
      {state === 'late' && meta?.lastBackupMs && (
        <div className="banner banner-err" role="alert">
          <strong>تنبيه:</strong> آخر نسخة احتياطية قبل {ageLabel(now - meta.lastBackupMs)}. تحقّق
          من سير العمل «Backup» في GitHub Actions.
        </div>
      )}
      {state === 'none' && (
        <div className="banner banner-warn" role="alert">
          لم تُسجَّل أي نسخة احتياطية بعد. شغّل سير العمل «Backup» يدوياً مرة.
        </div>
      )}

      <section className="stack set-card" id="s-voucher" style={{ gap: 10 }}>
        <h2 className="serif" style={{ margin: 0, fontSize: 20 }}>
          نص السندات
        </h2>
        <label htmlFor="payer" style={{ fontSize: 14, fontWeight: 500 }}>
          اسم الدافع في نص السند
        </label>
        <input
          id="payer"
          className="input"
          value={draft.payerName}
          maxLength={100}
          onChange={(e) => setDraft({ ...draft, payerName: e.target.value })}
        />
        <p className="hint" style={{ margin: 0 }}>
          يظهر في السطر «دفعة من …» فقط. هوية السند (الشعار والاسم) للمورد أو العميل.
        </p>
      </section>

      <section className="stack set-card" id="s-link" style={{ gap: 10 }}>
        <h2 className="serif" style={{ margin: 0, fontSize: 20 }}>
          صلاحية رابط التوقيع
        </h2>
        <div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 8 }}
          role="group"
          aria-label="مدة صلاحية الرابط"
        >
          {PRESETS.map((p) => (
            <button
              key={p.v}
              type="button"
              aria-pressed={min === p.v}
              onClick={() => setMin(p.v)}
              style={{
                minHeight: 48,
                borderRadius: 10,
                fontWeight: 600,
                background: min === p.v ? 'var(--ink)' : 'var(--white)',
                color: min === p.v ? 'var(--paper)' : 'var(--ink)',
                border: `1.5px solid ${min === p.v ? 'var(--ink)' : 'var(--rule)'}`,
              }}
            >
              {p.l}
            </button>
          ))}
        </div>
        <div
          className="row-between"
          style={{
            padding: '10px 12px',
            border: '1.5px solid var(--rule)',
            borderRadius: 12,
            background: 'var(--white)',
          }}
        >
          <span style={{ fontSize: 14 }}>مدة مخصصة</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="icon-btn"
              style={{ border: '1px solid var(--rule)', width: 40, height: 40, fontSize: 20 }}
              aria-label="إنقاص 5 دقائق"
              onClick={() => setMin(min - 5)}
            >
              −
            </button>
            <span
              className="num"
              style={{ minWidth: 80, textAlign: 'center', fontSize: 17, fontWeight: 600 }}
            >
              {min} دقيقة
            </span>
            <button
              type="button"
              className="icon-btn"
              style={{ border: '1px solid var(--rule)', width: 40, height: 40, fontSize: 20 }}
              aria-label="زيادة 5 دقائق"
              onClick={() => setMin(min + 5)}
            >
              +
            </button>
          </div>
        </div>
        <p className="hint" style={{ margin: 0 }}>
          من {LINK_MINUTES_MIN} دقائق إلى 24 ساعة. تُطبّق على الروابط الجديدة فقط، والرابط يُلغى فور
          التوقيع.
        </p>
      </section>

      <section className="stack set-card" id="s-idle" style={{ gap: 10 }}>
        <h2 className="serif" style={{ margin: 0, fontSize: 20 }}>
          الخمول والخروج التلقائي
        </h2>
        <Stepper
          label="مدة الخمول قبل التنبيه"
          unit="دقيقة"
          value={draft.idleMinutes}
          step={5}
          min={IDLE_MINUTES_MIN}
          max={IDLE_MINUTES_MAX}
          onChange={(v) => setDraft({ ...draft, idleMinutes: v })}
        />
        <Stepper
          label="العد التنازلي قبل الخروج"
          unit="ثانية"
          value={draft.idleCountdownSeconds}
          step={5}
          min={COUNTDOWN_MIN}
          max={COUNTDOWN_MAX}
          onChange={(v) => setDraft({ ...draft, idleCountdownSeconds: v })}
        />
        <p className="hint" style={{ margin: 0 }}>
          تنطبق على كل المستخدمين. عند انتهاء العد يُسجَّل الخروج، أو تُقفل الشاشة إن فعّل المستخدم
          الدخول السريع على جهازه.
        </p>
      </section>

      <section className="stack set-card" id="s-roles" style={{ gap: 10 }}>
        <h2 className="serif" style={{ margin: 0, fontSize: 20 }}>
          مسميات الأدوار
        </h2>
        <p className="hint" style={{ margin: 0 }}>
          الاسم الظاهر فقط؛ الصلاحيات لا تتغير.
        </p>
        {(
          [
            ['owner', 'دور المالك'],
            ['admin', 'دور الإدارة'],
            ['entry', 'دور الإدخال'],
          ] as const
        ).map(([k, l]) => (
          <div
            key={k}
            style={{
              display: 'grid',
              gridTemplateColumns: '96px 1fr',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <label htmlFor={`r-${k}`} className="muted" style={{ fontSize: 13 }}>
              {l}
            </label>
            <input
              id={`r-${k}`}
              className="input"
              maxLength={40}
              value={draft.roleLabels[k]}
              onChange={(e) =>
                setDraft({ ...draft, roleLabels: { ...draft.roleLabels, [k]: e.target.value } })
              }
            />
          </div>
        ))}
      </section>

      <div className="set-save">
        <button
          type="button"
          className="btn btn-primary"
          style={{ flex: '1 1 220px', minHeight: 52 }}
          onClick={save}
          disabled={busy || !dirty}
        >
          {busy ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'}
        </button>
        {dirty && !busy && (
          <button type="button" className="btn" onClick={() => setDraft(settings)}>
            تراجع
          </button>
        )}
        <span className="hint" role="status" aria-live="polite">
          {dirty ? 'تغييرات غير محفوظة' : 'لا تغييرات غير محفوظة'}
        </span>
      </div>

      <section className="stack set-card" id="s-backup" style={{ gap: 10 }}>
        <h2 className="serif" style={{ margin: 0, fontSize: 20 }}>
          النسخ الاحتياطي
        </h2>
        {metaError ? (
          <div className="banner banner-err">{metaError}</div>
        ) : !meta ? (
          <div className="muted">جارٍ التحميل…</div>
        ) : (
          <div
            style={{
              padding: 14,
              borderRadius: 12,
              background: 'var(--white)',
              border: `1.5px solid ${state === 'ok' ? 'var(--rule)' : 'var(--alayh)'}`,
            }}
          >
            <div className="row-between">
              <span style={{ fontWeight: 600 }}>
                {meta.lastBackupMs
                  ? `آخر نسخة: ${formatDateTime(meta.lastBackupMs)}`
                  : 'لا توجد نسخة بعد'}
              </span>
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: state === 'ok' ? 'var(--lah)' : 'var(--alayh)',
                }}
                aria-hidden="true"
              />
            </div>
            <div className="muted num" style={{ fontSize: 13, marginTop: 6, lineHeight: 1.8 }}>
              إلى Dropbox يومياً الساعة 12:00 ظهراً بتوقيت الرياض
              {meta.lastBackupMs && (
                <>
                  <br />
                  {meta.docs} مستند · {meta.images} صورة جديدة في آخر نسخة
                </>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="stack set-card" id="s-storage" style={{ gap: 10 }}>
        <h2 className="serif" style={{ margin: 0, fontSize: 20 }}>
          مساحة الصور والبيانات
        </h2>
        {meta?.bytes != null ? (
          <>
            <div
              style={{
                height: 12,
                borderRadius: 999,
                background: 'var(--fill)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, Math.max(1, (meta.bytes / SPARK_BYTES) * 100))}%`,
                  height: '100%',
                  background: meta.bytes > SPARK_BYTES * 0.8 ? 'var(--alayh)' : 'var(--lah)',
                }}
              />
            </div>
            <div className="muted num" style={{ fontSize: 13 }}>
              نحو {(meta.bytes / 1024 / 1024).toFixed(1)} MB من 1 GiB المتاحة في الخطة المجانية
              (تقدير من آخر نسخة احتياطية)
            </div>
          </>
        ) : (
          <div className="muted" style={{ fontSize: 13 }}>
            يظهر التقدير بعد أول نسخة احتياطية.
          </div>
        )}
      </section>
    </>
  );
}

function Stepper({
  label,
  unit,
  value,
  step,
  min,
  max,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  step: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)));
  // Snap to the step grid so ± lands on round numbers (5, 10, 15 …).
  const down = () => set(value % step ? value - (value % step) : value - step);
  const up = () => set(value % step ? value + (step - (value % step)) : value + step);
  return (
    <div
      className="row-between"
      style={{
        padding: '10px 12px',
        border: '1.5px solid var(--rule)',
        borderRadius: 12,
        background: 'var(--white)',
      }}
    >
      <span style={{ fontSize: 14 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          className="icon-btn"
          style={{ border: '1px solid var(--rule)', width: 40, height: 40, fontSize: 20 }}
          aria-label={`إنقاص ${label}`}
          onClick={down}
          disabled={value <= min}
        >
          −
        </button>
        <span
          className="num"
          style={{ minWidth: 84, textAlign: 'center', fontSize: 17, fontWeight: 600 }}
          aria-live="polite"
        >
          {value} {unit}
        </span>
        <button
          type="button"
          className="icon-btn"
          style={{ border: '1px solid var(--rule)', width: 40, height: 40, fontSize: 20 }}
          aria-label={`زيادة ${label}`}
          onClick={up}
          disabled={value >= max}
        >
          +
        </button>
      </div>
    </div>
  );
}
