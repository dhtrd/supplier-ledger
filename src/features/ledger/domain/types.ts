import { isIsoDate } from '../../../shared/lib/dates';
import { parseAmount } from '../../../shared/lib/money';
import type { StatementInput } from './statement';

export type EntryType = 'invoice' | 'payment' | 'note';

export interface Signature {
  name: string;
  /** data:image/png;base64,… (≤ 60 KB) */
  image: string;
  signedAtMs: number;
}

/** accounts/{accountId}/entries/{entryId}, as the UI sees it. */
export interface Entry extends StatementInput {
  type: EntryType;
  details: string;
  /** Ids of accounts/{accountId}/attachments docs. */
  attachments: string[];
  voucherNo: number | null;
  signature: Signature | null;
  createdBy: string;
  /** Migrated from the old «دفتر الحسابات» app (or an imported statement). */
  legacy: boolean;
  /** A payment that is really a supplier return or an earned discount. */
  subtype: PaymentSubtype | null;
}

export type PaymentSubtype = 'return' | 'discount';

export const SUBTYPE_LABEL: Record<PaymentSubtype, string> = {
  return: 'مرتجع',
  discount: 'خصم',
};

/** Label shown for an entry: «مرتجع» / «خصم» replace «دفعة» when marked. */
export function entryLabel(e: Pick<Entry, 'type' | 'subtype'>): string {
  return e.subtype ? SUBTYPE_LABEL[e.subtype] : ENTRY_LABEL[e.type];
}

/** Returns/discounts are not cash handed over: no signing link, no payment voucher. */
export function isCashPayment(e: Pick<Entry, 'type' | 'subtype'>): boolean {
  return e.type === 'payment' && e.subtype === null;
}

export const ENTRY_LABEL: Record<EntryType, string> = {
  invoice: 'فاتورة',
  payment: 'دفعة',
  note: 'ملاحظة',
};

export const MAX_DETAILS = 500;
export const MAX_ATTACHMENTS = 5;

export function signedAmount(type: EntryType, amount: number): number {
  if (type === 'invoice') return amount;
  if (type === 'payment') return -amount;
  return 0;
}

export interface EntryFormInput {
  type: EntryType;
  amountText: string;
  date: string;
  details: string;
  attachmentCount: number;
}

export type EntryFormResult =
  | { ok: true; amount: number; signed: number; date: string; details: string }
  | { ok: false; errors: Partial<Record<'amount' | 'date' | 'details' | 'attachments', string>> };

/** Validates the add/edit form exactly as firestore.rules will. */
export function validateEntryForm(v: EntryFormInput): EntryFormResult {
  const errors: Partial<Record<'amount' | 'date' | 'details' | 'attachments', string>> = {};
  let amount = 0;
  if (v.type !== 'note') {
    const parsed = parseAmount(v.amountText);
    if (parsed === null) errors.amount = 'أدخل مبلغاً صحيحاً (بحد أقصى خانتين عشريتين).';
    else if (parsed <= 0) errors.amount = 'أدخل مبلغاً أكبر من صفر.';
    else amount = parsed;
  }
  if (!isIsoDate(v.date)) errors.date = 'اختر تاريخاً صحيحاً.';
  const details = v.details.trim();
  if (details.length > MAX_DETAILS) errors.details = `التفاصيل أطول من ${MAX_DETAILS} حرف.`;
  if (v.type === 'note' && !details) errors.details = 'اكتب نص الملاحظة.';
  if (v.attachmentCount > MAX_ATTACHMENTS)
    errors.attachments = `الحد ${MAX_ATTACHMENTS} صور لكل عملية.`;
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, amount, signed: signedAmount(v.type, amount), date: v.date, details };
}

/** Signed vouchers are frozen: no edit, no delete (also enforced by the rules). */
export function isLocked(e: Pick<Entry, 'signature'>): boolean {
  return e.signature !== null;
}
