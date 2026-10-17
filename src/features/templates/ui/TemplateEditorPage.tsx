import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { errorMessage, reportError } from '../../../core/errors';
import { fb } from '../../../core/firebase';
import { useReady } from '../../../core/session';
import { ErrorBox, Loading } from '../../../core/Shell';
import { useDesktop } from '../../../shared/ui/hooks';
import { Icon } from '../../../shared/ui/Icon';
import { useToast } from '../../../shared/ui/Toast';
import { useFormShortcuts } from '../../../shared/ui/useFormShortcuts';
import { getAccounts, listAllAccounts } from '../../accounts/data/accountsRepo';
import type { Account } from '../../accounts/domain/types';
import { can } from '../../users/domain/types';
import { getTemplates, saveTemplate } from '../data/templatesRepo';
import {
  COLORS,
  COLUMN_IDS,
  COLUMN_LABEL,
  DEFAULT_BODY,
  DOC_KINDS,
  DOC_LABEL,
  FONT_IDS,
  FONTS,
  LAYOUTS,
  LIMITS,
  REQUIRED_VARS,
  VARS_FOR,
  defaultTemplate,
  layoutOf,
  normalizeTemplate,
  validateTemplate,
  type ColumnId,
  type DocKind,
  type DocTemplate,
} from '../domain/template';
import { ConfirmTemplate } from './ConfirmTemplate';
import { loadFont } from './fonts';
import type { DocAccount } from './parts';
import { sampleConfirm, sampleStatement, sampleVoucher } from './sampleDocs';
import { StatementTemplate } from './StatementTemplate';
import { VoucherTemplate } from './VoucherTemplate';
import '../../vouchers/ui/print.css';
import './editor.css';

type Drafts = Record<DocKind, DocTemplate | null>;
const EMPTY: Drafts = { statement: null, confirm: null, voucher: null };
/** What is compared to tell unsaved changes (the saved form of a draft). */
const print = (k: DocKind, t: DocTemplate | null) =>
  t ? JSON.stringify(normalizeTemplate(k, t)) : '';
/** A4 width in CSS pixels (210mm). */
const A4_PX = 793.7;

/**
 * Template editor «أ» (owner decision 2026-10-17): settings beside a live
 * preview on a computer, «الإعدادات / المعاينة» tabs on a phone. One template
 * per document per supplier; owner and admin only.
 */
export function TemplateEditorPage() {
  const { id = '' } = useParams();
  const { user, profile, settings } = useReady();
  const navigate = useNavigate();
  const toast = useToast();
  const desktop = useDesktop();
  const [account, setAccount] = useState<Account | null>(null);
  const [drafts, setDrafts] = useState<Drafts>(EMPTY);
  const [saved, setSaved] = useState<Record<DocKind, string>>({
    statement: '',
    confirm: '',
    voucher: '',
  });
  const [loadError, setLoadError] = useState('');
  const [kind, setKind] = useState<DocKind>('confirm');
  const [pane, setPane] = useState<'settings' | 'preview'>('settings');
  const [busy, setBusy] = useState(false);
  const [askReset, setAskReset] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (!id || !can.manageAccounts(profile.role)) return;
    const { db } = fb();
    Promise.all([getAccounts(db, [id]), getTemplates(db, id)])
      .then(([[a], t]) => {
        if (!a) return setLoadError('الحساب غير موجود.');
        const d: Drafts = {
          statement: t.statement ?? null,
          confirm: t.confirm ?? null,
          voucher: t.voucher ?? null,
        };
        setAccount(a);
        setDrafts(d);
        setSaved({
          statement: print('statement', d.statement),
          confirm: print('confirm', d.confirm),
          voucher: print('voucher', d.voucher),
        });
      })
      .catch((e) => {
        reportError('templates-load', e);
        setLoadError(errorMessage(e));
      });
  }, [id, profile.role]);

  const draft = drafts[kind];
  const dirtyOf = (k: DocKind) => print(k, drafts[k]) !== saved[k];
  const anyDirty = DOC_KINDS.some(dirtyOf);
  const back = `/a/${id}`;
  const onKeyDown = useFormShortcuts({
    onSave: () => void save(),
    onCancel: () => navigate(back),
    dirty: anyDirty,
  });

  if (!can.manageAccounts(profile.role))
    return <ErrorBox message="تعديل النماذج للمالك والإدارة فقط." />;
  if (loadError) return <ErrorBox message={loadError} />;
  if (!account) return <Loading />;

  const errors = draft ? validateTemplate(kind, draft) : {};
  const set = (patch: Partial<DocTemplate>) =>
    setDrafts((d) => ({ ...d, [kind]: d[kind] ? { ...d[kind], ...patch } : d[kind] }));

  async function save() {
    if (busy || !account) return;
    const t = drafts[kind];
    if (t && Object.keys(validateTemplate(kind, t)).length) {
      setShowErrors(true);
      setPane('settings');
      toast.error('صحّح الحقول المعلّمة قبل الحفظ.');
      return;
    }
    setBusy(true);
    try {
      await saveTemplate(fb().db, user.uid, id, kind, t);
      setSaved((s) => ({ ...s, [kind]: print(kind, t) }));
      setShowErrors(false);
      toast.info(
        t
          ? `حُفظ نموذج «${DOC_LABEL[kind]}» لهذا الحساب.`
          : `«${DOC_LABEL[kind]}» يعود للمستند الافتراضي.`,
      );
    } catch (e) {
      reportError('template-save', e);
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const resetToDefault = async () => {
    setAskReset(false);
    setDrafts((d) => ({ ...d, [kind]: null }));
    setBusy(true);
    try {
      await saveTemplate(fb().db, user.uid, id, kind, null);
      setSaved((s) => ({ ...s, [kind]: '' }));
      toast.info(`«${DOC_LABEL[kind]}» يعود للمستند الافتراضي.`);
    } catch (e) {
      reportError('template-reset', e);
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const docAccount: DocAccount = { name: account.name, phone: account.phone, logo: account.logo };
  const settingsPane = (
    <div className="te-settings stack">
      {!draft ? (
        <div className="ctx-card">
          <p style={{ margin: 0, lineHeight: 1.9 }}>
            {`«${DOC_LABEL[kind]}» لهذا الحساب يستخدم المستند الافتراضي للبرنامج. صمّم له نموذجاً خاصاً أو انسخ نموذج حساب آخر.`}
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setDrafts((d) => ({ ...d, [kind]: defaultTemplate(kind) }))}
            >
              تصميم نموذج خاص
            </button>
          </div>
          <CopyFrom
            accountId={id}
            kind={kind}
            onPick={(t) => setDrafts((d) => ({ ...d, [kind]: t }))}
          />
        </div>
      ) : (
        <TemplateForm
          kind={kind}
          t={draft}
          set={set}
          docAccount={docAccount}
          payerName={settings.payerName}
          errors={showErrors ? errors : {}}
          liveErrors={errors}
          copy={
            <CopyFrom
              accountId={id}
              kind={kind}
              onPick={(t) => setDrafts((d) => ({ ...d, [kind]: t }))}
            />
          }
        />
      )}
      {(draft || saved[kind]) && (
        <div className="ctx-card">
          {askReset ? (
            <>
              <p style={{ margin: 0 }}>
                {`يعود «${DOC_LABEL[kind]}» لهذا الحساب إلى المستند الافتراضي ويُحذف نموذجه الخاص. المستندات الموقّعة سابقاً تبقى بشكلها الذي وُقّعت به.`}
              </p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void resetToDefault()}
                  disabled={busy}
                >
                  نعم، رجوع للافتراضي
                </button>
                <button type="button" className="btn btn-quiet" onClick={() => setAskReset(false)}>
                  إلغاء
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => setAskReset(true)}
              disabled={busy}
            >
              رجوع للمستند الافتراضي
            </button>
          )}
        </div>
      )}
    </div>
  );

  const previewPane = (
    <Preview kind={kind} t={draft} account={docAccount} payerName={settings.payerName} />
  );

  const saveBtn = (
    <button
      type="button"
      className={`btn btn-primary${desktop ? '' : ' btn-block'}`}
      onClick={() => void save()}
      disabled={busy || !dirtyOf(kind)}
      style={{ minHeight: 52, maxWidth: desktop ? undefined : 640 }}
    >
      {busy ? 'جارٍ الحفظ…' : `حفظ نموذج «${DOC_LABEL[kind]}»`}
      {desktop && !busy && <kbd className="kbd">Ctrl+Enter</kbd>}
    </button>
  );

  return (
    <div onKeyDown={onKeyDown} className="te">
      <div
        className="row-between no-print form-head"
        style={{
          padding: '8px 8px 12px',
          borderBottom: '2px solid var(--ink)',
          justifyContent: 'flex-start',
        }}
      >
        <Link to={back} className="icon-btn" aria-label="رجوع">
          <Icon name="back" />
        </Link>
        <div style={{ minWidth: 0 }}>
          <h1 className="serif" style={{ margin: 0, fontSize: 22 }}>
            نماذج المستندات
          </h1>
          <div className="muted" style={{ fontSize: 13 }}>
            {account.name}
          </div>
        </div>
      </div>

      <div className="te-kinds" role="tablist" aria-label="المستند">
        {DOC_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={k === kind}
            onClick={() => {
              setKind(k);
              setAskReset(false);
              setShowErrors(false);
            }}
          >
            {DOC_LABEL[k]}
            <span className="te-kind-state">
              {dirtyOf(k) ? '● غير محفوظ' : drafts[k] ? 'نموذج خاص' : 'الافتراضي'}
            </span>
          </button>
        ))}
      </div>

      {!desktop && (
        <div className="seg te-panes" role="group" aria-label="العرض">
          <button
            type="button"
            aria-pressed={pane === 'settings'}
            onClick={() => setPane('settings')}
          >
            الإعدادات
          </button>
          <button
            type="button"
            aria-pressed={pane === 'preview'}
            onClick={() => setPane('preview')}
          >
            المعاينة
          </button>
        </div>
      )}

      {desktop ? (
        <div className="te-grid">
          <div>
            {settingsPane}
            <div className="desk-actions">
              {saveBtn}
              <Link to={back} className="btn btn-quiet" style={{ minHeight: 52 }}>
                رجوع <kbd className="kbd">Esc</kbd>
              </Link>
            </div>
          </div>
          <div className="te-preview-col">{previewPane}</div>
        </div>
      ) : (
        <>
          <div className="pad">{pane === 'settings' ? settingsPane : previewPane}</div>
          <div className="bottom-actions">{saveBtn}</div>
        </>
      )}
    </div>
  );
}

function TemplateForm({
  kind,
  t,
  set,
  docAccount,
  payerName,
  errors,
  liveErrors,
  copy,
}: {
  kind: DocKind;
  t: DocTemplate;
  set: (patch: Partial<DocTemplate>) => void;
  docAccount: DocAccount;
  payerName: string;
  /** Shown after a save attempt. */
  errors: Partial<Record<keyof DocTemplate, string>>;
  /** Always shown for the text (it is checked while typing). */
  liveErrors: Partial<Record<keyof DocTemplate, string>>;
  copy: ReactNode;
}) {
  useEffect(() => {
    for (const f of FONT_IDS) loadFont(f).catch((e) => reportError('template-font', e));
  }, []);

  /** Picking a structure brings its own colour/font/title unless the user changed them. */
  const pickLayout = (layoutId: string) => {
    const cur = layoutOf(kind, t.layout);
    const next = defaultTemplate(kind, layoutId);
    const curDefault = cur ? defaultTemplate(kind, cur.id) : null;
    set({
      layout: layoutId,
      color: !curDefault || t.color === curDefault.color ? next.color : t.color,
      font: !curDefault || t.font === curDefault.font ? next.font : t.font,
      title: !curDefault || t.title === curDefault.title ? next.title : t.title,
    });
  };

  return (
    <>
      <section className="ctx-card">
        <h2 className="ctx-title">التركيب</h2>
        <div className="te-layouts" role="radiogroup" aria-label="التركيب">
          {LAYOUTS[kind].map((l, i) => (
            <button
              key={l.id}
              type="button"
              role="radio"
              aria-checked={t.layout === l.id}
              className="te-layout"
              onClick={() => pickLayout(l.id)}
              title={l.note}
            >
              <Thumb
                kind={kind}
                t={{ ...t, layout: l.id }}
                account={docAccount}
                payerName={payerName}
              />
              <span className="te-layout-name">
                <span className="num">{i + 1}.</span> {l.name}
              </span>
            </button>
          ))}
        </div>
        {errors.layout && <div className="error-text">{errors.layout}</div>}
      </section>

      <section className="ctx-card">
        <h2 className="ctx-title">اللون والخط</h2>
        <div className="te-swatches" role="radiogroup" aria-label="اللون">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={t.color.toLowerCase() === c}
              aria-label={`اللون ${c}`}
              className="te-swatch"
              style={{ background: c }}
              onClick={() => set({ color: c })}
            />
          ))}
          <label className="te-swatch te-custom" title="لون آخر">
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(t.color) ? t.color : '#000000'}
              onChange={(e) => set({ color: e.target.value })}
              aria-label="اختيار لون آخر"
            />
          </label>
        </div>
        {errors.color && <div className="error-text">{errors.color}</div>}
        <div className="te-fonts" role="radiogroup" aria-label="الخط">
          {FONT_IDS.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={t.font === f}
              style={{ fontFamily: FONTS[f].css }}
              onClick={() => set({ font: f })}
            >
              {FONTS[f].label}
              <span className="te-font-sample num">١٢٣ أبجد 123</span>
            </button>
          ))}
        </div>
      </section>

      <section className="ctx-card">
        <h2 className="ctx-title">النصوص</h2>
        <TextField
          id="te-title"
          label="عنوان المستند"
          value={t.title}
          max={LIMITS.title}
          error={errors.title}
          onChange={(title) => set({ title })}
        />
        <TextField
          id="te-sub"
          label="سطر تحت اسم المورد (عنوان، سجل تجاري… اختياري)"
          value={t.sub}
          max={LIMITS.sub}
          error={errors.sub}
          onChange={(sub) => set({ sub })}
        />
        <TextField
          id="te-foot"
          label="تذييل الصفحة (اختياري)"
          value={t.foot}
          max={LIMITS.foot}
          error={errors.foot}
          onChange={(foot) => set({ foot })}
        />
        {kind !== 'statement' && <BodyField kind={kind} t={t} set={set} error={liveErrors.body} />}
      </section>

      {kind === 'statement' && <ColumnsField t={t} set={set} errors={errors} />}

      <section className="ctx-card">{copy}</section>
    </>
  );
}

function TextField({
  id,
  label,
  value,
  max,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  max: number;
  error?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input"
        value={value}
        maxLength={max}
        aria-invalid={!!error}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && <div className="error-text">{error}</div>}
    </div>
  );
}

function BodyField({
  kind,
  t,
  set,
  error,
}: {
  kind: DocKind;
  t: DocTemplate;
  set: (patch: Partial<DocTemplate>) => void;
  error?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (caret.current === null || !ref.current) return;
    ref.current.focus();
    ref.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });
  const insert = (v: string) => {
    const el = ref.current;
    const token = `{${v}}`;
    const at = el ? el.selectionStart : t.body.length;
    const end = el ? el.selectionEnd : t.body.length;
    const body = t.body.slice(0, at) + token + t.body.slice(end);
    if (body.length > LIMITS.body) return;
    caret.current = at + token.length;
    set({ body });
  };
  const required = REQUIRED_VARS[kind];
  return (
    <div className="field">
      <label htmlFor="te-body">نص المستند</label>
      <div className="te-chips" aria-label="إدراج بيانات">
        {VARS_FOR[kind].map((v) => (
          <button
            key={v}
            type="button"
            className={`te-chip${required.includes(v) ? ' req' : ''}`}
            onClick={() => insert(v)}
          >
            {`{${v}}`}
          </button>
        ))}
      </div>
      <textarea
        id="te-body"
        ref={ref}
        className="input"
        rows={6}
        value={t.body}
        maxLength={LIMITS.body}
        aria-invalid={!!error}
        aria-describedby="te-body-hint"
        onChange={(e) => set({ body: e.target.value })}
      />
      <div id="te-body-hint" className="hint">
        اضغط أي بيان لإدراجه في موضع المؤشر؛ يُستبدل عند الطباعة بقيمته.
        {required.length > 0 &&
          ` يلزم أن يحتوي النص ${required.map((v) => `{${v}}`).join(' و')}.`}{' '}
        <span className="num">
          {t.body.length}/{LIMITS.body}
        </span>
      </div>
      {error && <div className="error-text">{error}</div>}
      {t.body !== DEFAULT_BODY[kind] && (
        <button
          type="button"
          className="btn-link"
          style={{ alignSelf: 'flex-start', fontSize: 14 }}
          onClick={() => set({ body: DEFAULT_BODY[kind] })}
        >
          استعادة النص الافتراضي
        </button>
      )}
    </div>
  );
}

function ColumnsField({
  t,
  set,
  errors,
}: {
  t: DocTemplate;
  set: (patch: Partial<DocTemplate>) => void;
  errors: Partial<Record<keyof DocTemplate, string>>;
}) {
  const hidden = COLUMN_IDS.filter((c) => !t.columns.includes(c));
  const move = (i: number, by: -1 | 1) => {
    const cols = [...t.columns];
    const j = i + by;
    if (j < 0 || j >= cols.length) return;
    [cols[i], cols[j]] = [cols[j]!, cols[i]!];
    set({ columns: cols });
  };
  const rename = (c: ColumnId, v: string) => set({ colTitles: { ...t.colTitles, [c]: v } });
  return (
    <section className="ctx-card">
      <h2 className="ctx-title">أعمدة الكشف</h2>
      <div className="field">
        <span className="label">تسمية الطرفين</span>
        <div className="seg" role="group" aria-label="تسمية الطرفين">
          <button
            type="button"
            aria-pressed={t.sides === 'lah'}
            onClick={() => set({ sides: 'lah' })}
          >
            له / عليه
          </button>
          <button
            type="button"
            aria-pressed={t.sides === 'dc'}
            onClick={() => set({ sides: 'dc' })}
          >
            دائن / مدين
          </button>
        </div>
      </div>
      <ol className="te-cols">
        {t.columns.map((c, i) => (
          <li key={c}>
            <span className="te-col-no num">{i + 1}</span>
            <input
              className="input"
              aria-label={`عنوان عمود ${COLUMN_LABEL[c]}`}
              placeholder={
                c === 'lah' && t.sides === 'dc'
                  ? 'دائن'
                  : c === 'alayh' && t.sides === 'dc'
                    ? 'مدين'
                    : COLUMN_LABEL[c]
              }
              value={t.colTitles[c] ?? ''}
              maxLength={LIMITS.colTitle}
              onChange={(e) => rename(c, e.target.value)}
            />
            <button
              type="button"
              className="icon-btn"
              aria-label={`تقديم ${COLUMN_LABEL[c]}`}
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              ▲
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={`تأخير ${COLUMN_LABEL[c]}`}
              disabled={i === t.columns.length - 1}
              onClick={() => move(i, 1)}
            >
              ▼
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={`إخفاء ${COLUMN_LABEL[c]}`}
              disabled={c === 'details'}
              onClick={() => set({ columns: t.columns.filter((x) => x !== c) })}
            >
              <Icon name="x" size={18} />
            </button>
          </li>
        ))}
      </ol>
      {hidden.length > 0 && (
        <div className="te-chips">
          {hidden.map((c) => (
            <button
              key={c}
              type="button"
              className="te-chip"
              onClick={() => set({ columns: [...t.columns, c] })}
            >
              + {COLUMN_LABEL[c]}
            </button>
          ))}
        </div>
      )}
      <p className="hint" style={{ margin: 0 }}>
        عمود «الرصيد» يظهر فقط لمن يحق له رؤية الأرصدة. أسماء الأعمدة تظهر في الطباعة وملف Excel.
      </p>
      {(errors.columns || errors.colTitles) && (
        <div className="error-text">{errors.columns ?? errors.colTitles}</div>
      )}
    </section>
  );
}

/** Copies another account's template for this document into the draft (saved only on «حفظ»). */
function CopyFrom({
  accountId,
  kind,
  onPick,
}: {
  accountId: string;
  kind: DocKind;
  onPick: (t: DocTemplate) => void;
}) {
  const toast = useToast();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState('');

  const start = async () => {
    setOpen(true);
    if (accounts) return;
    try {
      const rows = await listAllAccounts(fb().db);
      setAccounts(
        rows
          .filter((a) => a.id !== accountId && !a.deleted)
          .sort((a, b) => a.name.localeCompare(b.name, 'ar')),
      );
    } catch (e) {
      reportError('templates-accounts', e);
      toast.error(errorMessage(e));
      setOpen(false);
    }
  };
  const copy = async () => {
    if (!from) return;
    setBusy(true);
    try {
      const t = (await getTemplates(fb().db, from))[kind];
      const name = accounts?.find((a) => a.id === from)?.name ?? '';
      if (!t) toast.error(`لا يوجد نموذج خاص لـ«${DOC_LABEL[kind]}» عند «${name}».`);
      else {
        onPick(t);
        setOpen(false);
        toast.info(`نُسخ نموذج «${name}». راجعه ثم اضغط حفظ.`);
      }
    } catch (e) {
      reportError('templates-copy', e);
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open)
    return (
      <button
        type="button"
        className="btn-link"
        style={{ alignSelf: 'flex-start', fontSize: 14 }}
        onClick={() => void start()}
      >
        نسخ نموذج حساب آخر
      </button>
    );
  if (!accounts) return <Loading />;
  return (
    <div className="field">
      <label htmlFor="te-copy">نسخ «{DOC_LABEL[kind]}» من حساب</label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select
          id="te-copy"
          className="input"
          style={{ flex: '1 1 200px' }}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        >
          <option value="">اختر الحساب…</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <button type="button" className="btn" disabled={!from || busy} onClick={() => void copy()}>
          {busy ? 'جارٍ…' : 'نسخ'}
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>
          إلغاء
        </button>
      </div>
    </div>
  );
}

function Doc({
  kind,
  t,
  account,
  payerName,
}: {
  kind: DocKind;
  t: DocTemplate;
  account: DocAccount;
  payerName: string;
}) {
  if (kind === 'confirm') return <ConfirmTemplate t={t} doc={sampleConfirm(account, payerName)} />;
  if (kind === 'voucher') return <VoucherTemplate t={t} doc={sampleVoucher(account, payerName)} />;
  return <StatementTemplate t={t} doc={sampleStatement(account, t)} />;
}

/** The real document, zoomed to the width available. */
function Preview({
  kind,
  t,
  account,
  payerName,
}: {
  kind: DocKind;
  t: DocTemplate | null;
  account: DocAccount;
  payerName: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(0.5);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setZoom(Math.min(1, Math.max(0.2, (el.clientWidth - 4) / A4_PX)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="te-preview" ref={box} aria-label="معاينة المستند">
      <div className="te-preview-note muted">
        معاينة ببيانات مثال مع اسم الحساب وشعاره
        {t ? '' : ' — المستند الافتراضي (اطبع من الكشف لرؤيته)'}
      </div>
      {t ? (
        <div className="te-zoom" style={{ zoom }}>
          <Doc kind={kind} t={t} account={account} payerName={payerName} />
        </div>
      ) : (
        <div className="te-empty">لا يوجد نموذج خاص لهذا المستند.</div>
      )}
    </div>
  );
}

/** A small live picture of a structure with the current colour and font. */
function Thumb({
  kind,
  t,
  account,
  payerName,
}: {
  kind: DocKind;
  t: DocTemplate;
  account: DocAccount;
  payerName: string;
}) {
  return (
    <span className="te-thumb" aria-hidden="true">
      <span className="te-thumb-zoom">
        <Doc kind={kind} t={t} account={account} payerName={payerName} />
      </span>
    </span>
  );
}
