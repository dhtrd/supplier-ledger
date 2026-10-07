import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage, reportError } from '../../core/errors';

/** A full-page «are you sure?» step shown before a form (never a browser dialog). */
export function ConfirmGate({
  title,
  children,
  confirmLabel,
  backTo,
  onConfirm,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  backTo: string;
  onConfirm: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setBusy(true);
    setError('');
    try {
      await onConfirm();
    } catch (e) {
      reportError('confirm-gate', e);
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <div className="pad stack" style={{ maxWidth: 560, margin: '0 auto', paddingTop: 32 }}>
      <div
        className="gate-card"
        role="alertdialog"
        aria-labelledby="gate-title"
        aria-describedby="gate-body"
      >
        <h1 id="gate-title" className="serif" style={{ margin: 0, fontSize: 22 }}>
          {title}
        </h1>
        <p id="gate-body" style={{ margin: 0, lineHeight: 1.9 }}>
          {children}
        </p>
        {error && (
          <div className="banner banner-err" role="alert">
            {error}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void go()}
            disabled={busy}
          >
            {busy ? 'جارٍ…' : confirmLabel}
          </button>
          <Link to={backTo} className="btn">
            إلغاء
          </Link>
        </div>
      </div>
    </div>
  );
}
