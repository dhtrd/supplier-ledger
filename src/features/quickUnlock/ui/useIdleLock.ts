import { useCallback, useEffect, useRef } from 'react';
import { reportError } from '../../../core/errors';
import { fb } from '../../../core/firebase';
import { logout, type ReadySession } from '../../../core/session';
import { useToast } from '../../../shared/ui/Toast';
import { deviceId } from '../data/device';
import { heartbeat, lockScreen, readScreenLock } from '../data/screenLockRepo';
import { heartbeatEveryMs, idleOutcome } from '../domain/presence';

/**
 * What the idle timer does for this user:
 *  - without a PIN: sign out (as before);
 *  - with a PIN: lock the account (server-enforced), unless another of the
 *    user's devices was used within the idle period — then sign out here only.
 * Any failure while locking signs out (fail closed).
 * Also sends the «last active» heartbeat while the user works.
 */
export function useIdleLock(s: ReadySession) {
  const { user, screen, settings } = s;
  const toast = useToast();
  const lastBeat = useRef(0);
  const warned = useRef(false);
  const pinSet = screen.pinSet;
  const idleMinutes = settings.idleMinutes;

  const beat = useCallback(
    (force = false) => {
      if (!pinSet) return;
      const now = Date.now();
      if (!force && now - lastBeat.current < heartbeatEveryMs(idleMinutes)) return;
      lastBeat.current = now;
      heartbeat(fb().db, user.uid, deviceId()).catch((e: unknown) => {
        reportError('heartbeat', e);
        if (!warned.current) {
          warned.current = true;
          toast.error('تعذّر تسجيل نشاط هذا الجهاز. قد يُقفل الحساب من جهاز آخر لك.');
        }
      });
    },
    [pinSet, idleMinutes, user.uid, toast],
  );

  // Register this device as active right away (after sign-in / unlock).
  useEffect(() => beat(true), [beat]);

  const onExpire = useCallback(() => {
    if (!pinSet) return void logout();
    const { db } = fb();
    void (async () => {
      try {
        const now = await readScreenLock(db, user.uid);
        const outcome = idleOutcome(now, deviceId(), Date.now(), idleMinutes);
        if (outcome === 'lock') await lockScreen(db, user.uid);
        else await logout();
      } catch (e) {
        reportError('idle-lock', e);
        await logout();
      }
    })();
  }, [pinSet, idleMinutes, user.uid]);

  return { mode: pinSet ? ('lock' as const) : ('logout' as const), onExpire, onActivity: beat };
}
