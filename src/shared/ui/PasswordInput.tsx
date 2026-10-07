import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';

/** How long a single tap keeps the password visible (owner decision «٣»). */
export const REVEAL_MS = 5000;
/** A press longer than this counts as «hold»: visible only while held. */
const HOLD_MS = 300;

/**
 * Password field with the approved reveal button: press and hold to see the
 * password, or tap once to see it for 5 seconds. It hides again on its own,
 * when the form is submitted, and when the tab is hidden — so it is never
 * left visible on a shared device.
 */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false);
  const [timed, setTimed] = useState(0); // >0 while a 5-second reveal runs (key restarts the bar)
  const wrap = useRef<HTMLDivElement>(null);
  const downAt = useRef(0);
  const held = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const hide = () => {
    clearTimeout(timer.current);
    held.current = false;
    setVisible(false);
    setTimed(0);
  };
  const revealFor = () => {
    clearTimeout(timer.current);
    setVisible(true);
    setTimed((n) => n + 1);
    timer.current = setTimeout(hide, REVEAL_MS);
  };

  useEffect(() => {
    const form = wrap.current?.closest('form');
    const onHidden = () => document.visibilityState === 'hidden' && hide();
    form?.addEventListener('submit', hide);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      form?.removeEventListener('submit', hide);
      document.removeEventListener('visibilitychange', onHidden);
      clearTimeout(timer.current);
    };
  }, []);

  return (
    <div className="pw-field" ref={wrap}>
      <div className="pw-wrap">
        <input {...props} type={visible ? 'text' : 'password'} />
        <button
          type="button"
          className={`pw-btn${visible ? ' on' : ''}`}
          aria-label={visible ? 'كلمة المرور ظاهرة مؤقتاً' : 'إظهار كلمة المرور مؤقتاً'}
          aria-pressed={visible}
          aria-controls={props.id}
          onPointerDown={(e) => {
            e.preventDefault(); // keep focus (and the mobile keyboard) in the input
            e.currentTarget.setPointerCapture(e.pointerId);
            clearTimeout(timer.current);
            held.current = true;
            downAt.current = Date.now();
            setVisible(true);
            setTimed(0);
          }}
          onPointerUp={() => {
            if (!held.current) return;
            held.current = false;
            if (Date.now() - downAt.current < HOLD_MS) revealFor();
            else hide();
          }}
          onPointerCancel={hide}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              revealFor();
            }
          }}
        >
          <svg
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {visible ? (
              <path d="M3 3l18 18M10.6 5.1A9.7 9.7 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2" />
            ) : (
              <>
                <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
                <circle cx="12" cy="12" r="3" />
              </>
            )}
          </svg>
        </button>
      </div>
      <div className="pw-timer" aria-hidden="true">
        {visible && <i key={timed} className={timed ? 'run' : 'full'} />}
      </div>
    </div>
  );
}
