import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { errorMessage, reportError } from '../../../core/errors';
import { fb } from '../../../core/firebase';
import { useReady } from '../../../core/session';
import { ErrorBox, Loading } from '../../../core/Shell';
import { displayDate, formatDateTime, todayRiyadh } from '../../../shared/lib/dates';
import {
  IMAGE_ACCEPT,
  IMAGE_FORMATS_LABEL,
  isApprovedImage,
  preparePhoto,
  UNAPPROVED_IMAGE,
} from '../../../shared/lib/image';
import { cleanAmountInput, formatAmount, parseAmount } from '../../../shared/lib/money';
import { CalendarSheet } from '../../../shared/ui/Calendar';
import { useBlobUrl, useDesktop } from '../../../shared/ui/hooks';
import { Icon } from '../../../shared/ui/Icon';
import { RiyalSign } from '../../../shared/ui/RiyalSign';
import { useToast } from '../../../shared/ui/Toast';
import { useFormShortcuts } from '../../../shared/ui/useFormShortcuts';
import { getAccounts } from '../../accounts/data/accountsRepo';
import { pendingLinkIds } from '../../signing/data/signLinksRepo';
import { setArchived } from '../../accounts/data/accountsRepo';
import type { Account } from '../../accounts/domain/types';
import {
  createEntry,
  changedOnServer,
  entryChanged,
  getEntry,
  updateEntry,
  type EntrySnapshot,
  type PreparedImage,
} from '../data/entriesRepo';
import {
  ENTRY_LABEL,
  entryLabel,
  hasAmount,
  MAX_ATTACHMENTS,
  MAX_DETAILS,
  daysAhead,
  isFarFuture,
  signedAmount,
  validateEntryForm,
  type EntryType,
} from '../domain/types';
import { entryTitle } from '../../notifications/domain/notification';
import { ConfirmGate } from '../../../shared/ui/ConfirmGate';
import { can } from '../../users/domain/types';
import { EntryContextPanel } from './EntryContextPanel';
import { requestVersionCheck } from '../../../core/appVersion';
import { sharedWatch } from '../../../shared/lib/sharedWatch';
import { watchEntries } from '../data/entriesRepo';
import { amountInWords } from '../../../shared/lib/tafqit';
import { balanceAt, confirmLabel, signerSide } from '../../confirmations/domain/confirmation';

const TYPE_COLOR: Record<EntryType, string> = {
  invoice: 'var(--lah)',
  payment: 'var(--alayh)',
  note: 'var(--ink)',
  confirm: 'var(--conf)',
};
const HINT: Record<EntryType, string> = {
  invoice: 'تظهر في عمود «له» وتزيد رصيد المورد.',
  payment: 'تظهر في عمود «عليه» وتأخذ رقم سند، ويمكن إرسالها للتوقيع بعد الحفظ.',
  note: 'ملاحظة بلا مبلغ، لا تغيّر الرصيد.',
  confirm:
    'إقرار مطابقة رصيد: يذكر رصيد الحساب حتى تاريخه (يُحسب تلقائياً) ولا يغيّر الرصيد، ويأخذ رقم «م-»، ويُرسل للمورد/العميل ليوقّعه.',
};
const SAVE_LABEL: Record<EntryType, string> = {
  invoice: 'حفظ الفاتورة',
  payment: 'حفظ الدفعة',
  note: 'حفظ الملاحظة',
  confirm: 'حفظ الإقرار',
};
const TYPES = ['invoice', 'payment', 'note', 'confirm'] as const;

export function EntryFormPage() {
  const { id = '', entryId } = useParams();
  const [params] = useSearchParams();
  const { user, profile } = useReady();
  const navigate = useNavigate();
  const toast = useToast();
  const isNew = !entryId;
  const initialType = TYPES.find((t) => t === params.get('type')) ?? 'invoice';

  const [account, setAccount] = useState<Account | null>(null);
  const accountName = account?.name ?? '';
  /** A step to confirm before the form: a signed voucher, or an archived account. */
  const [gate, setGate] = useState<null | 'signed' | 'archived'>(null);
  const [current, setCurrent] = useState<EntrySnapshot | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [type, setType] = useState<EntryType>(initialType);
  const [amountText, setAmountText] = useState('');
  const [date, setDate] = useState(todayRiyadh());
  const [details, setDetails] = useState('');
  const [keep, setKeep] = useState<string[]>([]);
  const [added, setAdded] = useState<PreparedImage[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dateOpen, setDateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /** A far-future date the user has already been warned about (second save goes through). */
  const [futureOk, setFutureOk] = useState('');
  const [processing, setProcessing] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const desktop = useDesktop();

  useEffect(() => {
    const { db } = fb();
    Promise.all([
      getAccounts(db, [id]),
      entryId ? getEntry(db, id, entryId) : Promise.resolve(null),
    ])
      .then(([[acc], snap]) => {
        if (!acc) return setLoadError('الحساب غير موجود.');
        setAccount(acc);
        if (acc.archived && !can.archiveAccounts(profile.role))
          return setLoadError('هذا الحساب مؤرشف. راجع الإدارة لإعادته.');
        if (!entryId && acc.archived) setGate('archived');
        if (entryId) {
          if (!snap || snap.entry.deleted) return setLoadError('العملية غير موجودة أو حُذفت.');
          if (snap.entry.signature) setGate('signed');
          const e = snap.entry;
          setCurrent(snap);
          setType(e.type);
          setAmountText(hasAmount(e.type) ? formatAmount(e.amount).replace(/,/g, '') : '');
          setDate(e.date);
          setDetails(e.details);
          setKeep(e.attachments);
        }
        setLoaded(true);
      })
      .catch((e) => {
        reportError('entry-load', e);
        setLoadError(errorMessage(e));
      });
  }, [id, entryId, profile.role]);

  const attachmentCount = keep.length + added.length;

  // A balance confirmation states the balance up to its date: computed from the
  // account's entries (the same shared listener as the statement).
  const [ledger, setLedger] = useState<EntrySnapshot[] | null>(null);
  const [ledgerError, setLedgerError] = useState('');
  useEffect(() => {
    if (type !== 'confirm') return;
    return sharedWatch<EntrySnapshot[]>(
      `entries:${id}`,
      (n, f) => watchEntries(fb().db, id, n, f),
      (rows) => {
        setLedger(rows);
        setLedgerError('');
      },
      (e) => {
        reportError('confirm-balance', e);
        setLedgerError(errorMessage(e));
      },
    );
  }, [type, id]);
  const confirmBalance =
    type === 'confirm' && ledger
      ? balanceAt(
          ledger.map((s) => s.entry),
          date,
        )
      : null;

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = MAX_ATTACHMENTS - attachmentCount;
    if (room <= 0) return toast.error(`الحد ${MAX_ATTACHMENTS} صور لكل عملية.`);
    const all = Array.from(files);
    const ok = all.filter((f) => isApprovedImage(f));
    if (ok.length < all.length)
      toast.error(`رُفض ${all.length - ok.length} ملف. ${UNAPPROVED_IMAGE}`);
    if (!ok.length) return resetPickers();
    setProcessing(true);
    try {
      const out: PreparedImage[] = [];
      for (const f of ok.slice(0, room)) out.push(await preparePhoto(f));
      setAdded((a) => [...a, ...out]);
      if (ok.length > room) toast.error(`أُضيفت ${room} فقط؛ الحد ${MAX_ATTACHMENTS} صور.`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setProcessing(false);
      resetPickers();
    }
  };

  function resetPickers() {
    if (cameraRef.current) cameraRef.current.value = '';
    if (galleryRef.current) galleryRef.current.value = '';
  }

  // New entry: anything typed. Edit: only a real change from what was loaded.
  const dirty = current
    ? added.length > 0 ||
      keep.length !== current.entry.attachments.length ||
      date !== current.entry.date ||
      details !== current.entry.details ||
      (hasAmount(type) && parseAmount(amountText) !== current.entry.amount)
    : !!amountText.trim() || !!details.trim() || added.length > 0;

  const parsed = hasAmount(type) ? parseAmount(amountText) : 0;
  const nextSigned = parsed === null || parsed < 0 ? null : signedAmount(type, parsed);

  /** Clears the form for the next entry; type and date stay (batch entry from one paper). */
  const resetForNext = () => {
    setAmountText('');
    setDetails('');
    setAdded([]);
    setErrors({});
    setBusy(false);
    resetPickers();
    requestAnimationFrame(() =>
      (hasAmount(type) ? amountRef.current : document.getElementById('desc'))?.focus(),
    );
  };

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    void save(false);
  };

  const save = async (again: boolean) => {
    if (busy || processing) return;
    const res = validateEntryForm({
      type,
      amountText,
      date,
      details,
      attachmentCount,
      requireNoteText: !current || current.entry.details.trim() !== '',
      today: todayRiyadh(),
    });
    if (!res.ok) {
      setErrors(res.errors as Record<string, string>);
      return;
    }
    if (type === 'confirm' && confirmBalance === null) {
      toast.error(ledgerError || 'انتظر حتى يُحسب الرصيد ثم احفظ.');
      return;
    }
    const todayIso = todayRiyadh();
    if (isFarFuture(res.date, todayIso) && futureOk !== res.date) {
      setFutureOk(res.date);
      setErrors({
        date: `التاريخ بعد ${daysAhead(res.date, todayIso)} يوماً من اليوم. تأكّد منه، ثم اضغط الحفظ مرة أخرى.`,
      });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const { db } = fb();
      if (current) {
        const changes = {
          amount: res.amount,
          signed: res.signed,
          date: res.date,
          details: res.details,
          keepAttachments: keep,
          ...(type === 'confirm' ? { confirmBalance: confirmBalance ?? 0 } : {}),
        };
        if (!entryChanged(current.entry, changes, added.length)) {
          toast.info('لا تغييرات؛ لم يُحفظ شيء.');
          navigate(`/a/${id}`, { replace: true });
          return;
        }
        const wasSigned = current.entry.signature !== null;
        const revoke =
          current.entry.type === 'payment' || current.entry.type === 'confirm'
            ? await pendingLinkIds(db, id, current.entry.id)
            : [];
        await updateEntry(db, user.uid, id, current, changes, added, revoke, {
          actorName: profile.name,
          accountName,
        });
        if (wasSigned)
          toast.info('حُفظ التعديل وأُلغي توقيع السند. أرسل رابط توقيع جديداً للمورد من الكشف.');
        else if (revoke.length)
          toast.info('أُلغي رابط التوقيع المفتوح لهذه الدفعة؛ أرسل رابطاً جديداً بالمبلغ المعدّل.');
        if (!wasSigned) toast.info('حُفظ التعديل وسُجّلت النسخة السابقة في سجل التعديلات.');
      } else {
        const out = await createEntry(
          db,
          user.uid,
          id,
          {
            type,
            amount: res.amount,
            signed: res.signed,
            date: res.date,
            details: res.details,
            ...(type === 'confirm' ? { confirmBalance: confirmBalance ?? 0 } : {}),
          },
          added,
          { actorName: profile.name, accountName },
        );
        if (out.confirmNo !== null) {
          toast.info(`حُفظ إقرار المطابقة ${confirmLabel(out.confirmNo)}. أرسله الآن للتوقيع.`);
          // Opens it in the statement, where «إرسال للتوقيع» and printing are.
          navigate(`/a/${id}?e=${out.id}`, { replace: true });
          return;
        }
        toast.info(
          out.voucherNo !== null
            ? `حُفظت الدفعة — سند رقم ${out.voucherNo}. اضغطها في الكشف لإرسالها للتوقيع أو طباعتها.`
            : `حُفظت ${ENTRY_LABEL[type]} وأُضيفت إلى كشف الحساب.`,
        );
        if (again) return resetForNext();
      }
      navigate(`/a/${id}`, { replace: true });
    } catch (e) {
      reportError('entry-save', e);
      const denied =
        !!e && typeof e === 'object' && 'code' in e && String(e.code).includes('permission-denied');
      if (!denied) {
        toast.error(errorMessage(e));
        setBusy(false);
        return;
      }
      // Tell the real reason: someone changed the entry meanwhile, or this tab
      // runs an older version of the app than the server rules expect.
      requestVersionCheck();
      const changed = current ? await changedOnServer(fb().db, id, current) : false;
      toast.error(
        changed
          ? 'تعذّر الحفظ: تغيّرت هذه العملية منذ فتحتها (عدّلها أو حذفها مستخدم آخر). ارجع للكشف وافتحها من جديد.'
          : changed === null
            ? 'تعذّر الحفظ: رفض الخادم العملية. تحقق من الاتصال، ثم حدّث الصفحة وأعد المحاولة.'
            : 'تعذّر الحفظ: رفض الخادم العملية مع أن بياناتها لم تتغيّر — غالباً نسخة البرنامج المفتوحة قديمة. انسخ ما كتبته، ثم حدّث الصفحة (أو ارجع للكشف فتُحدَّث تلقائياً) وأعد المحاولة. إن تكرر فأبلغ الإدارة.',
      );
      setBusy(false);
    }
  };

  const today = todayRiyadh();

  const onKeyDown = useFormShortcuts({
    onSave: () => void save(false),
    onCancel: () => navigate(`/a/${id}`),
    dirty,
    paused: dateOpen,
  });

  const actions = (
    <>
      <button
        type="submit"
        className="btn btn-primary"
        disabled={busy || processing}
        style={{ minHeight: 52 }}
      >
        {busy ? 'جارٍ الحفظ…' : SAVE_LABEL[type]}
        {desktop && !busy && <kbd className="kbd">Ctrl+Enter</kbd>}
      </button>
      {desktop && isNew && (
        <button
          type="button"
          className="btn"
          disabled={busy || processing}
          onClick={() => void save(true)}
          style={{ minHeight: 52 }}
        >
          حفظ وإضافة أخرى
        </button>
      )}
      {desktop && (
        <Link to={`/a/${id}`} className="btn btn-quiet" style={{ minHeight: 52 }}>
          إلغاء <kbd className="kbd">Esc</kbd>
        </Link>
      )}
    </>
  );

  if (loadError) return <ErrorBox message={loadError} />;
  if (!loaded) return <Loading />;
  if (gate === 'signed' && current?.entry.signature)
    return (
      <ConfirmGate
        title={`${entryTitle(current.entry)} موقّع`}
        backTo={`/a/${id}`}
        confirmLabel="متابعة التعديل"
        onConfirm={() => setGate(null)}
      >
        وقّعه <strong>{current.entry.signature.name}</strong>
        {current.entry.signature.signedAtMs > 0 &&
          ` يوم ${formatDateTime(current.entry.signature.signedAtMs)}`}
        .<br />
        إن عدّلت أي بيانات فيه <strong>يُلغى التوقيع</strong>، ويصبح السند «بلا توقيع» حتى ترسل
        رابطاً جديداً للمورد، ويصل تنبيه للمالك والإدارة. التوقيع القديم يبقى في سجل التعديلات.
      </ConfirmGate>
    );
  if (gate === 'archived' && account)
    return (
      <ConfirmGate
        title="الحساب مؤرشف"
        backTo={`/a/${id}`}
        confirmLabel="إعادته إلى القائمة والمتابعة"
        onConfirm={async () => {
          await setArchived(fb().db, user.uid, account, false);
          setAccount({ ...account, archived: false });
          toast.info(`أُعيد «${account.name}» إلى قائمة الحسابات.`);
          setGate(null);
        }}
      >
        «{account.name}» مؤرشف ولا يظهر في قائمة الحسابات. لإضافة عملية فيه يُعاد إلى القائمة أولاً.
      </ConfirmGate>
    );

  return (
    <form onSubmit={submit} onKeyDown={onKeyDown} noValidate className="entry-form">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '8px 8px 12px',
          borderBottom: '2px solid var(--ink)',
        }}
        className="form-head"
      >
        <Link to={`/a/${id}`} className="icon-btn" aria-label="رجوع إلى كشف الحساب">
          <Icon name="back" />
        </Link>
        <div>
          <h1 className="serif" style={{ margin: 0, fontSize: 22 }}>
            {isNew
              ? 'عملية جديدة'
              : `تعديل ${current ? entryLabel(current.entry) : ENTRY_LABEL[type]}`}
            {current?.entry.voucherNo != null && (
              <span className="muted num" style={{ fontSize: 16 }}>
                {' '}
                #{current.entry.voucherNo}
              </span>
            )}
            {current?.entry.confirmNo != null && (
              <span className="muted num" style={{ fontSize: 16 }}>
                {' '}
                {confirmLabel(current.entry.confirmNo)}
              </span>
            )}
          </h1>
          <div className="muted" style={{ fontSize: 13 }}>
            {accountName}
          </div>
        </div>
      </div>

      <div className="entry-layout">
        <div className="pad stack entry-main">
          {isNew && (
            <div
              className="seg"
              role="group"
              aria-label="نوع العملية"
              style={{ ['--seg-on' as string]: TYPE_COLOR[type] }}
            >
              {TYPES.map((t) => (
                <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)}>
                  {ENTRY_LABEL[t]}
                </button>
              ))}
            </div>
          )}
          <div className="hint" style={{ fontSize: 13, marginTop: isNew ? -8 : 0 }}>
            {HINT[type]}
          </div>

          <div className="amt-date">
            {hasAmount(type) && (
              <div className="field">
                <label htmlFor="amt">المبلغ</label>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '0 14px',
                    border: `1.5px solid ${errors.amount ? 'var(--alayh)' : 'var(--rule-strong)'}`,
                    borderRadius: 12,
                    background: 'var(--sheet)',
                  }}
                >
                  <input
                    ref={amountRef}
                    id="amt"
                    inputMode="decimal"
                    autoComplete="off"
                    value={amountText}
                    onChange={(e) => setAmountText(cleanAmountInput(e.target.value))}
                    placeholder="0"
                    maxLength={18}
                    aria-invalid={!!errors.amount}
                    className="num"
                    style={{
                      flex: '1 1 auto',
                      minWidth: 0,
                      minHeight: 56,
                      border: 0,
                      background: 'transparent',
                      fontSize: 28,
                      fontWeight: 600,
                      outline: 'none',
                    }}
                  />
                  <span className="muted" style={{ fontSize: 22 }}>
                    <RiyalSign size={22} />
                  </span>
                </div>
                {errors.amount && (
                  <div className="error-text" role="alert">
                    {errors.amount}
                  </div>
                )}
              </div>
            )}

            <div className="field">
              <span className="label">التاريخ</span>
              <button
                type="button"
                className="picker-btn"
                onClick={() => setDateOpen(true)}
                aria-label={`التاريخ ${displayDate(date)}، اضغط للتغيير`}
              >
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <span className="num" style={{ fontSize: 17, fontWeight: 600 }}>
                    {displayDate(date)}
                  </span>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {date === today ? 'اليوم' : date < today ? 'تاريخ سابق' : 'تاريخ لاحق'}
                  </span>
                </span>
                <Icon name="calendar" size={20} />
              </button>
              {errors.date ? (
                <div className="error-text" role="alert">
                  {errors.date}
                </div>
              ) : (
                isFarFuture(date, today) && (
                  <div className="hint" style={{ color: 'var(--warn)' }}>
                    تاريخ بعد {daysAhead(date, today)} يوماً من اليوم.
                  </div>
                )
              )}
            </div>
          </div>

          {type === 'confirm' && (
            <ConfirmBalanceBox balance={confirmBalance} date={date} error={ledgerError} />
          )}

          <div className="field">
            <label htmlFor="desc">
              {type === 'note'
                ? 'نص الملاحظة'
                : type === 'confirm'
                  ? 'البيان (اختياري)'
                  : 'التفاصيل'}
            </label>
            <textarea
              id="desc"
              className="input"
              rows={3}
              maxLength={MAX_DETAILS}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder={
                type === 'invoice'
                  ? 'مثال: فاتورة رقم 0379'
                  : type === 'confirm'
                    ? 'مثال: مطابقة الربع الثالث'
                    : ''
              }
              aria-invalid={!!errors.details}
            />
            <div className="row-between">
              {errors.details ? <div className="error-text">{errors.details}</div> : <span />}
              <span className="hint num">
                {details.length}/{MAX_DETAILS}
              </span>
            </div>
          </div>

          <div className="field">
            <span className="label">
              المرفقات ({attachmentCount}/{MAX_ATTACHMENTS})
            </span>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                className="btn"
                style={dashed}
                onClick={() => cameraRef.current?.click()}
                disabled={processing || attachmentCount >= MAX_ATTACHMENTS}
              >
                <Icon name="camera" />
                الكاميرا
              </button>
              <button
                type="button"
                className="btn"
                style={dashed}
                onClick={() => galleryRef.current?.click()}
                disabled={processing || attachmentCount >= MAX_ATTACHMENTS}
              >
                <Icon name="image" />
                من المعرض
              </button>
            </div>
            <input
              ref={cameraRef}
              type="file"
              accept={IMAGE_ACCEPT}
              capture="environment"
              hidden
              onChange={(e) => void addFiles(e.target.files)}
            />
            <input
              ref={galleryRef}
              type="file"
              accept={IMAGE_ACCEPT}
              multiple
              hidden
              onChange={(e) => void addFiles(e.target.files)}
            />
            <div className="hint">
              {processing
                ? 'جارٍ ضغط الصورة…'
                : `الصيغ المسموحة: ${IMAGE_FORMATS_LABEL}. تُضغط الصورة تلقائياً قبل الرفع (حتى 300 KB).`}
            </div>
            {errors.attachments && <div className="error-text">{errors.attachments}</div>}
            {(keep.length > 0 || added.length > 0) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {keep.map((aid, i) => (
                  <span
                    key={aid}
                    className="chip"
                    style={{
                      background: 'var(--fill)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '4px 4px 4px 10px',
                    }}
                  >
                    صورة محفوظة {i + 1}
                    <button
                      type="button"
                      className="icon-btn"
                      style={{ width: 28, height: 28 }}
                      aria-label={`إزالة الصورة المحفوظة ${i + 1}`}
                      onClick={() => setKeep((k) => k.filter((x) => x !== aid))}
                    >
                      <Icon name="x" size={16} />
                    </button>
                  </span>
                ))}
                {added.map((img, i) => (
                  <Thumb
                    key={i}
                    img={img}
                    onRemove={() => setAdded((a) => a.filter((_, j) => j !== i))}
                  />
                ))}
              </div>
            )}
          </div>
          {desktop && <div className="desk-actions">{actions}</div>}
        </div>
        {desktop && (
          <EntryContextPanel
            accountId={id}
            nextSigned={nextSigned}
            editingId={current?.entry.id ?? null}
          />
        )}
      </div>

      {!desktop && (
        <div className="bottom-actions">
          <div className="mobile-actions">{actions}</div>
        </div>
      )}

      {dateOpen && (
        <CalendarSheet
          mode="single"
          value={date}
          onCancel={() => setDateOpen(false)}
          onDone={(v) => {
            setDate(v);
            setDateOpen(false);
          }}
        />
      )}
    </form>
  );
}

/** The balance a confirmation will state, computed live for the chosen date. */
function ConfirmBalanceBox({
  balance,
  date,
  error,
}: {
  balance: number | null;
  date: string;
  error: string;
}) {
  const side = balance === null ? null : signerSide(balance);
  return (
    <div className="confirm-box" role="status" aria-live="polite">
      <div className="hint">الرصيد حتى نهاية {displayDate(date)} (يُحسب تلقائياً)</div>
      {error ? (
        <div className="error-text">تعذّر حساب الرصيد: {error}</div>
      ) : balance === null ? (
        <div className="hint">جارٍ الحساب…</div>
      ) : (
        <>
          <strong className="num confirm-amount">
            {formatAmount(Math.abs(balance))} <RiyalSign size={18} />{' '}
            <span>{balance > 0 ? 'له' : balance < 0 ? 'عليه' : 'مُسوّى'}</span>
          </strong>
          <div className="hint">
            {side
              ? `${amountInWords(Math.abs(balance))} — يظهر في الإقرار «${side}» بلسان المورد/العميل.`
              : 'الحساب مسدَّد في ذلك التاريخ.'}
          </div>
        </>
      )}
    </div>
  );
}

const dashed = {
  flex: '1 1 0',
  minHeight: 76,
  borderStyle: 'dashed',
  borderColor: 'var(--dash)',
  flexDirection: 'column' as const,
  fontWeight: 500,
  fontSize: 14,
  gap: 4,
};

function Thumb({ img, onRemove }: { img: PreparedImage; onRemove: () => void }) {
  const url = useBlobUrl(img.data, img.mime);
  return (
    <span
      style={{
        position: 'relative',
        width: 72,
        height: 72,
        borderRadius: 10,
        overflow: 'hidden',
        border: '1px solid var(--rule)',
        background: 'var(--white)',
      }}
    >
      {url && (
        <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label="إزالة الصورة"
        style={{
          position: 'absolute',
          top: 2,
          insetInlineStart: 2,
          width: 26,
          height: 26,
          borderRadius: '50%',
          border: 0,
          background: 'rgba(27,42,58,.75)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="x" size={14} />
      </button>
      <span
        className="num"
        style={{
          position: 'absolute',
          bottom: 0,
          insetInline: 0,
          fontSize: 10,
          textAlign: 'center',
          background: 'rgba(255,255,255,.85)',
        }}
      >
        {Math.round(img.data.byteLength / 1024)} KB
      </span>
    </span>
  );
}
