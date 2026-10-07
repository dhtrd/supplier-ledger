import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage, reportError } from '../../../core/errors';
import { fb } from '../../../core/firebase';
import { useReady } from '../../../core/session';
import { displayDate } from '../../../shared/lib/dates';
import { balanceSide, formatAmount, SIDE_LABEL } from '../../../shared/lib/money';
import { toWhatsAppNumber, whatsAppLink } from '../../../shared/lib/phone';
import { amountInWords } from '../../../shared/lib/tafqit';
import { useBlobUrl } from '../../../shared/ui/hooks';
import { Money } from '../../../shared/ui/RiyalSign';
import { Sheet } from '../../../shared/ui/Sheet';
import { useToast } from '../../../shared/ui/Toast';
import type { Account } from '../../accounts/domain/types';
import {
  createSignLink,
  linkUrl,
  revokeLink,
  type SignLink,
} from '../../signing/data/signLinksRepo';
import { deleteEntry, getAttachment, type EntrySnapshot } from '../data/entriesRepo';
import { ENTRY_LABEL, isLocked } from '../domain/types';
import type { SignState } from './signState';

export function EntrySheet({
  account,
  snap,
  balanceAfter,
  signState,
  links,
  onClose,
  onEdit,
}: {
  account: Account;
  snap: EntrySnapshot;
  balanceAfter: number | null;
  signState: SignState;
  links: SignLink[];
  onClose: () => void;
  onEdit: () => void;
}) {
  const e = snap.entry;
  const { user, settings } = useReady();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ url: string; wa: string | null } | null>(null);
  const locked = isLocked(e);
  const waNumber = toWhatsAppNumber(account.phone);

  const remove = async () => {
    setBusy(true);
    try {
      const open = links
        .filter((l) => l.entryId === e.id && l.status === 'pending')
        .map((l) => l.id);
      await deleteEntry(fb().db, user.uid, account.id, snap, open);
      toast.info(`حُذفت ${ENTRY_LABEL[e.type]} وسُجّل الحذف في سجل التعديلات.`);
      onClose();
    } catch (err) {
      reportError('delete-entry', err);
      toast.error(errorMessage(err));
      setBusy(false);
    }
  };

  /** Creates the link; opens WhatsApp in a tab reserved before the await (so it is not popup-blocked). */
  const send = async (mode: 'whatsapp' | 'copy') => {
    const win = mode === 'whatsapp' && waNumber ? window.open('', '_blank') : null;
    setBusy(true);
    try {
      if (e.voucherNo === null) throw new Error('لا يوجد رقم سند لهذه الدفعة.');
      const pending = links.filter((l) => l.entryId === e.id && l.status === 'pending');
      const token = await createSignLink(fb().db, user.uid, {
        account,
        entry: e,
        payerName: settings.payerName,
        ttlMinutes: settings.linkMinutes,
        pendingForEntry: pending,
      });
      const url = linkUrl(token, `${window.location.origin}${window.location.pathname}`);
      const text =
        `سند دفعة رقم ${e.voucherNo} من ${settings.payerName} إلى ${account.name}\n` +
        `المبلغ: ${formatAmount(e.amount)} ريال\n` +
        `للإقرار بالاستلام والتوقيع افتح الرابط (صالح ${settings.linkMinutes} دقيقة ولمرة واحدة):\n${url}`;
      const wa = whatsAppLink(account.phone, text);
      setCreated({ url, wa });
      if (mode === 'copy') {
        await navigator.clipboard.writeText(url).then(
          () => toast.info('نُسخ رابط التوقيع.'),
          () => toast.error('تعذّر النسخ التلقائي. انسخ الرابط الظاهر يدوياً.'),
        );
      } else if (win && wa) {
        win.opener = null;
        win.location.href = wa;
      }
    } catch (err) {
      win?.close();
      reportError('create-link', err);
      toast.error(
        err &&
          typeof err === 'object' &&
          'code' in err &&
          String(err.code).includes('permission-denied')
          ? 'تعذّر إنشاء الرابط. ربما تغيّرت مدة الرابط في الإعدادات أو وُقّع السند. حدّث الصفحة وأعد المحاولة.'
          : errorMessage(err),
      );
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    setBusy(true);
    try {
      await revokeLink(fb().db, id);
      toast.info('أُلغي رابط التوقيع.');
    } catch (err) {
      reportError('revoke', err);
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const title = e.voucherNo !== null ? `سند دفعة ${e.voucherNo}` : ENTRY_LABEL[e.type];

  if (confirmDelete)
    return (
      <Sheet title={`حذف ${ENTRY_LABEL[e.type]}؟`} onClose={() => setConfirmDelete(false)}>
        <p style={{ margin: 0, lineHeight: 1.8 }}>
          ستختفي من الكشف ويتغير الرصيد. تبقى نسخة في سجل التعديلات والنسخ الاحتياطي.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
            {busy ? 'جارٍ…' : 'نعم، احذف'}
          </button>
          <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
            تراجع
          </button>
        </div>
      </Sheet>
    );

  return (
    <Sheet
      title={title}
      onClose={onClose}
      badge={
        <span className="muted num" style={{ fontSize: 13 }}>
          {displayDate(e.date)}
        </span>
      }
    >
      <div
        style={{
          borderTop: '2px solid var(--ink)',
          paddingTop: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {e.type === 'payment' && (
          <div>
            صُرف إلى: <strong>{account.name}</strong>
          </div>
        )}
        {e.type !== 'note' && (
          <>
            <div
              style={{
                fontSize: 28,
                fontWeight: 600,
                color: e.type === 'invoice' ? 'var(--lah)' : 'var(--alayh)',
              }}
            >
              <Money halalas={e.amount} />
            </div>
            <div className="muted" style={{ fontSize: 14 }}>
              {amountInWords(e.amount)}
            </div>
          </>
        )}
        {e.details && <div style={{ overflowWrap: 'anywhere' }}>البيان: {e.details}</div>}
        {balanceAfter !== null && (
          <div className="muted num" style={{ fontSize: 13 }}>
            الرصيد بعدها: {formatAmount(Math.abs(balanceAfter))}{' '}
            {SIDE_LABEL[balanceSide(balanceAfter)]}
          </div>
        )}
      </div>

      {e.attachments.length > 0 && <Attachments accountId={account.id} ids={e.attachments} />}

      {e.type === 'payment' && (
        <div
          style={{
            borderTop: '1px solid var(--rule)',
            paddingTop: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {e.signature ? (
            <div className="banner banner-ok">
              ✓ وقّعه {e.signature.name}
              {e.signature.signedAtMs > 0 &&
                ` في ${new Date(e.signature.signedAtMs).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'short' })}`}
            </div>
          ) : signState.kind === 'signed' ? (
            <div className="banner banner-ok">✓ وُقّع — جارٍ حفظ التوقيع في السند…</div>
          ) : created ? (
            <>
              <div className="banner banner-ok">
                أُنشئ الرابط — بانتظار التوقيع، ينتهي بعد {settings.linkMinutes} دقيقة.
              </div>
              {created.wa && (
                <a
                  className="btn btn-go"
                  href={created.wa}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  فتح واتساب
                </a>
              )}
              <input
                className="input ltr num"
                readOnly
                value={created.url}
                aria-label="رابط التوقيع"
                onFocus={(ev) => ev.currentTarget.select()}
                style={{ fontSize: 13 }}
              />
            </>
          ) : (
            <>
              {signState.kind === 'pending' && signState.link && (
                <div className="banner banner-warn row-between">
                  <span>بانتظار التوقيع · ينتهي بعد {signState.minutesLeft} د</span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => revoke(signState.link!.id)}
                    disabled={busy}
                  >
                    إلغاء الرابط
                  </button>
                </div>
              )}
              <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.7 }}>
                {waNumber
                  ? `يُفتح واتساب على ${account.phone} برابط صالح ${settings.linkMinutes} دقيقة ولمرة واحدة.`
                  : 'لا يوجد رقم جوال سعودي صحيح لهذا الحساب؛ يمكنك نسخ الرابط وإرساله بنفسك، أو إضافة الرقم من «تعديل الحساب».'}
                {signState.kind === 'pending' && ' إنشاء رابط جديد يلغي الرابط السابق.'}
              </p>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: waNumber ? '2fr 1fr' : '1fr',
                  gap: 10,
                }}
              >
                {waNumber && (
                  <button
                    type="button"
                    className="btn btn-go"
                    onClick={() => send('whatsapp')}
                    disabled={busy}
                  >
                    {busy ? 'جارٍ…' : 'فتح واتساب'}
                  </button>
                )}
                <button type="button" className="btn" onClick={() => send('copy')} disabled={busy}>
                  نسخ الرابط
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          borderTop: '1px solid var(--rule)',
          paddingTop: 12,
        }}
      >
        {e.type === 'payment' && (
          <Link className="btn" to={`/print/voucher/${account.id}/${e.id}`}>
            طباعة السند
          </Link>
        )}
        {!locked && (
          <>
            <button type="button" className="btn" onClick={onEdit}>
              تعديل
            </button>
            <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
              حذف
            </button>
          </>
        )}
        <button
          type="button"
          className="btn btn-quiet"
          onClick={onClose}
          style={{ marginInlineStart: 'auto' }}
        >
          إغلاق
        </button>
      </div>
      {locked && (
        <p className="hint" style={{ margin: 0 }}>
          السند الموقّع لا يُعدّل ولا يُحذف.
        </p>
      )}
    </Sheet>
  );
}

function Attachments({ accountId, ids }: { accountId: string; ids: string[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: 14, fontWeight: 500 }}>المرفقات ({ids.length})</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {ids.map((id, i) => (
          <button
            key={id}
            type="button"
            className="btn btn-sm"
            aria-pressed={open === id}
            onClick={() => setOpen(open === id ? null : id)}
          >
            صورة {i + 1}
          </button>
        ))}
      </div>
      {open && <AttachmentView key={open} accountId={accountId} id={open} />}
    </div>
  );
}

export function AttachmentView({ accountId, id }: { accountId: string; id: string }) {
  const [img, setImg] = useState<{ data: Uint8Array; mime: string } | null | undefined>(undefined);
  const [error, setError] = useState('');
  useEffect(() => {
    getAttachment(fb().db, accountId, id)
      .then(setImg)
      .catch((e) => {
        reportError('attachment', e);
        setError(errorMessage(e));
      });
  }, [accountId, id]);
  const url = useBlobUrl(img?.data, img?.mime);
  if (error) return <div className="error-text">{error}</div>;
  if (img === undefined)
    return (
      <div className="muted" style={{ fontSize: 13 }}>
        جارٍ تحميل الصورة…
      </div>
    );
  if (!url) return <div className="error-text">الصورة غير موجودة.</div>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      <img
        src={url}
        alt="مرفق العملية"
        style={{
          width: '100%',
          maxHeight: 420,
          objectFit: 'contain',
          borderRadius: 10,
          border: '1px solid var(--rule)',
          background: 'var(--white)',
        }}
      />
    </a>
  );
}
