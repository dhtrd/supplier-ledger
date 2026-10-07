import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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
 * After `idleMinutes` without activity (in any tab) the screen fades to the
 * lock-screen ink over `countdownSeconds` (approved design «ع٤»); any touch or
 * key continues working. When the fade completes `onExpire` runs (lock, or
 * sign-out without quick unlock). Times are measured on the real clock, so a
 * sleeping device or a background tab still counts the full period.
 */
export function IdleGuard({
  idleMinutes,
  countdownSeconds,
  mode,
  onExpire,
  onActivity,
  children,
}: {
  idleMinutes: number;
  countdownSeconds: number;
  /** What happens at the end — only changes the wording. */
  mode: 'lock' | 'logout';
  onExpire: () => void;
  /** Called on user activity (throttled by the caller). */
  onActivity?: () => void;
  children: ReactNode;
}) {
  const last = useRef(0);
  const warning = useRef(false);
  const expired = useRef(false);
  const [left, setLeft] = useState<number | null>(null);
  const expireRef = useRef(onExpire);
  const activityRef = useRef(onActivity);
  useEffect(() => {
    expireRef.current = onExpire;
    activityRef.current = onActivity;
  }, [onExpire, onActivity]);

  const keepWorking = useCallback(() => {
    warning.current = false;
    setLeft(null);
    last.current = Date.now();
    writeShared(last.current);
    activityRef.current?.();
  }, []);

  const touch = useCallback(() => {
    if (expired.current) return;
    if (warning.current) return keepWorking(); // any touch/key continues
    const now = Date.now();
    last.current = now;
    // Throttle cross-tab writes to once every 5 s.
    if (now - readShared() > 5000) writeShared(now);
    activityRef.current?.();
  }, [keepWorking]);

  useEffect(() => {
    expired.current = false;
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
        // Fractional seconds drive the fade smoothly.
        const exact = Math.max(
          0,
          (lastSeen + idleMinutes * 60_000 + countdownSeconds * 1000 - Date.now()) / 1000,
        );
        setLeft(exact);
        return;
      }
      expired.current = true;
      warning.current = false;
      setLeft(null);
      expireRef.current();
    };
    const t = setInterval(tick, 200);
    // Timers are throttled in background tabs: re-check on return.
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
      for (const e of EVENTS) window.removeEventListener(e, touch);
    };
  }, [idleMinutes, countdownSeconds, touch]);

  const progress = left === null ? 0 : 1 - left / countdownSeconds;
  return (
    <>
      {children}
      {left !== null && (
        <button
          type="button"
          className="idle-fade"
          style={{ backgroundColor: `rgba(27, 42, 58, ${(0.35 + 0.65 * progress).toFixed(3)})` }}
          onClick={keepWorking}
          aria-label="متابعة العمل"
          aria-describedby="idle-fade-text"
        >
          <span className="idle-fade-num num" aria-hidden="true">
            {Math.max(1, Math.ceil(left))}
          </span>
          <span id="idle-fade-text" role="alert">
            {mode === 'lock' ? 'سيُقفل البرنامج' : 'سيُسجَّل خروجك'} لعدم الاستخدام منذ{' '}
            {idleMinutes} دقيقة
          </span>
          <span className="idle-fade-hint">المس أي مكان أو اضغط أي زر للمتابعة</span>
        </button>
      )}
    </>
  );
}
