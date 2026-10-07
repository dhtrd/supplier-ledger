/** Quick-unlock PIN: exactly 6 digits, one per user for all devices. */
export const PIN_LENGTH = 6;

/** Arabic-Indic and Eastern Arabic-Indic digits typed on Arabic keyboards → 0-9. */
export function normalizeDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
}

/** Arabic error message, or null when the PIN is acceptable. */
export function validatePin(pin: string): string | null {
  if (!/^[0-9]{6}$/.test(normalizeDigits(pin))) return 'الرمز 6 أرقام بالضبط.';
  return null;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * What the app sends to unlock. The PIN itself never leaves the device; the
 * uid prefix stops one user's proof from working for another.
 */
export function pinProof(uid: string, pin: string): Promise<string> {
  return sha256Hex(`sl-pin:v1:${uid}:${normalizeDigits(pin)}`);
}

/** Stored server-side (unreadable): the rules compare sha256(proof) to it. */
export function proofCheck(proof: string): Promise<string> {
  return sha256Hex(proof);
}
