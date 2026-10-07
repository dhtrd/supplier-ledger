import { displayDate } from '../../../shared/lib/dates';
import { formatAmount } from '../../../shared/lib/money';
import { entryLabel, type Entry } from '../../ledger/domain/types';

/** notifications/{auditId} — what the owner and managers are told about. */
export type NotificationKind = 'signedEdit' | 'invoiceEdit' | 'delete' | 'restore';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  accountId: string;
  entryId: string;
  accountName: string;
  /** e.g. «دفعة #1489» or «فاتورة». */
  title: string;
  /** Human lines «المبلغ: 1,000 ← 1,100». */
  changes: string[];
  actor: string;
  actorName: string;
  atMs: number;
  readBy: string[];
}

export const KIND_LABEL: Record<NotificationKind, string> = {
  signedEdit: 'عُدّل سند موقّع وأُلغي توقيعه',
  invoiceEdit: 'عُدّلت فاتورة',
  delete: 'نُقلت إلى سلة المهملات',
  restore: 'استُرجعت من سلة المهملات',
};

export const MAX_CHANGE_LINES = 8;
const LINE_MAX = 200;

/** Which edits notify the managers (owner decision 2026-10-07). */
export function editKind(
  e: Pick<Entry, 'type' | 'signature'>,
): 'signedEdit' | 'invoiceEdit' | null {
  if (e.signature) return 'signedEdit';
  if (e.type === 'invoice') return 'invoiceEdit';
  return null;
}

export function entryTitle(e: Pick<Entry, 'type' | 'subtype' | 'voucherNo'>): string {
  return e.voucherNo != null ? `${entryLabel(e)} #${e.voucherNo}` : entryLabel(e);
}

export interface EditableFields {
  amount: number;
  date: string;
  details: string;
  attachments: number;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const detailsText = (s: string) => (s.trim() ? `«${clip(s.trim(), 60)}»` : '(فارغ)');

/** The changed fields as «field: before ← after» lines (empty = nothing changed). */
export function describeChanges(
  type: Entry['type'],
  before: EditableFields,
  after: EditableFields,
): string[] {
  const out: string[] = [];
  if (type !== 'note' && before.amount !== after.amount)
    out.push(`المبلغ: ${formatAmount(before.amount)} ← ${formatAmount(after.amount)}`);
  if (before.date !== after.date)
    out.push(`التاريخ: ${displayDate(before.date)} ← ${displayDate(after.date)}`);
  if (before.details.trim() !== after.details.trim())
    out.push(`التفاصيل: ${detailsText(before.details)} ← ${detailsText(after.details)}`);
  if (before.attachments !== after.attachments)
    out.push(`الصور: ${before.attachments} ← ${after.attachments}`);
  return out.map((l) => clip(l, LINE_MAX)).slice(0, MAX_CHANGE_LINES);
}

/** One-line summary of an entry for delete/restore notifications. */
export function entrySummary(e: Pick<Entry, 'type' | 'amount' | 'date' | 'signature'>): string[] {
  const lines = [`التاريخ: ${displayDate(e.date)}`];
  if (e.type !== 'note') lines.unshift(`المبلغ: ${formatAmount(e.amount)}`);
  if (e.signature) lines.push(`موقّع من: ${clip(e.signature.name, 80)}`);
  return lines;
}

/** The actor never sees his own notifications. */
export function visibleTo<T extends Pick<AppNotification, 'actor'>>(
  list: readonly T[],
  uid: string,
): T[] {
  return list.filter((n) => n.actor !== uid);
}

export function isUnread(n: Pick<AppNotification, 'actor' | 'readBy'>, uid: string): boolean {
  return n.actor !== uid && !n.readBy.includes(uid);
}
