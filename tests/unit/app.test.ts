import { describe, expect, it } from 'vitest';
import { readConfig } from '../../src/core/config';
import { cleanPhone, validateAccountForm } from '../../src/features/accounts/domain/types';
import { buildStatement, fullRange } from '../../src/features/ledger/domain/statement';
import { isLocked, validateEntryForm, type Entry } from '../../src/features/ledger/domain/types';
import { statementFileName, statementSheet } from '../../src/features/ledger/export/statementSheet';
import { signStateOf } from '../../src/features/ledger/ui/signState';
import type { SignLink } from '../../src/features/signing/data/signLinksRepo';
import {
  ageLabel,
  backupState,
  DEFAULT_SETTINGS,
  validateSettings,
} from '../../src/features/settings/domain/types';
import { can, validateUserForm, type UserProfile } from '../../src/features/users/domain/types';

const entry = (p: Partial<Entry>): Entry => ({
  id: 'e1',
  type: 'invoice',
  amount: 100,
  signed: 100,
  date: '2026-09-01',
  order: 1,
  deleted: false,
  details: '',
  attachments: [],
  voucherNo: null,
  signature: null,
  createdBy: 'u',
  legacy: false,
  subtype: null,
  ...p,
});

describe('config', () => {
  it('lists every missing Firebase variable', () => {
    const r = readConfig({ VITE_FIREBASE_API_KEY: 'k', VITE_FIREBASE_PROJECT_ID: ' ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toHaveLength(4);
  });
  it('accepts a full config', () => {
    const r = readConfig({
      VITE_FIREBASE_API_KEY: 'k',
      VITE_FIREBASE_AUTH_DOMAIN: 'd',
      VITE_FIREBASE_PROJECT_ID: 'p',
      VITE_FIREBASE_APP_ID: 'a',
      VITE_FIREBASE_MESSAGING_SENDER_ID: 's',
    });
    expect(r.ok && r.config.projectId).toBe('p');
  });
});

describe('entry form validation (mirrors the rules)', () => {
  const base = {
    type: 'invoice' as const,
    amountText: '1,500.5',
    date: '2026-10-07',
    details: ' x ',
    attachmentCount: 0,
  };
  it('parses and signs amounts by type', () => {
    expect(validateEntryForm(base)).toEqual({
      ok: true,
      amount: 150050,
      signed: 150050,
      date: '2026-10-07',
      details: 'x',
    });
    const p = validateEntryForm({ ...base, type: 'payment', amountText: '٥٠٠' });
    expect(p.ok && p.signed).toBe(-50000);
  });
  it('notes have no amount but need text', () => {
    expect(
      validateEntryForm({ ...base, type: 'note', amountText: 'abc', details: 'ملاحظة' }),
    ).toMatchObject({ ok: true, amount: 0, signed: 0 });
    expect(validateEntryForm({ ...base, type: 'note', details: '' }).ok).toBe(false);
  });
  it('rejects zero, bad dates, long text and too many images', () => {
    const r = validateEntryForm({
      type: 'payment',
      amountText: '0',
      date: '2026-02-30',
      details: 'x'.repeat(501),
      attachmentCount: 6,
    });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(Object.keys(r.errors).sort()).toEqual(['amount', 'attachments', 'date', 'details']);
  });
  it('signed vouchers are locked', () => {
    expect(isLocked(entry({}))).toBe(false);
    expect(isLocked(entry({ signature: { name: 'a', image: '', signedAtMs: 1 } }))).toBe(true);
  });
});

describe('accounts / users / settings validation', () => {
  it('validates account names and phones', () => {
    expect(validateAccountForm({ name: ' ', phone: '', group: 'general' })).toHaveProperty('name');
    expect(validateAccountForm({ name: 'مورد', phone: '٠٥٥٧٤٧٠٤٤٢', group: 'suppliers' })).toEqual(
      {},
    );
    expect(validateAccountForm({ name: 'مورد', phone: '12', group: 'suppliers' })).toHaveProperty(
      'phone',
    );
    expect(cleanPhone('٠٥٥ ٧٤٧-٠٤٤٢')).toBe('0557470442');
  });
  it('validates users', () => {
    expect(validateUserForm({ name: 'أ', email: 'a@b.co' })).toEqual({});
    expect(Object.keys(validateUserForm({ name: '', email: 'nope' })).sort()).toEqual([
      'email',
      'name',
    ]);
  });
  it('mirrors role permissions: owner protected, no self-edit, entry isolation', () => {
    const u = (id: string, role: UserProfile['role'], assigned: string[] = []): UserProfile => ({
      id,
      name: id,
      email: '',
      role,
      active: true,
      assignedAccounts: assigned,
    });
    const owner = u('o', 'owner');
    const admin = u('a', 'admin');
    const entryUser = u('e', 'entry', ['acc1']);
    expect(can.editUser(admin, owner)).toBe(false);
    expect(can.editUser(admin, admin)).toBe(false);
    expect(can.editUser(admin, entryUser)).toBe(true);
    expect(can.editUser(owner, admin)).toBe(true);
    expect(can.editSettings('admin')).toBe(false);
    expect(can.manageAccounts('entry')).toBe(false);
    expect(can.accessAccount(entryUser, 'acc2')).toBe(false);
    expect(can.accessAccount(admin, 'acc2')).toBe(true);
  });
  it('validates settings bounds', () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toBeNull();
    expect(validateSettings({ ...DEFAULT_SETTINGS, linkMinutes: 4 })).not.toBeNull();
    expect(validateSettings({ ...DEFAULT_SETTINGS, linkMinutes: 1441 })).not.toBeNull();
    expect(
      validateSettings({
        ...DEFAULT_SETTINGS,
        roleLabels: { ...DEFAULT_SETTINGS.roleLabels, admin: ' ' },
      }),
    ).not.toBeNull();
  });
  it('flags a backup older than 26 hours', () => {
    const h = 3_600_000;
    expect(backupState(null, 0)).toBe('none');
    expect(backupState(0, 25 * h)).toBe('ok');
    expect(backupState(0, 27 * h)).toBe('late');
    expect(ageLabel(31 * h)).toBe('31 ساعة');
    expect(ageLabel(3 * h)).toBe('3 ساعات');
  });
});

describe('statement range and export', () => {
  const rows = [
    entry({ id: 'a', date: '2026-08-01', amount: 560000, signed: 560000, order: 1 }),
    entry({
      id: 'b',
      type: 'payment',
      date: '2026-09-15',
      amount: 500000,
      signed: -500000,
      order: 2,
      voucherNo: 1335,
      details: 'دفعه',
    }),
    entry({ id: 'c', date: '2026-11-01', amount: 100, signed: 100, order: 3, deleted: true }),
  ];
  it('full range spans the first entry to the later of today and the last entry', () => {
    expect(fullRange(rows, '2026-10-07')).toEqual({ from: '2026-08-01', to: '2026-10-07' });
    expect(fullRange([], '2026-10-07')).toEqual({ from: '2026-10-07', to: '2026-10-07' });
  });
  it('excel sheet: opening row first, oldest first, totals last', () => {
    const s = buildStatement(rows, { from: '2026-09-01', to: '2026-09-30' });
    const sheet = statementSheet('مفروشات', s);
    const opening = sheet[4]!;
    expect(opening[1]).toMatchObject({ value: 'رصيد افتتاحي' });
    expect(opening[6]).toMatchObject({ value: 5600 });
    expect(opening[7]).toBe('له');
    const pay = sheet[5]!;
    expect(pay.slice(0, 4)).toEqual(['2026/09/15', 'دفعة', { value: 1335, type: Number }, 'دفعه']);
    expect(pay[5]).toMatchObject({ value: 5000 });
    expect(pay[6]).toMatchObject({ value: 600 });
    const total = sheet.at(-1)!;
    expect(total[5]).toMatchObject({ value: 5000 });
    expect(statementFileName('a/b:c', s)).toBe('كشف a b c 2026-09-01 - 2026-09-30.xlsx');
  });
});

describe('signing state of a payment', () => {
  const link = (p: Partial<SignLink>): SignLink => ({
    id: 'l',
    accountId: 'acc',
    entryId: 'p1',
    accountName: '',
    accountPhone: '',
    logo: null,
    payerName: '',
    amount: 1,
    amountWords: '',
    date: '',
    details: '',
    voucherNo: 1,
    ttlMinutes: 60,
    status: 'pending',
    synced: false,
    createdAtMs: 0,
    signerName: '',
    signatureImage: '',
    signedAtMs: 0,
    signedAtRaw: null,
    ...p,
  });
  const pay = entry({ id: 'p1', type: 'payment', signed: -1 });
  it('counts down a live link and ignores expired ones', () => {
    expect(signStateOf(pay, [link({})], 30 * 60_000)).toMatchObject({
      kind: 'pending',
      minutesLeft: 30,
    });
    expect(signStateOf(pay, [link({})], 61 * 60_000).kind).toBe('none');
    expect(signStateOf(pay, [link({ entryId: 'other' })], 0).kind).toBe('none');
  });
  it('a signed link or entry signature means signed; invoices never sign', () => {
    expect(signStateOf(pay, [link({ status: 'signed' })], 0).kind).toBe('signed');
    expect(
      signStateOf({ ...pay, signature: { name: 'x', image: '', signedAtMs: 1 } }, [], 0).kind,
    ).toBe('signed');
    expect(signStateOf(entry({}), [link({ entryId: 'e1' })], 0).kind).toBe('none');
  });
});
