import { normalizeDigits } from '../../../shared/lib/money';
import { toLocalMobile } from '../../../shared/lib/phone';

export type AccountGroup = 'suppliers' | 'customers' | 'general';

/** accounts/{id} */
export interface Account {
  id: string;
  name: string;
  phone: string;
  group: AccountGroup;
  /** Raw logo bytes (webp/jpeg/png), ≤ 80 KB. */
  logo: Uint8Array | null;
  deleted: boolean;
  /** Hidden from the daily list (owner decision 2026-10-07); data stays. */
  archived: boolean;
}

export const GROUP_LABEL: Record<AccountGroup, string> = {
  suppliers: 'موردون',
  customers: 'عملاء',
  general: 'عام',
};

export const LOGO_MAX_BYTES = 81_920;

export interface AccountForm {
  name: string;
  phone: string;
  group: AccountGroup;
}

export function cleanPhone(raw: string): string {
  return normalizeDigits(raw).replace(/[^\d+]/g, '');
}

/** What is stored: 05XXXXXXXX, or '' when no number was given. */
export function storedPhone(raw: string): string {
  return toLocalMobile(cleanPhone(raw)) ?? '';
}

export function validateAccountForm(v: AccountForm): Partial<Record<keyof AccountForm, string>> {
  const errors: Partial<Record<keyof AccountForm, string>> = {};
  const name = v.name.trim();
  if (!name) errors.name = 'أدخل اسم الحساب.';
  else if (name.length > 120) errors.name = 'الاسم أطول من 120 حرفاً.';
  // Owner decision: a number WhatsApp cannot use is never saved.
  const phone = cleanPhone(v.phone);
  if (phone && !toLocalMobile(phone))
    errors.phone = 'رقم الجوال غير صحيح. اكتبه جوالاً سعودياً من 10 أرقام: 05XXXXXXXX.';
  return errors;
}

export function initialOf(name: string): string {
  return [...name.trim()][0] ?? '؟';
}
