import { normalizeDigits } from '../../../shared/lib/money';

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

export function validateAccountForm(v: AccountForm): Partial<Record<keyof AccountForm, string>> {
  const errors: Partial<Record<keyof AccountForm, string>> = {};
  const name = v.name.trim();
  if (!name) errors.name = 'أدخل اسم الحساب.';
  else if (name.length > 120) errors.name = 'الاسم أطول من 120 حرفاً.';
  const phone = cleanPhone(v.phone);
  if (phone.length > 20) errors.phone = 'رقم الجوال طويل جداً.';
  else if (phone && !/^\+?\d{6,15}$/.test(phone)) errors.phone = 'رقم الجوال غير صحيح.';
  return errors;
}

export function initialOf(name: string): string {
  return [...name.trim()][0] ?? '؟';
}
