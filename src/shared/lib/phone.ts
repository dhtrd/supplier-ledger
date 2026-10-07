import { normalizeDigits } from './money';

/**
 * Converts a Saudi mobile number to WhatsApp's international form
 * (05XXXXXXXX → 9665XXXXXXXX). Returns null when it is not a valid Saudi
 * mobile number, so the UI can block sending instead of opening a bad link.
 */
export function toWhatsAppNumber(raw: string): string | null {
  const digits = normalizeDigits(raw).replace(/^\+/, '').replace(/\D/g, '');
  let local: string;
  if (/^9665\d{8}$/.test(digits)) local = digits.slice(3);
  else if (/^05\d{8}$/.test(digits)) local = digits.slice(1);
  else if (/^5\d{8}$/.test(digits)) local = digits;
  else return null;
  return `966${local}`;
}

/** Stored form of a Saudi mobile: 05XXXXXXXX, or null when it is not one. */
export function toLocalMobile(raw: string): string | null {
  const n = toWhatsAppNumber(raw);
  return n ? `0${n.slice(3)}` : null;
}

/** wa.me link with a prefilled message (the user still taps "send"). */
export function whatsAppLink(phone: string, message: string): string | null {
  const n = toWhatsAppNumber(phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(message)}` : null;
}
