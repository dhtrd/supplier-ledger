/**
 * Pure mapping from the old «دفتر الحسابات» SQLite backup to the new model.
 * Decisions (DECISIONS.md, 2026-10-07): import AS-IS — every account kept
 * separately, empty phones stay empty, zero-amount rows become notes, deleted
 * rows (transactions_d / customers_d) are not imported, images are not
 * imported. Legacy payments keep their old id as voucher number.
 */

export interface LegacyCustomer {
  ID: number;
  name: string;
  gsm: string | null;
  g_id: number;
}

export interface LegacyTransaction {
  ID: number;
  cus_id: number;
  in: string; // '1' = invoice (له), '-1' = payment (عليه)
  out: string; // amount in riyals, e.g. '4160' or '700.0'
  date_: string; // 'dd-mm-yyyy'
  remarks: string | null;
  now_: string | null; // 'yyyy-mm-dd' — when it was entered
  param2: string | null; // 'HH:MM' — when it was entered
}

export interface NewAccount {
  id: string;
  name: string;
  phone: string;
  group: 'suppliers' | 'customers' | 'general';
  legacyId: number;
}

export interface NewEntry {
  id: string;
  accountId: string;
  type: 'invoice' | 'payment' | 'note';
  amount: number; // halalas
  signed: number;
  date: string; // YYYY-MM-DD
  details: string;
  voucherNo?: number;
  legacyId: number;
  /** ms since epoch; strictly increasing in legacy-id order (same-day order). */
  createdAtMs: number;
}

// Old groups: 0 = عام, 1 = موردين, 2 = عملاء
const GROUPS: Record<number, NewAccount['group']> = {
  0: 'general',
  1: 'suppliers',
  2: 'customers',
};

export const accountId = (legacyId: number) => `L${legacyId}`;
export const entryId = (legacyId: number) => `L${legacyId}`;

export function toIsoDate(ddmmyyyy: string): string {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(ddmmyyyy.trim());
  if (!m) throw new Error(`Bad legacy date: ${ddmmyyyy}`);
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso)
    throw new Error(`Bad legacy date: ${ddmmyyyy}`);
  return iso;
}

export function toHalalas(out: string): number {
  const s = String(out).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Bad legacy amount: ${out}`);
  const h = Math.round(Number(s) * 100);
  if (!Number.isSafeInteger(h)) throw new Error(`Bad legacy amount: ${out}`);
  return h;
}

/** Riyadh-local entry time → epoch ms (fallback: midnight of the entry day). */
function enteredAtMs(t: LegacyTransaction): number {
  const day = t.now_ && /^\d{4}-\d{2}-\d{2}$/.test(t.now_) ? t.now_ : toIsoDate(t.date_);
  const time = t.param2 && /^\d{2}:\d{2}$/.test(t.param2) ? t.param2 : '00:00';
  return Date.parse(`${day}T${time}:00+03:00`);
}

export function mapAccounts(rows: LegacyCustomer[]): NewAccount[] {
  return rows
    .slice()
    .sort((a, b) => a.ID - b.ID)
    .map((c) => {
      const group = GROUPS[c.g_id];
      if (!group) throw new Error(`Unknown legacy group ${c.g_id} for customer ${c.ID}`);
      return {
        id: accountId(c.ID),
        name: c.name.trim(),
        phone: (c.gsm ?? '').trim(),
        group,
        legacyId: c.ID,
      };
    });
}

export function mapEntries(rows: LegacyTransaction[], knownAccounts: Set<number>): NewEntry[] {
  let lastMs = 0;
  return rows
    .slice()
    .sort((a, b) => a.ID - b.ID)
    .map((t) => {
      if (!knownAccounts.has(t.cus_id))
        throw new Error(`Transaction ${t.ID} points to unknown account ${t.cus_id}`);
      const amount = toHalalas(t.out);
      const sign = String(t.in).trim();
      if (sign !== '1' && sign !== '-1')
        throw new Error(`Transaction ${t.ID} has unknown direction ${t.in}`);
      const type: NewEntry['type'] = amount === 0 ? 'note' : sign === '1' ? 'invoice' : 'payment';
      const signed = type === 'invoice' ? amount : type === 'payment' ? -amount : 0;
      // Keep original entry order: strictly increasing timestamps by legacy id.
      const ms = Math.max(enteredAtMs(t), lastMs + 1);
      lastMs = ms;
      const entry: NewEntry = {
        id: entryId(t.ID),
        accountId: accountId(t.cus_id),
        type,
        amount,
        signed,
        date: toIsoDate(t.date_),
        details: (t.remarks ?? '').trim(),
        legacyId: t.ID,
        createdAtMs: ms,
      };
      if (type === 'payment') entry.voucherNo = t.ID;
      return entry;
    });
}

/** Per-account balances in halalas — used to verify the import. */
export function balancesByAccount(entries: NewEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) m.set(e.accountId, (m.get(e.accountId) ?? 0) + e.signed);
  return m;
}
