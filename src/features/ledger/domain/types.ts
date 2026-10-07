import type { Timestamp } from 'firebase/firestore';

export type EntryType = 'invoice' | 'payment' | 'note';

export interface Signature {
  name: string;
  /** data:image/png;base64,… (≤ 60 KB) */
  image: string;
  signedAt: Timestamp;
}

/** accounts/{accountId}/entries/{entryId} */
export interface Entry {
  id: string;
  type: EntryType;
  /** Halalas, always ≥ 0. Zero only for notes. */
  amount: number;
  /** +amount for invoices (له), −amount for payments (عليه), 0 for notes. */
  signed: number;
  /** 'YYYY-MM-DD' */
  date: string;
  details: string;
  attachments: string[];
  voucherNo?: number;
  signLinkId?: string;
  signature?: Signature;
  deleted: boolean;
  legacyId?: number;
  createdAt: Timestamp;
  createdBy: string;
}

export const ENTRY_LABEL: Record<EntryType, string> = {
  invoice: 'فاتورة',
  payment: 'دفعة',
  note: 'ملاحظة',
};

export function signedAmount(type: EntryType, amount: number): number {
  if (type === 'invoice') return amount;
  if (type === 'payment') return -amount;
  return 0;
}
