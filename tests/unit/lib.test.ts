import { describe, expect, it } from 'vitest';
import { amountInWords, numberToWords } from '../../src/shared/lib/tafqit';
import {
  balanceSide,
  formatAmount,
  normalizeDigits,
  parseAmount,
  cleanAmountInput,
} from '../../src/shared/lib/money';
import {
  displayDate,
  isIsoDate,
  monthGrid,
  normalizeRange,
  rangePresets,
  todayRiyadh,
} from '../../src/shared/lib/dates';
import { toWhatsAppNumber, whatsAppLink } from '../../src/shared/lib/phone';
import { generateToken } from '../../src/shared/lib/token';

describe('tafqit (amount in words)', () => {
  it.each([
    [500000, 'خمسة آلاف ريال سعودي لا غير'],
    [170000, 'ألف وسبعمائة ريال سعودي لا غير'],
    [150000, 'ألف وخمسمائة ريال سعودي لا غير'],
    [200000, 'ألفا ريال سعودي لا غير'],
    [250000, 'ألفان وخمسمائة ريال سعودي لا غير'],
    [100, 'ريال سعودي واحد لا غير'],
    [200, 'ريالان سعوديان لا غير'],
    [300, 'ثلاثة ريالات سعودية لا غير'],
    [1100, 'أحد عشر ريال سعودي لا غير'],
    [2100, 'واحد وعشرون ريال سعودي لا غير'],
    [10300, 'مائة وثلاثة ريالات سعودية لا غير'],
    [1385000, 'ثلاثة عشر ألف وثمانمائة وخمسون ريال سعودي لا غير'],
    [10300000, 'مائة وثلاثة آلاف ريال سعودي لا غير'],
    [100000000, 'مليون ريال سعودي لا غير'],
    [150, 'ريال سعودي واحد وخمسون هللة لا غير'],
    [5, 'خمس هللات لا غير'],
  ])('%i halalas → %s', (h, words) => {
    expect(amountInWords(h)).toBe(words);
  });
  it('rejects negative or fractional input', () => {
    expect(() => amountInWords(-1)).toThrow();
    expect(() => numberToWords(1.5)).toThrow();
  });
});

describe('money', () => {
  it('parses Western and Arabic digits with separators', () => {
    expect(parseAmount('1,500')).toBe(150000);
    expect(parseAmount('١٥٠٠')).toBe(150000);
    expect(parseAmount('١٥٠٠٫٥')).toBe(150050);
    expect(parseAmount('0.25')).toBe(25);
  });
  it('rejects invalid amounts', () => {
    for (const bad of ['', 'abc', '-5', '1.234', '1e5', '1..2'])
      expect(parseAmount(bad)).toBeNull();
  });
  it('formats halalas for display', () => {
    expect(formatAmount(775000)).toBe('7,750');
    expect(formatAmount(150050)).toBe('1,500.50');
    expect(formatAmount(-290000)).toBe('-2,900');
  });
  it('maps the sign to له / عليه', () => {
    expect(balanceSide(1)).toBe('lah');
    expect(balanceSide(-1)).toBe('alayh');
    expect(balanceSide(0)).toBe('settled');
  });
  it('normalises digits', () => {
    expect(normalizeDigits('٠٥٥٧ ٤٧٠')).toBe('0557470');
  });
});

describe('dates', () => {
  it('validates real calendar days only', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('26-02-01')).toBe(false);
  });
  it('builds a Sunday-first month grid', () => {
    const g = monthGrid(2026, 9); // October 2026 starts on Thursday
    expect(g.slice(0, 4)).toEqual([null, null, null, null]);
    expect(g[4]).toBe('2026-10-01');
    expect(g.at(-1)).toBe('2026-10-31');
  });
  it('computes presets relative to a given day, across year boundaries', () => {
    const p = rangePresets('2026-01-15');
    expect(p.lastMonth).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(p.last3Months.from).toBe('2025-10-01');
    expect(p.thisYear).toEqual({ from: '2026-01-01', to: '2026-01-15' });
  });
  it('swaps a reversed range', () => {
    expect(normalizeRange({ from: '2026-09-10', to: '2026-09-01' })).toEqual({
      from: '2026-09-01',
      to: '2026-09-10',
    });
  });
  it('formats and resolves today in Riyadh', () => {
    expect(displayDate('2026-09-15')).toBe('2026/09/15');
    expect(todayRiyadh(new Date('2026-10-06T22:30:00Z'))).toBe('2026-10-07');
  });
});

describe('phone / WhatsApp', () => {
  it('normalises Saudi mobiles', () => {
    expect(toWhatsAppNumber('0557470442')).toBe('966557470442');
    expect(toWhatsAppNumber('+966 55 747 0442')).toBe('966557470442');
    expect(toWhatsAppNumber('٠٥٥٧٤٧٠٤٤٢')).toBe('966557470442');
  });
  it('rejects non-mobile or malformed numbers', () => {
    expect(toWhatsAppNumber('')).toBeNull();
    expect(toWhatsAppNumber('0676173525')).toBeNull();
    expect(toWhatsAppNumber('0122345678')).toBeNull();
  });
  it('builds an encoded wa.me link', () => {
    const l = whatsAppLink('0557470442', 'سند دفعة https://x.io/#/s/abc');
    expect(l).toMatch(/^https:\/\/wa\.me\/966557470442\?text=/);
    expect(l).not.toContain(' ');
  });
});

describe('signing token', () => {
  it('is 22 url-safe chars and unique', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(a).not.toBe(b);
  });
});

describe('amount field accepts only an amount while typing', () => {
  it('drops letters and symbols, keeps Arabic or Western digits', () => {
    expect(cleanAmountInput('بيسشب')).toBe('');
    expect(cleanAmountInput('12a3')).toBe('123');
    expect(cleanAmountInput('١٢٣٤')).toBe('1234');
    expect(cleanAmountInput('1,500')).toBe('1500');
    expect(cleanAmountInput('-50')).toBe('50');
  });
  it('one decimal point, at most two decimals, at most 9 whole digits', () => {
    expect(cleanAmountInput('12.345')).toBe('12.34');
    expect(cleanAmountInput('١٢٫٥')).toBe('12.5');
    expect(cleanAmountInput('1.2.3')).toBe('1.23');
    expect(cleanAmountInput('.5')).toBe('0.5');
    expect(cleanAmountInput('12.')).toBe('12.');
    expect(cleanAmountInput('12345678901')).toBe('123456789');
    expect(parseAmount(cleanAmountInput('١٬٥٠٠٫٧٥ ريال'))).toBe(150075);
  });
});
