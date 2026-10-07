/** Failed sign-in / PIN attempts allowed before the account is locked. */
export const MAX_FAILED_ATTEMPTS = 5;

/**
 * Document id of an email's failure counter: lowercase hex SHA-256 of the
 * lower-cased email. firestore.rules computes the same value from the token.
 */
export async function emailKey(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(email.trim().toLowerCase());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A lock lifts by itself this long after the last failure (owner decision 2026-10-07). */
export const LOCK_MINUTES = 15;

export interface FailureState {
  fails: number;
  /** Server time of the last failure (0 = unknown). */
  lastFailAtMs: number;
}

export function isLocked(s: FailureState | number, nowMs: number = Date.now()): boolean {
  const st = typeof s === 'number' ? { fails: s, lastFailAtMs: 0 } : s;
  if (st.fails < MAX_FAILED_ATTEMPTS) return false;
  return st.lastFailAtMs === 0 || nowMs < st.lastFailAtMs + LOCK_MINUTES * 60_000;
}

/** Failures that still count (an expired lock counts as none). */
export function effectiveFails(s: FailureState, nowMs: number = Date.now()): number {
  return s.fails >= MAX_FAILED_ATTEMPTS && !isLocked(s, nowMs) ? 0 : s.fails;
}

/** Whole minutes left until a lock lifts by itself (0 when not locked). */
export function minutesUntilUnlock(s: FailureState, nowMs: number = Date.now()): number {
  if (!isLocked(s, nowMs) || s.lastFailAtMs === 0) return 0;
  return Math.max(1, Math.ceil((s.lastFailAtMs + LOCK_MINUTES * 60_000 - nowMs) / 60_000));
}

export function remainingAttempts(fails: number): number {
  return Math.max(0, MAX_FAILED_ATTEMPTS - fails);
}

/** Firebase Auth error codes that mean «wrong email or password». */
export const WRONG_PASSWORD_CODES: ReadonlySet<string> = new Set([
  'auth/invalid-credential',
  'auth/wrong-password',
  'auth/user-not-found',
  'auth/invalid-login-credentials',
]);
