/**
 * Arabic amount-in-words (تفقيط) for Saudi riyals and halalas.
 * e.g. 500000 halalas → "خمسة آلاف ريال سعودي لا غير".
 */

type Gender = 'm' | 'f';

const ONES: Record<Gender, string[]> = {
  // Counting a masculine noun (ريال) uses the feminine-looking forms 3–9.
  m: ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'],
  f: ['', 'واحدة', 'اثنتان', 'ثلاث', 'أربع', 'خمس', 'ست', 'سبع', 'ثمان', 'تسع'],
};
const TEENS: Record<Gender, string[]> = {
  m: [
    'عشرة',
    'أحد عشر',
    'اثنا عشر',
    'ثلاثة عشر',
    'أربعة عشر',
    'خمسة عشر',
    'ستة عشر',
    'سبعة عشر',
    'ثمانية عشر',
    'تسعة عشر',
  ],
  f: [
    'عشر',
    'إحدى عشرة',
    'اثنتا عشرة',
    'ثلاث عشرة',
    'أربع عشرة',
    'خمس عشرة',
    'ست عشرة',
    'سبع عشرة',
    'ثماني عشرة',
    'تسع عشرة',
  ],
};
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = [
  '',
  'مائة',
  'مائتان',
  'ثلاثمائة',
  'أربعمائة',
  'خمسمائة',
  'ستمائة',
  'سبعمائة',
  'ثمانمائة',
  'تسعمائة',
];

/** Words for 0 < n < 1000. */
function below1000(n: number, g: Gender, construct = false): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(h === 2 && r === 0 && construct ? 'مائتا' : (HUNDREDS[h] as string));
  if (r) {
    if (r < 10) parts.push(ONES[g][r] as string);
    else if (r < 20) parts.push(TEENS[g][r - 10] as string);
    else {
      const one = r % 10;
      const ten = TENS[Math.floor(r / 10)] as string;
      // Feminine compound units: «إحدى وعشرون هللة», not «واحدة وعشرون».
      const unit = g === 'f' && one === 1 ? 'إحدى' : (ONES[g][one] as string);
      parts.push(one ? `${unit} و${ten}` : ten);
    }
  }
  return parts.join(' و');
}

const SCALES = [
  { size: 1_000_000_000, one: 'مليار', two: ['ملياران', 'مليارا'], few: 'مليارات' },
  { size: 1_000_000, one: 'مليون', two: ['مليونان', 'مليونا'], few: 'ملايين' },
  { size: 1_000, one: 'ألف', two: ['ألفان', 'ألفا'], few: 'آلاف' },
] as const;

/** Integer words. `construct` = directly followed by the counted noun. */
export function numberToWords(n: number, g: Gender = 'm'): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('numberToWords: invalid number');
  if (n === 0) return 'صفر';
  const groups: string[] = [];
  let rest = n;
  for (const s of SCALES) {
    const count = Math.floor(rest / s.size);
    rest %= s.size;
    if (!count) continue;
    const last = rest === 0;
    if (count === 1) groups.push(s.one);
    else if (count === 2) groups.push(last ? s.two[1] : s.two[0]);
    else if (count <= 10) groups.push(`${below1000(count, 'm')} ${s.few}`);
    else {
      const tail = count % 100;
      groups.push(`${below1000(count, 'm')} ${tail >= 3 && tail <= 10 ? s.few : s.one}`);
    }
  }
  if (rest) groups.push(below1000(rest, g, true));
  return groups.join(' و');
}

function riyalNoun(n: number): string {
  if (n === 1) return 'ريال سعودي واحد';
  if (n === 2) return 'ريالان سعوديان';
  const r = n % 100;
  const w = numberToWords(n, 'm');
  return r >= 3 && r <= 10 ? `${w} ريالات سعودية` : `${w} ريال سعودي`;
}

function halalaNoun(n: number): string {
  if (n === 1) return 'هللة واحدة';
  if (n === 2) return 'هللتان';
  const w = numberToWords(n, 'f');
  return n >= 3 && n <= 10 ? `${w} هللات` : `${w} هللة`;
}

/** Full tafqit for an amount in halalas. */
export function amountInWords(halalas: number): string {
  if (!Number.isSafeInteger(halalas) || halalas < 0)
    throw new RangeError('amountInWords: invalid amount');
  const riyals = Math.floor(halalas / 100);
  const h = halalas % 100;
  if (riyals === 0 && h === 0) return 'صفر ريال سعودي';
  const parts: string[] = [];
  if (riyals) parts.push(riyalNoun(riyals));
  if (h) parts.push(halalaNoun(h));
  return `${parts.join(' و')} لا غير`;
}
