/**
 * Money is stored as integer halalas (1 SAR = 100 halalas) to avoid floating
 * point drift. All UI input/output goes through these helpers.
 */

const ARABIC_DIGITS = /[٠-٩]/g;
const EASTERN_DIGITS = /[۰-۹]/g;

/** Converts Arabic-Indic / Persian digits and separators to ASCII. */
export function normalizeDigits(input: string): string {
  return input
    .replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(EASTERN_DIGITS, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.')
    .replace(/[٬،,\s]/g, '');
}

/** Largest amount accepted: 1,000,000,000 SAR (the rules cap halalas at 10^11). */
const MAX_WHOLE_DIGITS = 9;

/**
 * Keeps an amount field to what an amount can be while the user types:
 * digits (Arabic or Western), one decimal point, at most two decimals.
 * Letters and other symbols are dropped as they are typed.
 */
export function cleanAmountInput(raw: string): string {
  const s = normalizeDigits(raw).replace(/[^\d.]/g, '');
  const dot = s.indexOf('.');
  const whole = (dot < 0 ? s : s.slice(0, dot)).slice(0, MAX_WHOLE_DIGITS);
  if (dot < 0) return whole;
  return `${whole || '0'}.${s
    .slice(dot + 1)
    .replace(/\./g, '')
    .slice(0, 2)}`;
}

/**
 * Parses a user-typed amount ("1,500", "١٥٠٠٫٥", "1500.25") into halalas.
 * Returns null for anything that is not a non-negative amount with at most two
 * decimals, so callers can surface a clear validation error.
 */
export function parseAmount(input: string): number | null {
  const s = normalizeDigits(input.trim());
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const halalas = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(halalas) || halalas > 100_000_000_000) return null;
  return halalas;
}

/** Formats halalas as "5,000" or "5,000.50" (Western digits, thousands separators). */
export function formatAmount(halalas: number): string {
  const abs = Math.abs(halalas);
  const riyals = Math.floor(abs / 100);
  const rest = abs % 100;
  const base = riyals.toLocaleString('en-US');
  const text = rest ? `${base}.${String(rest).padStart(2, '0')}` : base;
  return halalas < 0 ? `-${text}` : text;
}

export type BalanceSide = 'lah' | 'alayh' | 'settled';

/** Positive balance = له (we owe the supplier), negative = عليه. */
export function balanceSide(halalas: number): BalanceSide {
  if (halalas > 0) return 'lah';
  if (halalas < 0) return 'alayh';
  return 'settled';
}

export const SIDE_LABEL: Record<BalanceSide, string> = {
  lah: 'له',
  alayh: 'عليه',
  settled: 'مُسوّى',
};
