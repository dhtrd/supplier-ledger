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

export function isLocked(fails: number): boolean {
  return fails >= MAX_FAILED_ATTEMPTS;
}

export function remainingAttempts(fails: number): number {
  return Math.max(0, MAX_FAILED_ATTEMPTS - fails);
}
