/** Server-side lock state of one user (document screenLocks/{uid}). */
export interface ScreenLock {
  locked: boolean;
  /** Last lock / unlock (ms). */
  atMs: number;
  /** Last activity heartbeat from any of the user's devices (ms). */
  activeAtMs: number;
  activeBy: string;
  pinSet: boolean;
  /** Random id of the current PIN — a fingerprint key made for another is stale. */
  pinVer: string;
}

export const NO_LOCK: ScreenLock = {
  locked: false,
  atMs: 0,
  activeAtMs: 0,
  activeBy: '',
  pinSet: false,
  pinVer: '',
};

/** Heartbeat at most every 5 minutes, and at least twice per idle period. */
export function heartbeatEveryMs(idleMinutes: number): number {
  return Math.min(5 * 60_000, Math.max(30_000, (idleMinutes * 60_000) / 2));
}

export type IdleOutcome = 'logout' | 'lock' | 'otherDeviceActive';

/**
 * What happens on this device when its idle countdown ends:
 *  - no PIN → sign out (as before quick unlock);
 *  - another device of the same user was used within the idle period → sign
 *    out here only, so the account (shared by both devices) stays unlocked
 *    for the one in use;
 *  - otherwise lock the account (server-enforced).
 */
export function idleOutcome(
  lock: ScreenLock,
  thisDevice: string,
  nowMs: number,
  idleMinutes: number,
): IdleOutcome {
  if (!lock.pinSet) return 'logout';
  const otherRecent =
    lock.activeBy !== '' &&
    lock.activeBy !== thisDevice &&
    nowMs - lock.activeAtMs < idleMinutes * 60_000;
  return otherRecent ? 'otherDeviceActive' : 'lock';
}
