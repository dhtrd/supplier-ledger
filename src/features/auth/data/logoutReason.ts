/**
 * A one-time note shown on the login page after an automatic sign-out
 * (sessionStorage: this tab only, read once).
 */
const KEY = 'sl:logoutReason';

export const LOGOUT_REASONS = {
  otherDevice: 'سُجِّل خروجك من هذا الجهاز لعدم استخدامه، لأنك تعمل على جهاز آخر.',
} as const;

export type LogoutReason = keyof typeof LOGOUT_REASONS;

export function setLogoutReason(reason: LogoutReason): void {
  try {
    sessionStorage.setItem(KEY, reason);
  } catch {
    /* storage blocked: the login page just shows no note */
  }
}

/** The pending note (kept until clearLogoutReason, so re-renders are safe). */
export function peekLogoutReason(): string {
  try {
    const r = sessionStorage.getItem(KEY);
    return r && r in LOGOUT_REASONS ? LOGOUT_REASONS[r as LogoutReason] : '';
  } catch {
    return '';
  }
}

export function clearLogoutReason(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
}
