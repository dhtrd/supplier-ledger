import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Bytes, Timestamp } from 'firebase/firestore';
import { idlePhase } from '../../src/core/idle';
import {
  effectiveFails,
  emailKey,
  isLocked,
  minutesUntilUnlock,
  remainingAttempts,
} from '../../src/features/auth/domain/lockout';
import { encodeValue } from '../../src/features/backup/domain/snapshot';
import {
  balanceAfter,
  buildStatement,
  latestEntries,
} from '../../src/features/ledger/domain/statement';
import {
  daysAhead,
  entryLabel,
  isCashPayment,
  isFarFuture,
  type Entry,
} from '../../src/features/ledger/domain/types';
import { statementSheet } from '../../src/features/ledger/export/statementSheet';
import { DEFAULT_SETTINGS, validateSettings } from '../../src/features/settings/domain/types';
import { can, validatePassword } from '../../src/features/users/domain/types';
import { decryptText, encryptText, isEnvelope } from '../../src/shared/lib/backupCrypto';
import { IMAGE_ACCEPT, isApprovedImage, isHeicFile } from '../../src/shared/lib/imageFormats';
import { expiredBackupFolders, rawLink } from '../../scripts/lib/dropbox';
import { parseLedgerSheet, verifyAgainstSheet } from '../../scripts/import/excelLedger';
import { decode } from '../../scripts/backup/snapshot';
import {
  nextTotals,
  readTotals,
  totalsOf,
  ZERO_TOTALS,
} from '../../src/features/accounts/domain/totals';
import {
  archiveCandidates,
  daysBetween,
  needsLastMovement,
  type ArchiveCandidateInput,
} from '../../src/features/accounts/domain/archive';
import {
  describeChanges,
  editKind,
  isUnread,
  visibleTo,
} from '../../src/features/notifications/domain/notification';

const entry = (p: Partial<Entry>): Entry => ({
  confirmNo: null,
  confirmBalance: null,
  id: 'e',
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

describe('password policy (≥10, letters + digits)', () => {
  it.each([
    ['short1a', false],
    ['onlyletters', false],
    ['1234567890', false],
    ['١٢٣٤٥٦٧٨٩٠', false],
    ['has space 12', false],
    ['GoodPass2026', true],
    ['كلمةمرور2026', true],
  ])('%s → %s', (p, ok) => {
    expect(validatePassword(p) === null).toBe(ok);
  });
});

describe('lockout key', () => {
  it('is the hex SHA-256 of the lower-cased email (same as the rules)', async () => {
    const want = createHash('sha256').update('owner+x@example.com').digest('hex');
    expect(await emailKey('  Owner+X@Example.com ')).toBe(want);
  });
  it('locks at 5 failures', () => {
    expect(isLocked(4)).toBe(false);
    expect(isLocked(5)).toBe(true);
    expect(remainingAttempts(3)).toBe(2);
    expect(remainingAttempts(9)).toBe(0);
  });
});

describe('idle timer', () => {
  it('active → warning countdown → expired', () => {
    expect(idlePhase(29 * 60_000, 30, 10)).toEqual({ kind: 'active' });
    expect(idlePhase(30 * 60_000, 30, 10)).toEqual({ kind: 'warning', secondsLeft: 10 });
    expect(idlePhase(30 * 60_000 + 9_500, 30, 10)).toEqual({ kind: 'warning', secondsLeft: 1 });
    expect(idlePhase(30 * 60_000 + 10_000, 30, 10)).toEqual({ kind: 'expired' });
    expect(idlePhase(5 * 3_600_000, 30, 10)).toEqual({ kind: 'expired' });
  });
  it('owner settings stay within bounds', () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, idleMinutes: 0 })).not.toBeNull();
    expect(validateSettings({ ...DEFAULT_SETTINGS, idleMinutes: 241 })).not.toBeNull();
    expect(validateSettings({ ...DEFAULT_SETTINGS, idleCountdownSeconds: 4 })).not.toBeNull();
    expect(validateSettings({ ...DEFAULT_SETTINGS, idleCountdownSeconds: 121 })).not.toBeNull();
    expect(DEFAULT_SETTINGS.idleMinutes).toBe(30);
    expect(DEFAULT_SETTINGS.idleCountdownSeconds).toBe(10);
  });
});

describe('returns / discounts and hidden balances', () => {
  it('labels and cash rules', () => {
    const ret = entry({ type: 'payment', subtype: 'return', signed: -100 });
    expect(entryLabel(ret)).toBe('مرتجع');
    expect(entryLabel(entry({ type: 'payment', subtype: 'discount' }))).toBe('خصم');
    expect(entryLabel(entry({ type: 'payment' }))).toBe('دفعة');
    expect(isCashPayment(ret)).toBe(false);
    expect(isCashPayment(entry({ type: 'payment' }))).toBe(true);
    expect(isCashPayment(entry({}))).toBe(false);
  });
  it('data-entry users do not see balances; managers do', () => {
    expect(can.seeBalances('entry')).toBe(true);
    expect(can.seeBalances('admin')).toBe(true);
    expect(can.backupNow('admin')).toBe(true);
    expect(can.backupNow('entry')).toBe(false);
  });
  it('Excel without balances drops the opening row and balance columns', () => {
    const s = buildStatement(
      [
        entry({ id: 'a', date: '2026-08-01', amount: 500, signed: 500 }),
        entry({
          id: 'b',
          type: 'payment',
          subtype: 'return',
          date: '2026-09-02',
          amount: 100,
          signed: -100,
          order: 2,
        }),
      ],
      { from: '2026-09-01', to: '2026-09-30' },
    );
    const sheet = statementSheet('x', s, { balances: false });
    expect(sheet[3]).toHaveLength(6);
    expect(sheet[4]![1]).toBe('مرتجع');
    expect(sheet[4]).toHaveLength(6);
    expect(sheet.at(-1)).toHaveLength(6);
  });
});

describe('Excel statement import', () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  const rows: unknown[][] = [
    ['كشف حساب', null, null, 'بدر زين'],
    [null, null, null, 'أرصدة المورد', 1179, 2010, -831],
    ['م', 'التاريخ', 'رقم السند', 'التفاصيل', 'دفعات', 'فواتير', 'الرصيد'],
    [1, d('2025-10-22'), 0, 'رصيد افتتاحي', null, 610, -610],
    [2, d('2025-10-25'), 351, ' فاتورة  مشتريات ', null, 1400, -2010],
    [3, d('2025-10-25'), 4440, 'دفعة من الحساب', 1000, null, -1010],
    [4, d('2025-11-16'), 370, 'فاتورة مرتجع - العز', 150, null, -860],
    [5, d('2025-12-27'), 0, 'اخر مطابقة', 0, 0, -860],
    [6, d('2026-03-18'), 0, 'خصم مكتسب', 29, null, -831],
    [null, null, null, null, null, null, null],
  ];
  it('maps types, marks returns/discounts, keeps numbers in details', () => {
    const p = parseLedgerSheet(rows);
    expect(p.entries.map((e) => [e.type, e.subtype])).toEqual([
      ['invoice', null],
      ['invoice', null],
      ['payment', null],
      ['payment', 'return'],
      ['note', null],
      ['payment', 'discount'],
    ]);
    expect(p.entries[1]!.details).toBe('فاتورة مشتريات — رقم 351');
    expect(p.entries[2]!.details).toBe('دفعة من الحساب — رقم سابق 4440');
    expect(p.entries[0]!.date).toBe('2025-10-22');
    expect(p.balance).toBe(83100);
    expect(() => verifyAgainstSheet(p)).not.toThrow();
  });
  it('refuses a sheet whose own totals do not match', () => {
    const bad = rows.map((r) => [...r]);
    bad[1]![5] = 2011;
    expect(() => verifyAgainstSheet(parseLedgerSheet(bad))).toThrow(/Invoice total/);
  });
  it('refuses a row with both دفعات and فواتير', () => {
    const bad = rows.map((r) => [...r]);
    bad[5]![5] = 10;
    expect(() => parseLedgerSheet(bad)).toThrow(/both/);
  });
});

describe('encrypted backups', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  it('round-trips with the backup key and detects tampering', async () => {
    const env = await encryptText('{"a":1}', { key });
    expect(isEnvelope(env)).toBe(true);
    expect(env.data).not.toContain('"a"');
    expect(await decryptText(env, { key })).toBe('{"a":1}');
    const tampered = { ...env, data: env.data.slice(0, -4) + 'AAAA' };
    await expect(decryptText(tampered, { key })).rejects.toThrow(/Wrong key|modified/);
  });
  it('round-trips with a passphrase and rejects a wrong one', async () => {
    const env = await encryptText('سر', { passphrase: 'correct horse 1' });
    expect(env.kdf?.iterations).toBe(310_000);
    expect(await decryptText(env, { passphrase: 'correct horse 1' })).toBe('سر');
    await expect(decryptText(env, { passphrase: 'wrong horse 12' })).rejects.toThrow();
    await expect(encryptText('x', { passphrase: 'short' })).rejects.toThrow();
  });
  it('client snapshot encoding is readable by the restore script', () => {
    const enc = encodeValue({
      at: Timestamp.fromMillis(1234),
      img: Bytes.fromUint8Array(new Uint8Array([1, 2])),
      n: [1, 'x'],
    });
    expect(enc).toEqual({ at: { $ts: 1234 }, img: { $bytes: 'AQI=' }, n: [1, 'x'] });
    const back = decode(enc) as { img: Uint8Array };
    expect([...back.img]).toEqual([1, 2]);
  });
});

describe('Dropbox helpers', () => {
  it('turns a shared link into a direct view link', () => {
    expect(rawLink('https://www.dropbox.com/scl/fi/abc/x.webp?rlkey=k&dl=0')).toBe(
      'https://www.dropbox.com/scl/fi/abc/x.webp?rlkey=k&raw=1',
    );
  });
  it('keeps 30 days of backup folders', () => {
    expect(
      expiredBackupFolders(['2026-09-06', '2026-09-07', '2026-10-07', 'notes'], '2026-10-07', 30),
    ).toEqual(['2026-09-06']);
  });
});

describe('time display', () => {
  it('is always 12-hour with ص/م in Riyadh time', async () => {
    const { formatDateTime } = await import('../../src/shared/lib/dates');
    const pm = formatDateTime(Date.UTC(2026, 9, 7, 11, 58)); // 14:58 Riyadh
    expect(pm).toMatch(/2:58\s*م/);
    expect(pm).not.toMatch(/14:58/);
    expect(formatDateTime(Date.UTC(2026, 9, 7, 6, 5), 'short')).toMatch(/9:05\s*ص/);
  });
});

describe('backup file names (12-hour, Riyadh)', () => {
  it('stamps download and Dropbox names', async () => {
    const { fileStamp } = await import('../../src/shared/lib/dates');
    const { backupFileName } = await import('../../src/features/backup/domain/snapshot');
    expect(fileStamp(Date.UTC(2026, 9, 7, 11, 58, 30))).toBe('2026-10-07_02-58م');
    expect(fileStamp(Date.UTC(2026, 9, 7, 11, 58, 30), true)).toBe('2026-10-07_02-58-30م');
    expect(fileStamp(Date.UTC(2026, 9, 7, 21, 5))).toBe('2026-10-08_12-05ص'); // after midnight Riyadh
    expect(backupFileName(Date.UTC(2026, 9, 7, 6, 0))).toBe(
      'supplier-ledger-backup-2026-10-07_09-00ص.slbackup',
    );
  });
});

describe('quick unlock domain', () => {
  it('PIN: exactly 6 digits; Arabic digits accepted', async () => {
    const { validatePin, normalizeDigits } =
      await import('../../src/features/quickUnlock/domain/pin');
    expect(validatePin('48291')).not.toBeNull();
    expect(validatePin('4829155')).not.toBeNull();
    expect(validatePin('48a915')).not.toBeNull();
    expect(validatePin('482915')).toBeNull();
    for (const weak of [
      '000000',
      '777777',
      '123456',
      '654321',
      '890123',
      '210987',
      '121212',
      '123123',
      '٠٠٠٠٠٠',
    ])
      expect(validatePin(weak), weak).not.toBeNull();
    for (const ok of ['135790', '246810', '482915', '112358', '102938'])
      expect(validatePin(ok), ok).toBeNull();
    expect(validatePin('٤٨٢٩١٥')).toBeNull();
    expect(normalizeDigits('۱۲۳٤٥٦')).toBe('123456');
  });
  it('proof depends on the user and matches the rules formula', async () => {
    const { pinProof, proofCheck } = await import('../../src/features/quickUnlock/domain/pin');
    const a = await pinProof('u1', '482915');
    expect(a).toBe(createHash('sha256').update('sl-pin:v1:u1:482915').digest('hex'));
    expect(await pinProof('u1', '٤٨٢٩١٥')).toBe(a);
    expect(await pinProof('u2', '482915')).not.toBe(a);
    expect(await proofCheck(a)).toBe(createHash('sha256').update(a).digest('hex'));
  });
  it('idle outcome: logout without PIN, spare the account if another device is in use', async () => {
    const { idleOutcome, heartbeatEveryMs, NO_LOCK } =
      await import('../../src/features/quickUnlock/domain/presence');
    const now = 10 * 3_600_000;
    const withPin = { ...NO_LOCK, pinSet: true };
    expect(idleOutcome(NO_LOCK, 'me', now, 30)).toBe('logout');
    expect(idleOutcome(withPin, 'me', now, 30)).toBe('lock');
    expect(idleOutcome({ ...withPin, activeBy: 'me', activeAtMs: now - 1000 }, 'me', now, 30)).toBe(
      'lock',
    );
    expect(
      idleOutcome({ ...withPin, activeBy: 'phone', activeAtMs: now - 10 * 60_000 }, 'me', now, 30),
    ).toBe('otherDeviceActive');
    expect(
      idleOutcome({ ...withPin, activeBy: 'phone', activeAtMs: now - 31 * 60_000 }, 'me', now, 30),
    ).toBe('lock');
    expect(heartbeatEveryMs(30)).toBe(5 * 60_000);
    expect(heartbeatEveryMs(2)).toBe(60_000);
    expect(heartbeatEveryMs(1)).toBe(30_000);
  });
});

describe('lock-screen clock', () => {
  it('shows Riyadh time in 12-hour form with the weekday', async () => {
    const { clock12, longDay } = await import('../../src/shared/lib/dates');
    expect(clock12(Date.UTC(2026, 9, 7, 12, 2))).toEqual({ time: '3:02', period: 'م' });
    expect(clock12(Date.UTC(2026, 9, 7, 21, 0))).toEqual({ time: '12:00', period: 'ص' });
    expect(longDay(Date.UTC(2026, 9, 7, 12, 0))).toBe('الأربعاء 2026/10/07');
    expect(longDay(Date.UTC(2026, 9, 7, 22, 0))).toBe('الخميس 2026/10/08');
  });
});

describe('sign-out note', () => {
  it('is shown once after an other-device sign-out', async () => {
    const store = new Map<string, string>();
    (globalThis as { sessionStorage?: unknown }).sessionStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    const m = await import('../../src/features/auth/data/logoutReason');
    expect(m.peekLogoutReason()).toBe('');
    m.setLogoutReason('otherDevice');
    expect(m.peekLogoutReason()).toContain('جهاز آخر');
    m.clearLogoutReason();
    expect(m.peekLogoutReason()).toBe('');
  });
});

describe('WhatsApp signing message', () => {
  it('has number, amount, date, then the link last', async () => {
    const { signLinkMessage } = await import('../../src/features/signing/domain/message');
    const { storedPhone } = await import('../../src/features/accounts/domain/types');
    const m = signLinkMessage({
      payerName: 'شركة الضبيبي',
      voucherNo: 1489,
      amount: 120000,
      date: '2026-10-05',
      minutes: 60,
      url: 'https://x.io/#/s/abc',
    }).split('\n');
    expect(m[1]).toBe('رقم السند: 1489');
    expect(m[2]).toBe('المبلغ: 1,200 ريال');
    expect(m[3]).toBe('التاريخ: 2026/10/05');
    expect(m.at(-1)).toBe('https://x.io/#/s/abc');
    expect(storedPhone('+966 55 755 3590')).toBe('0557553590');
    expect(storedPhone('')).toBe('');
  });
});

describe('entry form context (desktop layout «ب»)', () => {
  const rows = [
    entry({ id: 'a', signed: 1000, amount: 1000, date: '2026-09-01', order: 1 }),
    entry({ id: 'b', type: 'payment', signed: -400, amount: 400, date: '2026-09-03', order: 2 }),
    entry({ id: 'c', signed: 50, amount: 50, date: '2026-09-02', order: 3 }),
    entry({ id: 'd', signed: 999, amount: 999, date: '2026-09-04', order: 4, deleted: true }),
  ];
  it('previews the balance after a new entry and after an edit', () => {
    expect(balanceAfter(rows, 0)).toBe(650);
    expect(balanceAfter(rows, 200)).toBe(850);
    expect(balanceAfter(rows, -100, 'b')).toBe(950);
    expect(balanceAfter(rows, 10, 'd')).toBe(660); // a deleted entry is not replaced
  });
  it('lists the latest live entries newest first by date then order', () => {
    expect(latestEntries(rows, 2).map((e) => e.id)).toEqual(['b', 'c']);
    expect(latestEntries(rows, 5).map((e) => e.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('approved attachment formats', () => {
  it('accepts JPEG, PNG, WebP and iPhone HEIC/HEIF only', () => {
    for (const type of [
      'image/jpeg',
      'image/png',
      'image/webp',
      'IMAGE/JPEG',
      'image/heic',
      'image/heif',
    ])
      expect(isApprovedImage({ type, name: 'x' })).toBe(true);
    for (const type of ['image/gif', 'image/bmp', 'image/svg+xml', 'application/pdf', 'text/html'])
      expect(isApprovedImage({ type, name: 'x.jpg' })).toBe(false);
  });
  it('judges a file without a MIME type by its extension', () => {
    expect(isApprovedImage({ type: '', name: 'scan.JPG' })).toBe(true);
    expect(isApprovedImage({ type: '', name: 'scan.webp' })).toBe(true);
    expect(isApprovedImage({ type: '', name: 'IMG_0001.HEIC' })).toBe(true);
    expect(isApprovedImage({ type: '', name: 'scan.gif' })).toBe(false);
    expect(isApprovedImage({ type: '', name: 'evil.jpg.exe' })).toBe(false);
    expect(isApprovedImage({ type: '' })).toBe(false);
  });
  it('keeps the picker list in step with the check', () => {
    expect(IMAGE_ACCEPT.split(',')).toEqual(
      expect.arrayContaining(['image/jpeg', 'image/png', 'image/webp']),
    );
    expect(IMAGE_ACCEPT).toMatch(/image\/heic/);
    expect(IMAGE_ACCEPT).not.toMatch(/\*|gif|svg/);
  });
  it('routes only HEIC/HEIF through the converter', () => {
    expect(isHeicFile({ type: 'image/heic' })).toBe(true);
    expect(isHeicFile({ type: 'image/heif' })).toBe(true);
    expect(isHeicFile({ type: '', name: 'a.heic' })).toBe(true);
    expect(isHeicFile({ type: 'image/jpeg', name: 'a.heic' })).toBe(false);
  });
});

describe('archive suggestion (90 days, settled only)', () => {
  const row = (p: Partial<ArchiveCandidateInput>): ArchiveCandidateInput => ({
    id: 'a',
    archived: false,
    balance: 0,
    count: 3,
    lastDate: '2026-06-01',
    ...p,
  });
  it('suggests settled accounts idle for 90+ days', () => {
    expect(daysBetween('2026-07-09', '2026-10-07')).toBe(90);
    expect(archiveCandidates([row({ lastDate: '2026-07-09' })], '2026-10-07')).toEqual(['a']);
    expect(archiveCandidates([row({ lastDate: '2026-07-10' })], '2026-10-07')).toEqual([]);
  });
  it('never suggests a balance, an empty account or an archived one', () => {
    expect(archiveCandidates([row({ balance: 100 })], '2026-10-07')).toEqual([]);
    expect(archiveCandidates([row({ balance: -1 })], '2026-10-07')).toEqual([]);
    expect(archiveCandidates([row({ count: 0, lastDate: null })], '2026-10-07')).toEqual([]);
    expect(archiveCandidates([row({ archived: true })], '2026-10-07')).toEqual([]);
    expect(needsLastMovement(row({ balance: 5 }))).toBe(false);
    expect(needsLastMovement(row({}))).toBe(true);
  });
});

describe('notifications text', () => {
  const base = { amount: 100000, date: '2026-10-01', details: 'دفعة', attachments: 1 };
  it('lists only what changed, before ← after', () => {
    expect(describeChanges('payment', base, { ...base })).toEqual([]);
    expect(describeChanges('payment', base, { ...base, amount: 110000 })).toEqual([
      'المبلغ: 1,000 ← 1,100',
    ]);
    expect(
      describeChanges('invoice', base, {
        ...base,
        date: '2026-10-02',
        details: '',
        attachments: 2,
      }),
    ).toEqual(['التاريخ: 2026/10/01 ← 2026/10/02', 'التفاصيل: «دفعة» ← (فارغ)', 'الصور: 1 ← 2']);
    expect(describeChanges('note', base, { ...base, amount: 5 })).toEqual([]);
  });
  it('notifies for signed vouchers and invoices only; never the actor', () => {
    expect(editKind({ type: 'payment', signature: { name: 'x', image: '', signedAtMs: 1 } })).toBe(
      'signedEdit',
    );
    expect(editKind({ type: 'invoice', signature: null })).toBe('invoiceEdit');
    expect(editKind({ type: 'payment', signature: null })).toBeNull();
    expect(editKind({ type: 'note', signature: null })).toBeNull();
    const n = { actor: 'a', readBy: ['b'] };
    expect(isUnread(n, 'a')).toBe(false);
    expect(isUnread(n, 'b')).toBe(false);
    expect(isUnread(n, 'c')).toBe(true);
    expect(visibleTo([n, { actor: 'c', readBy: [] }], 'a')).toHaveLength(1);
  });
  it('keeps long details short', () => {
    const lines = describeChanges('invoice', base, { ...base, details: 'س'.repeat(400) });
    expect(lines[0]!.length).toBeLessThanOrEqual(200);
  });
});

describe('account running totals', () => {
  const e = (signed: number, date = '2026-10-01', deleted = false) => ({ signed, date, deleted });
  it('create, edit, delete and restore move the totals exactly', () => {
    let t = nextTotals(ZERO_TOTALS, null, e(1000));
    expect(t).toEqual({ balance: 1000, entryCount: 1, lastDate: '2026-10-01' });
    t = nextTotals(t, null, e(-300, '2026-10-05'));
    expect(t).toEqual({ balance: 700, entryCount: 2, lastDate: '2026-10-05' });
    t = nextTotals(t, e(1000), e(1500, '2026-09-01'));
    expect(t).toEqual({ balance: 1200, entryCount: 2, lastDate: '2026-10-05' });
    t = nextTotals(t, e(1500), e(1500, '2026-09-01', true));
    expect(t).toEqual({ balance: -300, entryCount: 1, lastDate: '2026-10-05' });
    t = nextTotals(t, e(1500, '2026-09-01', true), e(1500, '2026-09-01'));
    expect(t.balance).toBe(1200);
    expect(nextTotals(t, e(0), e(0))).toEqual(t);
  });
  it('from scratch equals step by step; uninitialised accounts are detected', () => {
    expect(totalsOf([e(5), e(-2, '2026-12-01'), e(9, '2027-01-01', true)])).toEqual({
      balance: 3,
      entryCount: 2,
      lastDate: '2026-12-01',
    });
    expect(readTotals({ name: 'x' })).toBeNull();
    expect(readTotals({ balance: 0, entryCount: 0 })).toEqual(ZERO_TOTALS);
  });
});

describe('owner decisions (2)', () => {
  const MIN = 60_000;
  it('a lock lifts by itself 15 minutes after the last failure', () => {
    const t = 1_000_000_000;
    const s = { fails: 5, lastFailAtMs: t };
    expect(isLocked(s, t + 14 * MIN)).toBe(true);
    expect(minutesUntilUnlock(s, t + 14 * MIN)).toBe(1);
    expect(isLocked(s, t + 15 * MIN)).toBe(false);
    expect(effectiveFails(s, t + 16 * MIN)).toBe(0);
    expect(effectiveFails({ fails: 3, lastFailAtMs: t }, t + 60 * MIN)).toBe(3);
    expect(isLocked(5)).toBe(true); // unknown time: treat as locked
  });
  it('dates more than 30 days ahead are flagged', () => {
    expect(daysAhead('2026-11-06', '2026-10-07')).toBe(30);
    expect(isFarFuture('2026-11-06', '2026-10-07')).toBe(false);
    expect(isFarFuture('2026-11-07', '2026-10-07')).toBe(true);
    expect(isFarFuture('2020-01-01', '2026-10-07')).toBe(false);
  });
});
