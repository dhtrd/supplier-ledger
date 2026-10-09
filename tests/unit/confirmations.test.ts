import { describe, expect, it } from 'vitest';
import {
  balanceAt,
  confirmLabel,
  confirmLinkMessage,
  confirmStatus,
  letterParts,
  letterText,
  movesConfirmed,
  signerSide,
} from '../../src/features/confirmations/domain/confirmation';
import { validateEntryForm } from '../../src/features/ledger/domain/types';
import { describeChanges, entryTitle } from '../../src/features/notifications/domain/notification';

const rows = [
  { date: '2026-09-01', signed: 100000, deleted: false },
  { date: '2026-09-02', signed: -50000, deleted: false },
  { date: '2026-09-02', signed: -1000, deleted: true },
  { date: '2026-10-01', signed: 7000, deleted: false },
];

describe('balance up to a date', () => {
  it('includes the whole day and skips the trash', () => {
    expect(balanceAt(rows, '2026-08-31')).toBe(0);
    expect(balanceAt(rows, '2026-09-02')).toBe(50000);
    expect(balanceAt(rows, '2026-09-30')).toBe(50000);
    expect(balanceAt(rows, '2026-10-01')).toBe(57000);
  });
  it('flags a confirmation whose period changed', () => {
    expect(confirmStatus(50000, '2026-09-30', rows)).toEqual({ changed: false, current: 50000 });
    expect(confirmStatus(40000, '2026-09-30', rows)).toEqual({ changed: true, current: 50000 });
  });
});

describe('letter wording (form «٢»)', () => {
  const base = { accountName: 'بدر زين', payerName: 'شركة الضبيبي', date: '2026-09-30' };
  it('speaks from the signer side', () => {
    expect(signerSide(1)).toBe('لصالحنا');
    expect(signerSide(-1)).toBe('علينا');
    expect(signerSide(0)).toBeNull();
    const p = letterParts({ ...base, balance: 266000 });
    expect([p.amount, p.words, p.side]).toEqual([
      '2,660 ر.س',
      'ألفان وستمائة وستون ريال سعودي لا غير',
      'لصالحنا',
    ]);
    expect(letterText({ ...base, balance: -5000 })).toContain('50 ر.س');
    expect(letterText({ ...base, balance: -5000 })).toContain('علينا');
  });
  it('a settled account says so', () => {
    const p = letterParts({ ...base, balance: 0 });
    expect(p.amount).toBeNull();
    expect(p.closing).toContain('مسدَّد');
  });
  it('WhatsApp text and number label', () => {
    expect(confirmLabel(3)).toBe('م-3');
    const m = confirmLinkMessage({
      payerName: 'شركة الضبيبي',
      confirmNo: 3,
      accountName: 'بدر زين',
      balance: 266000,
      date: '2026-09-30',
      minutes: 60,
      url: 'https://x/#/s/t',
    });
    expect(m.split('\n')).toEqual([
      'إقرار مطابقة رصيد من شركة الضبيبي',
      'رقم الإقرار: م-3',
      'رصيد حسابكم حتى 2026/09/30: 2,660 ريال لصالحنا',
      'للمراجعة والتوقيع بالإقرار (الرابط صالح 60 دقيقة ولمرة واحدة):',
      'https://x/#/s/t',
    ]);
  });
});

describe('which changes touch a signed confirmation (mirrors the rules)', () => {
  const t = '2026-09-30';
  it('create / trash / restore', () => {
    expect(movesConfirmed(null, { signed: 5, date: '2026-09-15' }, t)).toBe(true);
    expect(movesConfirmed(null, { signed: 5, date: '2026-10-01' }, t)).toBe(false);
    expect(movesConfirmed(null, { signed: 0, date: '2026-09-15' }, t)).toBe(false);
    expect(movesConfirmed({ signed: 5, date: '2026-09-15' }, null, t)).toBe(true);
    expect(movesConfirmed({ signed: 5, date: '2026-09-15' }, null, '')).toBe(false);
  });
  it('edits', () => {
    const o = { signed: -500, date: '2026-09-02' };
    expect(movesConfirmed(o, { ...o }, t)).toBe(false);
    expect(movesConfirmed(o, { ...o, signed: -600 }, t)).toBe(true);
    expect(movesConfirmed(o, { ...o, date: '2026-10-05' }, t)).toBe(true);
    expect(
      movesConfirmed({ signed: 1, date: '2026-10-02' }, { signed: 2, date: '2026-10-03' }, t),
    ).toBe(false);
  });
});

describe('form and notifications for confirmations', () => {
  it('no amount, details optional, never in the future', () => {
    const ok = validateEntryForm({
      type: 'confirm',
      amountText: '',
      date: '2026-09-30',
      details: '',
      attachmentCount: 0,
      today: '2026-10-09',
    });
    expect(ok).toEqual({ ok: true, amount: 0, signed: 0, date: '2026-09-30', details: '' });
    const future = validateEntryForm({
      type: 'confirm',
      amountText: '',
      date: '2026-10-10',
      details: '',
      attachmentCount: 0,
      today: '2026-10-09',
    });
    expect(future.ok).toBe(false);
  });
  it('title «إقرار مطابقة م-3» and the stated balance as a change line', () => {
    expect(entryTitle({ type: 'confirm', subtype: null, voucherNo: null, confirmNo: 3 })).toBe(
      'إقرار مطابقة م-3',
    );
    const f = { amount: 0, date: '2026-09-30', details: '', attachments: 0 };
    expect(
      describeChanges('confirm', { ...f, confirmBalance: 266000 }, { ...f, confirmBalance: -5000 }),
    ).toEqual(['الرصيد المُقرّ به: 2,660 له ← 50 عليه']);
  });
});
