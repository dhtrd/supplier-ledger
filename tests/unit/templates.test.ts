import { describe, expect, it } from 'vitest';
import {
  DOC_KINDS,
  LAYOUTS,
  LIMITS,
  columnTitle,
  defaultTemplate,
  fillText,
  normalizeTemplate,
  parseTemplate,
  sideWord,
  validateTemplate,
} from '../../src/features/templates/domain/template';

describe('template layouts', () => {
  it('has the approved counts: statement 5, confirmation 15, voucher 15', () => {
    expect(LAYOUTS.statement).toHaveLength(5);
    expect(LAYOUTS.confirm).toHaveLength(15);
    expect(LAYOUTS.voucher).toHaveLength(15);
  });
  it('every layout default is valid', () => {
    for (const k of DOC_KINDS)
      for (const l of LAYOUTS[k]) expect(validateTemplate(k, defaultTemplate(k, l.id))).toEqual({});
  });
  it('a layout brings its own colour, font and title', () => {
    const t = defaultTemplate('confirm', 'c02');
    expect(t).toMatchObject({ layout: 'c02', color: '#7a2e1a', font: 'amiri' });
    expect(t.title).toBe('شهادة مطابقة رصيد');
  });
});

describe('validateTemplate', () => {
  it('a confirmation must state the balance, its date and the side', () => {
    const t = { ...defaultTemplate('confirm'), body: 'نقرّ بأن الرصيد {الرصيد}.' };
    expect(validateTemplate('confirm', t).body).toContain('{التاريخ}');
    expect(validateTemplate('confirm', t).body).toContain('{الجهة}');
    const ok = { ...t, body: '{الرصيد} حتى {التاريخ} {الجهة}' };
    expect(validateTemplate('confirm', ok)).toEqual({});
  });
  it('a voucher needs some text but no particular placeholder', () => {
    expect(
      validateTemplate('voucher', { ...defaultTemplate('voucher'), body: '  ' }).body,
    ).toBeTruthy();
    expect(validateTemplate('voucher', { ...defaultTemplate('voucher'), body: 'استلمنا' })).toEqual(
      {},
    );
  });
  it('rejects unknown layout, bad colour, unknown font, long texts', () => {
    const base = defaultTemplate('voucher');
    expect(validateTemplate('voucher', { ...base, layout: 'c01' }).layout).toBeTruthy();
    expect(validateTemplate('voucher', { ...base, color: 'red' }).color).toBeTruthy();
    expect(validateTemplate('voucher', { ...base, color: '#12345' }).color).toBeTruthy();
    expect(validateTemplate('voucher', { ...base, font: 'comic' as never }).font).toBeTruthy();
    expect(validateTemplate('voucher', { ...base, title: '' }).title).toBeTruthy();
    expect(
      validateTemplate('voucher', { ...base, title: 'x'.repeat(LIMITS.title + 1) }).title,
    ).toBeTruthy();
    expect(
      validateTemplate('voucher', { ...base, body: 'x'.repeat(LIMITS.body + 1) }).body,
    ).toBeTruthy();
  });
  it('statement columns: unique, known, keep «البيان» and one more', () => {
    const base = defaultTemplate('statement');
    expect(validateTemplate('statement', { ...base, columns: ['details'] }).columns).toBeTruthy();
    expect(
      validateTemplate('statement', { ...base, columns: ['date', 'lah'] }).columns,
    ).toBeTruthy();
    expect(
      validateTemplate('statement', { ...base, columns: ['details', 'lah', 'lah'] }).columns,
    ).toBeTruthy();
    expect(validateTemplate('statement', { ...base, columns: ['lah', 'details'] })).toEqual({});
  });
});

describe('normalizeTemplate / parseTemplate', () => {
  it('keeps only what the kind uses and drops unchanged column titles', () => {
    const t = normalizeTemplate('statement', {
      ...defaultTemplate('statement'),
      color: '#ABCDEF',
      title: '  كشف  ',
      body: 'ignored',
      colTitles: { lah: 'له', alayh: 'مدفوع' },
    });
    expect(t.color).toBe('#abcdef');
    expect(t.title).toBe('كشف');
    expect(t.body).toBe('');
    expect(t.colTitles).toEqual({ alayh: 'مدفوع' });
    const v = normalizeTemplate('voucher', {
      ...defaultTemplate('voucher'),
      colTitles: { lah: 'x' },
    });
    expect(v.columns).toEqual([]);
    expect(v.colTitles).toEqual({});
  });
  it('round-trips a saved template and refuses broken ones', () => {
    const t = normalizeTemplate('confirm', defaultTemplate('confirm', 'c09'));
    expect(parseTemplate('confirm', JSON.parse(JSON.stringify(t)))).toEqual(t);
    expect(parseTemplate('confirm', null)).toBeNull();
    expect(parseTemplate('confirm', { ...t, layout: '../x' })).toBeNull();
    expect(parseTemplate('confirm', { ...t, body: 'بلا بيانات' })).toBeNull();
  });
});

describe('columnTitle / sideWord', () => {
  it('uses «دائن/مدين» when chosen, a custom title first', () => {
    expect(columnTitle({ sides: 'lah', colTitles: {} }, 'lah')).toBe('له');
    expect(columnTitle({ sides: 'dc', colTitles: {} }, 'lah')).toBe('دائن');
    expect(columnTitle({ sides: 'dc', colTitles: {} }, 'alayh')).toBe('مدين');
    expect(columnTitle({ sides: 'dc', colTitles: { lah: 'وارد' } }, 'lah')).toBe('وارد');
    expect(sideWord({ sides: 'dc' }, 'alayh')).toBe('مدين');
    expect(sideWord(null, 'lah')).toBe('له');
    expect(sideWord(null, 'settled')).toBe('مُسوّى');
  });
});

describe('fillText', () => {
  it('replaces known placeholders with value pieces', () => {
    expect(fillText('الرصيد {الرصيد} {الجهة}', { الرصيد: '100 ر.س', الجهة: 'علينا' })).toEqual([
      { text: 'الرصيد ', value: false },
      { text: '100 ر.س', value: true },
      { text: ' ', value: false },
      { text: 'علينا', value: true },
    ]);
  });
  it('leaves unknown names as typed and returns markup as plain text', () => {
    const pieces = fillText('<b>{غير}</b> {المورد}', { المورد: '<img src=x>' });
    expect(pieces.map((p) => p.text).join('')).toBe('<b>{غير}</b> <img src=x>');
    expect(pieces.find((p) => p.value)?.text).toBe('<img src=x>');
  });
});
