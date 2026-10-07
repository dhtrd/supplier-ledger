import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Sheet } from '../shared/ui/Sheet';
import { idlePhase } from './idle';

const KEY = 'sl:lastActivity';
const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

function readShared(): number {
  try {
    return Number(localStorage.getItem(KEY)) || 0;
  } catch {
    return 0; // storage blocked (private mode): per-tab tracking still works
  }
}
function writeShared(ms: number): void {
  try {
    localStorage.setItem(KEY, String(ms));
  } catch {
    /* per-tab only */
  }
}

/**
 * After `idleMinutes` without activity (in any tab) a countdown of
 * `countdownSeconds` is shown; when it ends `onExpire` runs (sign-out, or
 * the quick-unlock screen once enabled). Both durations come from the owner's
 * settings.
 */
export function IdleGuard({
  idleMinutes,
  countdownSeconds,
  onExpire,
  children,
}: {
  idleMinutes: number;
  countdownSeconds: number;
  onExpire: () => void;
  children: ReactNode;
}) {
  const last = useRef(0);
  const warning = useRef(false);
  const expired = useRef(false);
  const [left, setLeft] = useState<number | null>(null);
  const expireRef = useRef(onExpire);
  useEffect(() => {
    expireRef.current = onExpire;
  }, [onExpire]);

  const touch = useCallback(() => {
    if (warning.current) return; // only «متابعة» dismisses the warning
    const now = Date.now();
    last.current = now;
    // Throttle cross-tab writes to once every 5 s.
    if (now - readShared() > 5000) writeShared(now);
  }, []);

  const keepWorking = () => {
    warning.current = false;
    setLeft(null);
    last.current = Date.now();
    writeShared(last.current);
  };

  useEffect(() => {
    last.current = Date.now();
    writeShared(last.current);
    for (const e of EVENTS) window.addEventListener(e, touch, { passive: true });
    const tick = () => {
      if (expired.current) return;
      const lastSeen = Math.max(last.current, readShared());
      const phase = idlePhase(Date.now() - lastSeen, idleMinutes, countdownSeconds);
      if (phase.kind === 'active') {
        if (warning.current) {
          // Another tab was used: drop the warning here too.
          warning.current = false;
          setLeft(null);
        }
        return;
      }
      if (phase.kind === 'warning') {
        warning.current = true;
        setLeft(phase.secondsLeft);
        return;
      }
      expired.current = true;
      setLeft(null);
      expireRef.current();
    };
    const t = setInterval(tick, 1000);
    // Timers are throttled in background tabs: re-check on return.
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
      for (const e of EVENTS) window.removeEventListener(e, touch);
    };
  }, [idleMinutes, countdownSeconds, touch]);

  return (
    <>
      {children}
      {left !== null && (
        <Sheet title="هل ما زلت هنا؟" onClose={keepWorking}>
          <p style={{ margin: 0, lineHeight: 1.8 }}>
            لم يُستخدم البرنامج منذ {idleMinutes} دقيقة. سيُسجَّل خروجك تلقائياً خلال{' '}
            <strong className="num" aria-live="assertive">
              {left}
            </strong>{' '}
            ثانية.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
            <button type="button" className="btn btn-primary" onClick={keepWorking}>
              متابعة العمل
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                expired.current = true;
                setLeft(null);
                expireRef.current();
              }}
            >
              خروج الآن
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
