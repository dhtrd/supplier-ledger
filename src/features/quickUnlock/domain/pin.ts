/** Quick-unlock PIN: exactly 6 digits, one per user for all devices. */
export const PIN_LENGTH = 6;

/** Arabic-Indic and Eastern Arabic-Indic digits typed on Arabic keyboards → 0-9. */
export function normalizeDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
}

/**
 * Easy-to-guess PINs (owner decision): one repeated digit (000000), a straight
 * run up or down (123456, 987654, 890123), or a repeated pair/triple
 * (121212, 123123). Checked in the app only — the server never sees the PIN.
 */
export function isWeakPin(pin: string): boolean {
  const d = normalizeDigits(pin);
  if (!/^[0-9]{6}$/.test(d)) return false;
  const n = [...d].map(Number);
  const steps = n.slice(1).map((x, i) => (x - n[i]! + 10) % 10);
  if (steps.every((s) => s === steps[0]) && [0, 1, 9].includes(steps[0]!)) return true;
  if (d === d.slice(0, 2).repeat(3) || d === d.slice(0, 3).repeat(2)) return true;
  return false;
}

/** Arabic error message, or null when the PIN is acceptable. */
export function validatePin(pin: string): string | null {
  if (!/^[0-9]{6}$/.test(normalizeDigits(pin))) return 'الرمز 6 أرقام بالضبط.';
  if (isWeakPin(pin))
    return 'هذا الرمز سهل التخمين. تجنّب الأرقام المتكررة (000000) والمتتالية (123456) والمكررة (121212).';
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
