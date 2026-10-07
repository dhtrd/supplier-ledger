import { useEffect, useState } from 'react';
import { errorMessage, reportError } from '../../../core/errors';
import { fb } from '../../../core/firebase';
import { useReady } from '../../../core/session';
import { encryptText, PASSPHRASE_MIN } from '../../../shared/lib/backupCrypto';
import { Sheet } from '../../../shared/ui/Sheet';
import { useToast } from '../../../shared/ui/Toast';
import {
  exportSnapshot,
  listBackupRequests,
  requestBackup,
  type BackupRequest,
} from '../data/backupRepo';
import { backupFileName } from '../domain/snapshot';

const when = (ms: number) =>
  new Date(ms).toLocaleString('ar-SA-u-ca-gregory-nu-latn', {
    timeZone: 'Asia/Riyadh',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

/** Owner & admin: request a Dropbox backup now, or download an encrypted copy. */
export function BackupNow() {
  const { user } = useReady();
  const toast = useToast();
  const [requests, setRequests] = useState<BackupRequest[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    listBackupRequests(fb().db)
      .then((r) => alive && setRequests(r))
      .catch((e) => {
        reportError('backup-requests', e);
        if (alive) setLoadError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const pending = requests?.some((r) => r.status === 'pending') ?? false;

  const request = async () => {
    setBusy(true);
    try {
      await requestBackup(fb().db, user.uid);
      toast.info('أُرسل الطلب. تُنفَّذ النسخة إلى Dropbox خلال 15 دقيقة تقريباً.');
      setReloadKey((k) => k + 1);
    } catch (e) {
      reportError('backup-request', e);
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="stack" style={{ gap: 10 }}>
      <h2 className="serif" style={{ margin: 0, fontSize: 20 }}>
        نسخة احتياطية الآن
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <button type="button" className="btn" onClick={request} disabled={busy || pending}>
          {pending ? 'طلب قيد التنفيذ…' : 'نسخة إلى Dropbox'}
        </button>
        <button type="button" className="btn" onClick={() => setDownloadOpen(true)}>
          تنزيل نسخة مشفّرة
        </button>
      </div>
      {loadError && <div className="error-text">{loadError}</div>}
      {requests && requests.length > 0 && (
        <ul
          className="muted"
          style={{ margin: 0, paddingInlineStart: 18, fontSize: 13, lineHeight: 1.9 }}
        >
          {requests.map((r) => (
            <li key={r.id}>
              <span className="num">{r.requestedAtMs ? when(r.requestedAtMs) : '—'}</span> ·{' '}
              {r.status === 'pending' && 'بانتظار التنفيذ (خلال 15 دقيقة تقريباً)'}
              {r.status === 'done' && (
                <span className="lah">تمّت{r.doneAtMs ? ` ${when(r.doneAtMs)}` : ''}</span>
              )}
              {r.status === 'failed' && (
                <span className="alayh">فشلت — {r.message || 'راجع GitHub Actions'}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="hint" style={{ margin: 0 }}>
        النسخ في Dropbox مشفّرة وتُحفظ شهراً. الملف المنزَّل على الجهاز مشفّر بعبارة مرور تختارها
        الآن.
      </p>
      {downloadOpen && <DownloadSheet onClose={() => setDownloadOpen(false)} />}
    </section>
  );
}

function DownloadSheet({ onClose }: { onClose: () => void }) {
  const { profile } = useReady();
  const toast = useToast();
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<number | null>(null);

  const run = async () => {
    setError('');
    if (pass.length < PASSPHRASE_MIN)
      return setError(`عبارة المرور ${PASSPHRASE_MIN} أحرف على الأقل.`);
    if (pass !== pass2) return setError('العبارتان غير متطابقتين.');
    setProgress(0);
    try {
      const snapshot = await exportSnapshot(
        fb().db,
        { includeMeta: profile.role === 'owner' },
        setProgress,
      );
      const envelope = await encryptText(JSON.stringify(snapshot), { passphrase: pass });
      const blob = new Blob([JSON.stringify(envelope)], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = backupFileName(snapshot.takenAt);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.info(
        `نُزّلت النسخة (${Object.keys(snapshot.docs).length} مستند). احفظ عبارة المرور في مكان آمن.`,
      );
      onClose();
    } catch (e) {
      reportError('backup-download', e);
      setError(errorMessage(e));
      setProgress(null);
    }
  };

  return (
    <Sheet title="تنزيل نسخة مشفّرة" onClose={progress === null ? onClose : () => undefined}>
      <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.8 }}>
        تُجمع كل البيانات والصور المصغّرة في ملف واحد مشفّر (AES-256). بدون عبارة المرور لا يمكن فتح
        الملف ولا استرجاعه — لا نحتفظ بها.
      </p>
      <div className="field">
        <label htmlFor="bk-pass">عبارة المرور</label>
        <input
          id="bk-pass"
          type="password"
          autoComplete="new-password"
          className="input ltr"
          style={{ textAlign: 'right' }}
          value={pass}
          onChange={(e) => setPass(e.target.value)}
        />
        <label htmlFor="bk-pass2" className="sr-only">
          تأكيد عبارة المرور
        </label>
        <input
          id="bk-pass2"
          type="password"
          autoComplete="new-password"
          placeholder="أعد كتابتها للتأكيد"
          className="input ltr"
          style={{ textAlign: 'right' }}
          value={pass2}
          onChange={(e) => setPass2(e.target.value)}
        />
      </div>
      {error && (
        <div className="banner banner-err" role="alert">
          {error}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={run}
          disabled={progress !== null}
        >
          {progress === null ? 'إنشاء وتنزيل' : `جارٍ التجميع… ${progress} مستند`}
        </button>
        <button type="button" className="btn" onClick={onClose} disabled={progress !== null}>
          إلغاء
        </button>
      </div>
    </Sheet>
  );
}
