import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { errorMessage, reportError } from '../../../core/errors';
import { fb } from '../../../core/firebase';
import { displayDate } from '../../../shared/lib/dates';
import { formatAmount } from '../../../shared/lib/money';
import { useNow } from '../../../shared/ui/hooks';
import { Icon } from '../../../shared/ui/Icon';
import { Logo } from '../../../shared/ui/Logo';
import { Money } from '../../../shared/ui/RiyalSign';
import { expiresAtMs, getPublicLink, signLink, type SignLink } from '../data/signLinksRepo';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';

const MAX_SIGNATURE_CHARS = 61_440;
const TOKEN = /^[A-Za-z0-9_-]{22,64}$/;

type View =
  | { kind: 'loading' }
  | { kind: 'dead' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; link: SignLink }
  | { kind: 'done'; link: SignLink; name: string };

/** Public page opened from WhatsApp. No login; the rules allow one signature before expiry. */
export function SignPage() {
  const { token = '' } = useParams();
  const validToken = TOKEN.test(token);
  const [loaded, setView] = useState<View>({ kind: 'loading' });
  const view: View = validToken ? loaded : { kind: 'dead' };
  const [name, setName] = useState('');
  const [hasInk, setHasInk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const pad = useRef<SignaturePadHandle>(null);
  const now = useNow(15_000);
  const onInk = useCallback((v: boolean) => setHasInk(v), []);

  useEffect(() => {
    if (!validToken) return;
    getPublicLink(fb().db, token)
      .then((l) =>
        setView(l && l.status === 'pending' ? { kind: 'ready', link: l } : { kind: 'dead' }),
      )
      .catch((e) => {
        // The rules deny reads of expired/used links: that is the normal "dead link" case.
        const code = e && typeof e === 'object' && 'code' in e ? String(e.code) : '';
        if (code.includes('permission-denied')) setView({ kind: 'dead' });
        else {
          reportError('sign-load', e);
          setView({ kind: 'error', message: errorMessage(e) });
        }
      });
  }, [token, validToken]);

  const link = view.kind === 'ready' || view.kind === 'done' ? view.link : null;
  const minutesLeft = link ? Math.ceil((expiresAtMs(link) - now) / 60_000) : 0;
  const expired = view.kind === 'ready' && minutesLeft <= 0;
  const ready = name.trim().length >= 2 && hasInk && !busy && !expired;

  const submit = async () => {
    if (view.kind !== 'ready') return;
    setFormError('');
    const signer = name.trim().replace(/\s+/g, ' ');
    if (signer.length < 2 || signer.length > 80)
      return setFormError('اكتب اسمك (من حرفين إلى 80 حرفاً).');
    const png = pad.current?.toPng(MAX_SIGNATURE_CHARS);
    if (!png) return setFormError('ارسم توقيعك داخل المربع.');
    setBusy(true);
    try {
      await signLink(fb().db, token, signer, png);
      setView({ kind: 'done', link: view.link, name: signer });
    } catch (e) {
      const code = e && typeof e === 'object' && 'code' in e ? String(e.code) : '';
      if (code.includes('permission-denied')) setView({ kind: 'dead' });
      else {
        reportError('sign-submit', e);
        setFormError(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        maxWidth: 560,
        margin: '0 auto',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '16px 20px',
          borderBottom: '2px solid var(--ink)',
        }}
      >
        {link && <Logo data={link.logo} size={52} placeholder="" hideEmpty />}
        <div>
          <div className="serif" style={{ fontSize: 20 }}>
            {link?.accountName ?? 'سند استلام دفعة'}
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            سند استلام دفعة
          </div>
        </div>
      </header>

      {view.kind === 'loading' && (
        <div className="empty">
          <div className="spinner" style={{ margin: '0 auto 12px' }} />
          جارٍ فتح السند…
        </div>
      )}
      {view.kind === 'error' && (
        <div className="pad">
          <div className="banner banner-err" role="alert">
            {view.message}
          </div>
        </div>
      )}
      {(view.kind === 'dead' || expired) && (
        <Result
          tone="bad"
          title="انتهت صلاحية الرابط أو استُخدم"
          text="هذا الرابط لم يعد صالحاً للتوقيع. اطلب من المرسل إصدار رابط جديد."
        />
      )}
      {view.kind === 'done' && (
        <Result
          tone="good"
          title="تم التوقيع"
          text={`شكراً ${view.name}. سُجّل استلامك لمبلغ ${formatAmount(view.link.amount)} ريال، وأُلغي هذا الرابط.`}
        />
      )}

      {view.kind === 'ready' && !expired && (
        <div
          style={{ padding: '18px 20px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}
        >
          <div className="row-between" style={{ alignItems: 'baseline' }}>
            <h1 className="serif" style={{ margin: 0, fontSize: 26 }}>
              سند دفعة {view.link.voucherNo}
            </h1>
            <span className="muted num" style={{ fontSize: 13 }}>
              {displayDate(view.link.date)}
            </span>
          </div>
          <div className="banner banner-warn" style={{ fontSize: 13, padding: '8px 12px' }}>
            ينتهي هذا الرابط بعد {minutesLeft} دقيقة، ويُستخدم مرة واحدة.
          </div>
          <div
            style={{
              borderTop: '1px solid var(--rule)',
              borderBottom: '1px solid var(--rule)',
              padding: '14px 0',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div>
              دفعة من <strong>{view.link.payerName}</strong> إلى{' '}
              <strong>{view.link.accountName}</strong>
            </div>
            <div style={{ fontSize: 32, fontWeight: 600 }}>
              <Money halalas={view.link.amount} />
            </div>
            <div className="muted" style={{ fontSize: 14 }}>
              {view.link.amountWords}
            </div>
            {view.link.details && (
              <div style={{ overflowWrap: 'anywhere' }}>البيان: {view.link.details}</div>
            )}
          </div>

          <div className="field">
            <label htmlFor="signer">اسم المستلم</label>
            <input
              id="signer"
              className="input"
              value={name}
              maxLength={80}
              autoComplete="name"
              placeholder="اكتب اسمك الكامل"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="field">
            <div className="row-between">
              <span id="sig-label" className="label">
                التوقيع
              </span>
              <button
                type="button"
                className="btn-link"
                style={{ fontSize: 13 }}
                onClick={() => pad.current?.clear()}
              >
                مسح
              </button>
            </div>
            <SignaturePad ref={pad} labelledBy="sig-label" onChange={onInk} />
            <span className="hint">ارسم توقيعك بإصبعك داخل المربع.</span>
          </div>

          {formError && (
            <div className="banner banner-err" role="alert">
              {formError}
            </div>
          )}

          <button
            type="button"
            className="btn btn-go btn-block"
            style={{ minHeight: 54, fontSize: 17 }}
            disabled={!ready}
            onClick={submit}
          >
            {busy ? 'جارٍ الحفظ…' : 'أقرّ بالاستلام'}
          </button>
          <p className="hint" style={{ margin: 0, lineHeight: 1.7 }}>
            بالضغط تُقرّ باستلام المبلغ أعلاه. يُحفظ توقيعك مع وقت الخادم، ويُلغى الرابط فوراً.
          </p>
        </div>
      )}
    </div>
  );
}

function Result({ tone, title, text }: { tone: 'good' | 'bad'; title: string; text: string }) {
  const color = tone === 'good' ? 'var(--lah)' : 'var(--alayh)';
  return (
    <div
      style={{
        padding: '48px 28px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 14,
        textAlign: 'center',
      }}
      role="status"
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: '50%',
          border: `2px solid ${color}`,
          color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={tone === 'good' ? 'check' : 'clock'} size={34} />
      </div>
      <h1 className="serif" style={{ margin: 0, fontSize: 26 }}>
        {title}
      </h1>
      <p className="muted" style={{ margin: 0, fontSize: 15, lineHeight: 1.8 }}>
        {text}
      </p>
    </div>
  );
}
