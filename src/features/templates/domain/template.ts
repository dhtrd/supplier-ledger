import { cleanText } from '../../../shared/lib/text';

/**
 * Per-supplier document templates (owner decisions 2026-10-17): each
 * supplier/customer can have its own statement, balance confirmation and
 * payment voucher — a layout (structure) from an approved set, then colour,
 * font and texts. No template = the current documents, unchanged.
 * Pure: shared by the app, the editor preview and the unit tests.
 */

export type DocKind = 'statement' | 'confirm' | 'voucher';
export const DOC_KINDS: DocKind[] = ['statement', 'confirm', 'voucher'];
export const DOC_LABEL: Record<DocKind, string> = {
  statement: 'كشف الحساب',
  confirm: 'إقرار المطابقة',
  voucher: 'سند الدفعة',
};

/** Fonts bundled with the app (no font is fetched from the internet when printing). */
export const FONTS = {
  plex: { label: 'IBM Plex', css: "'IBM Plex Sans Arabic', system-ui, sans-serif" },
  naskh: { label: 'نوتو نسخ', css: "'Noto Naskh Arabic', serif" },
  amiri: { label: 'أميري', css: "'Amiri', 'Noto Naskh Arabic', serif" },
  tajawal: { label: 'تجوال', css: "'Tajawal', 'IBM Plex Sans Arabic', sans-serif" },
  cairo: { label: 'القاهرة', css: "'Cairo', 'IBM Plex Sans Arabic', sans-serif" },
} as const;
export type FontId = keyof typeof FONTS;
export const FONT_IDS = Object.keys(FONTS) as FontId[];

export const COLORS = [
  '#1f6f5c',
  '#2d4f7c',
  '#7a2e1a',
  '#5b3f8c',
  '#8a5a00',
  '#1b2a3a',
  '#0f6e8c',
  '#a4452a',
  '#4a5663',
];

export type ColumnId = 'date' | 'type' | 'no' | 'details' | 'lah' | 'alayh' | 'balance';
export const COLUMN_IDS: ColumnId[] = ['date', 'type', 'no', 'details', 'lah', 'alayh', 'balance'];
export const COLUMN_LABEL: Record<ColumnId, string> = {
  date: 'التاريخ',
  type: 'النوع',
  no: 'رقم السند',
  details: 'البيان',
  lah: 'له',
  alayh: 'عليه',
  balance: 'الرصيد',
};

interface LayoutDef {
  id: string;
  name: string;
  note: string;
  color: string;
  font: FontId;
  /** Title the layout starts with (editable). */
  title?: string;
}

/** Approved structures: statement 5 (2026-10-17), confirmation 15 and voucher 15 (gallery, all approved). */
export const LAYOUTS: Record<DocKind, LayoutDef[]> = {
  statement: [
    {
      id: 'classic',
      name: 'الجدول الكلاسيكي',
      note: 'ترويسة بخط وجدول بعناوين ملوّنة',
      color: '#1f6f5c',
      font: 'plex',
    },
    {
      id: 'band',
      name: 'الشريط الحديث',
      note: 'شريط ملوّن وملخص الأرقام في بطاقات',
      color: '#0f6e8c',
      font: 'cairo',
    },
    {
      id: 'tacct',
      name: 'حساب «ت»',
      note: 'له وعليه متقابلان كدفتر الأستاذ',
      color: '#1b2a3a',
      font: 'naskh',
    },
    {
      id: 'cards',
      name: 'الخط الزمني',
      note: 'كل حركة بطاقة على خط زمني',
      color: '#5b3f8c',
      font: 'tajawal',
    },
    {
      id: 'formal',
      name: 'الرسمي المؤطّر',
      note: 'إطار مزدوج وختم',
      color: '#7a2e1a',
      font: 'amiri',
    },
  ],
  confirm: [
    {
      id: 'c01',
      name: 'خطاب رسمي',
      note: 'ترويسة بخط ونص الخطاب',
      color: '#1f6f5c',
      font: 'naskh',
    },
    {
      id: 'c02',
      name: 'شهادة مؤطّرة',
      note: 'إطار مزدوج والرصيد في الوسط',
      color: '#7a2e1a',
      font: 'amiri',
      title: 'شهادة مطابقة رصيد',
    },
    { id: 'c03', name: 'نموذج حقول', note: 'جدول حقول وقيم', color: '#2d4f7c', font: 'plex' },
    {
      id: 'c04',
      name: 'شريط علوي وبطاقة',
      note: 'شريط ملوّن وبطاقة الرصيد',
      color: '#0f6e8c',
      font: 'cairo',
    },
    {
      id: 'c05',
      name: 'عمود جانبي ملوّن',
      note: 'البيانات في عمود ملوّن',
      color: '#5b3f8c',
      font: 'tajawal',
    },
    {
      id: 'c06',
      name: 'دبلومة مزخرفة',
      note: 'إطاران وزخرفة',
      color: '#8a5a00',
      font: 'amiri',
      title: 'إقرار',
    },
    { id: 'c07', name: 'جدول بنود', note: 'البند والقيمة', color: '#1b2a3a', font: 'plex' },
    { id: 'c08', name: 'بسيط هادئ', note: 'خط رفيع ومساحات', color: '#4a5663', font: 'plex' },
    {
      id: 'c09',
      name: 'مذكرة',
      note: 'إلى / من / التاريخ / الموضوع',
      color: '#a4452a',
      font: 'naskh',
      title: 'مذكرة إقرار',
    },
    { id: 'c10', name: 'بطاقة وسط الصفحة', note: 'بطاقة بظل', color: '#1f6f5c', font: 'cairo' },
    {
      id: 'c11',
      name: 'خطاب بختم دائري',
      note: 'ختم باسم المورد',
      color: '#2d4f7c',
      font: 'amiri',
    },
    { id: 'c12', name: 'نص وملخص', note: 'النص وبجانبه ملخص', color: '#0f6e8c', font: 'tajawal' },
    { id: 'c13', name: 'خلفية مائية', note: 'الرصيد علامة مائية', color: '#5b3f8c', font: 'cairo' },
    {
      id: 'c14',
      name: 'توقيع كبير بشريط سفلي',
      note: 'مساحة توقيع وختم كبيرة',
      color: '#7a2e1a',
      font: 'plex',
    },
    {
      id: 'c15',
      name: 'ترويسة وسطية كلاسيكية',
      note: 'الاسم في الوسط وعنوان مؤطّر',
      color: '#1b2a3a',
      font: 'naskh',
    },
  ],
  voucher: [
    {
      id: 'v01',
      name: 'عمود جانبي',
      note: 'المبلغ وبجانبه الرقم والتاريخ',
      color: '#1f6f5c',
      font: 'plex',
    },
    {
      id: 'v02',
      name: 'إيصال بكعب',
      note: 'نصف صفحة وكعب ملوّن',
      color: '#2d4f7c',
      font: 'tajawal',
    },
    { id: 'v03', name: 'نموذج حقول', note: 'جدول حقول وقيم', color: '#5b3f8c', font: 'plex' },
    {
      id: 'v04',
      name: 'مبلغ ضخم بشريط',
      note: 'المبلغ كبير في الوسط',
      color: '#0f6e8c',
      font: 'cairo',
    },
    { id: 'v05', name: 'شكل الشيك', note: 'سطور كالشيك البنكي', color: '#1b2a3a', font: 'naskh' },
    {
      id: 'v06',
      name: 'لوحة جانبية كاملة',
      note: 'لوحة ملوّنة بطول الصفحة',
      color: '#7a2e1a',
      font: 'tajawal',
    },
    {
      id: 'v07',
      name: 'رسمي مؤطّر بختم',
      note: 'إطار مزدوج وختم',
      color: '#1f6f5c',
      font: 'amiri',
      title: 'سند قبض',
    },
    { id: 'v08', name: 'بسيط هادئ', note: 'خط رفيع ومساحات', color: '#4a5663', font: 'plex' },
    {
      id: 'v09',
      name: 'شريط زاوية',
      note: 'شريط «مدفوع» في الزاوية',
      color: '#8a5a00',
      font: 'cairo',
    },
    {
      id: 'v10',
      name: 'جدول تفاصيل',
      note: 'البيان والمبلغ والإجمالي',
      color: '#2d4f7c',
      font: 'plex',
    },
    {
      id: 'v11',
      name: 'ترويسة وسطية مزخرفة',
      note: 'زخرفة وخط مزدوج',
      color: '#5b3f8c',
      font: 'amiri',
    },
    {
      id: 'v12',
      name: 'نسختان (أصل وصورة)',
      note: 'نسختان في صفحة',
      color: '#1f6f5c',
      font: 'tajawal',
    },
    { id: 'v13', name: 'خلفية مائية', note: 'المبلغ علامة مائية', color: '#a4452a', font: 'cairo' },
    {
      id: 'v14',
      name: 'طرفان متقابلان',
      note: 'الدافع ثم المبلغ ثم المستلم',
      color: '#0f6e8c',
      font: 'plex',
    },
    {
      id: 'v15',
      name: 'مربعات مرقّمة',
      note: 'خانات للرقم والبيانات',
      color: '#1b2a3a',
      font: 'naskh',
    },
  ],
};

export function layoutOf(kind: DocKind, id: string): LayoutDef | undefined {
  return LAYOUTS[kind].find((l) => l.id === id);
}

/** Placeholders usable in the texts. */
export const VARS = [
  'المورد',
  'الدافع',
  'التاريخ',
  'الرصيد',
  'التفقيط',
  'الجهة',
  'الرقم',
  'المبلغ',
] as const;
export type VarName = (typeof VARS)[number];
export const VARS_FOR: Record<DocKind, VarName[]> = {
  statement: ['المورد', 'الدافع'],
  confirm: ['المورد', 'الدافع', 'التاريخ', 'الرصيد', 'التفقيط', 'الجهة', 'الرقم'],
  voucher: ['المورد', 'الدافع', 'التاريخ', 'المبلغ', 'التفقيط', 'الرقم'],
};
/** Owner decision: a confirmation text must state the balance, its date and the side. */
export const REQUIRED_VARS: Record<DocKind, VarName[]> = {
  statement: [],
  confirm: ['الرصيد', 'التاريخ', 'الجهة'],
  voucher: [],
};

const DEFAULT_TITLE: Record<DocKind, string> = {
  statement: 'كشف حساب',
  confirm: 'إقرار مطابقة رصيد',
  voucher: 'سند استلام دفعة',
};
export const DEFAULT_BODY: Record<DocKind, string> = {
  statement: '',
  confirm:
    'نقرّ نحن «{المورد}» بأن رصيد حسابنا لدى {الدافع} حتى تاريخ {التاريخ} هو {الرصيد} ({التفقيط}) {الجهة}، وأنه مطابق لما في سجلاتنا.',
  voucher: 'استلمنا دفعة من {الدافع} بمبلغ وقدره {المبلغ} ({التفقيط}).',
};

export interface DocTemplate {
  layout: string;
  color: string;
  font: FontId;
  title: string;
  /** Free line under the supplier's name (address, CR number…). */
  sub: string;
  foot: string;
  /** Statement: «له/عليه» or «دائن/مدين». */
  sides: 'lah' | 'dc';
  /** Statement: visible columns, in order. */
  columns: ColumnId[];
  /** Statement: renamed column headings. */
  colTitles: Partial<Record<ColumnId, string>>;
  /** Confirmation / voucher text with {placeholders}. */
  body: string;
}

export type AccountTemplates = Partial<Record<DocKind, DocTemplate>>;

export const LIMITS = { title: 60, sub: 120, foot: 120, colTitle: 30, body: 800 } as const;

/** A fresh template for a layout, with that layout's own colour, font and title. */
export function defaultTemplate(kind: DocKind, layoutId?: string): DocTemplate {
  const l = (layoutId && layoutOf(kind, layoutId)) || LAYOUTS[kind][0]!;
  return {
    layout: l.id,
    color: l.color,
    font: l.font,
    title: l.title ?? DEFAULT_TITLE[kind],
    sub: '',
    foot: '',
    sides: 'lah',
    columns: ['date', 'no', 'details', 'lah', 'alayh', 'balance'],
    colTitles: {},
    body: DEFAULT_BODY[kind],
  };
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const LAYOUT_ID = /^[a-z0-9]{1,12}$/;

/** Errors in Arabic, keyed by field; empty = valid. Mirrors firestore.rules. */
export function validateTemplate(
  kind: DocKind,
  t: DocTemplate,
): Partial<Record<keyof DocTemplate, string>> {
  const e: Partial<Record<keyof DocTemplate, string>> = {};
  if (!layoutOf(kind, t.layout)) e.layout = 'اختر تركيباً من القائمة.';
  if (!HEX.test(t.color)) e.color = 'اللون غير صحيح.';
  if (!FONT_IDS.includes(t.font)) e.font = 'اختر خطاً من القائمة.';
  const title = cleanText(t.title);
  if (!title) e.title = 'اكتب عنوان المستند.';
  else if (title.length > LIMITS.title) e.title = `العنوان أطول من ${LIMITS.title} حرفاً.`;
  if (cleanText(t.sub).length > LIMITS.sub) e.sub = `السطر أطول من ${LIMITS.sub} حرفاً.`;
  if (cleanText(t.foot).length > LIMITS.foot) e.foot = `التذييل أطول من ${LIMITS.foot} حرفاً.`;
  if (kind === 'statement') {
    const uniq = new Set(t.columns);
    if (uniq.size !== t.columns.length || t.columns.some((c) => !COLUMN_IDS.includes(c)))
      e.columns = 'الأعمدة غير صحيحة.';
    else if (!t.columns.includes('details') || t.columns.length < 2)
      e.columns = 'أبقِ عمود «البيان» وعموداً آخر على الأقل.';
    if (
      Object.entries(t.colTitles).some(
        ([k, v]) =>
          !COLUMN_IDS.includes(k as ColumnId) || cleanText(v ?? '').length > LIMITS.colTitle,
      )
    )
      e.colTitles = `عنوان العمود أطول من ${LIMITS.colTitle} حرفاً.`;
  } else {
    const body = cleanText(t.body, { keepNewlines: true });
    if (!body) e.body = 'اكتب نص المستند.';
    else if (body.length > LIMITS.body) e.body = `النص أطول من ${LIMITS.body} حرف.`;
    else {
      const missing = REQUIRED_VARS[kind].filter((v) => !body.includes(`{${v}}`));
      if (missing.length) e.body = `النص يجب أن يحتوي ${missing.map((v) => `{${v}}`).join(' و')}.`;
    }
  }
  return e;
}

/** Cleans the texts and keeps only the fields the kind uses (what is saved). */
export function normalizeTemplate(kind: DocKind, t: DocTemplate): DocTemplate {
  const colTitles: Partial<Record<ColumnId, string>> = {};
  for (const c of COLUMN_IDS) {
    const v = cleanText(t.colTitles[c] ?? '');
    if (kind === 'statement' && v && v !== COLUMN_LABEL[c]) colTitles[c] = v;
  }
  return {
    layout: t.layout,
    color: t.color.toLowerCase(),
    font: t.font,
    title: cleanText(t.title),
    sub: cleanText(t.sub),
    foot: cleanText(t.foot),
    sides: t.sides === 'dc' ? 'dc' : 'lah',
    columns: kind === 'statement' ? [...t.columns] : [],
    colTitles,
    body: kind === 'statement' ? '' : cleanText(t.body, { keepNewlines: true }),
  };
}

/** Reads a stored template; null when missing or not valid (then the current document is used). */
export function parseTemplate(kind: DocKind, raw: unknown): DocTemplate | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const t: DocTemplate = {
    layout: str(r.layout),
    color: str(r.color),
    font: str(r.font) as FontId,
    title: str(r.title),
    sub: str(r.sub),
    foot: str(r.foot),
    sides: r.sides === 'dc' ? 'dc' : 'lah',
    columns: Array.isArray(r.columns)
      ? (r.columns.filter((c) => typeof c === 'string') as ColumnId[])
      : [],
    colTitles:
      r.colTitles && typeof r.colTitles === 'object'
        ? Object.fromEntries(
            Object.entries(r.colTitles as Record<string, unknown>).filter(
              ([k, v]) => COLUMN_IDS.includes(k as ColumnId) && typeof v === 'string',
            ),
          )
        : {},
    body: str(r.body),
  };
  if (!LAYOUT_ID.test(t.layout)) return null;
  return Object.keys(validateTemplate(kind, t)).length ? null : t;
}

/** Heading of a statement column under this template. */
export function columnTitle(t: Pick<DocTemplate, 'sides' | 'colTitles'>, c: ColumnId): string {
  const custom = t.colTitles[c];
  if (custom) return custom;
  if (t.sides === 'dc' && c === 'lah') return 'دائن';
  if (t.sides === 'dc' && c === 'alayh') return 'مدين';
  return COLUMN_LABEL[c];
}

export function sideWord(
  t: Pick<DocTemplate, 'sides'> | null,
  side: 'lah' | 'alayh' | 'settled',
): string {
  if (side === 'settled') return 'مُسوّى';
  if (t?.sides === 'dc') return side === 'lah' ? 'دائن' : 'مدين';
  return side === 'lah' ? 'له' : 'عليه';
}

/** A piece of filled text; `value` pieces come from a placeholder (shown in bold). */
export interface TextPiece {
  text: string;
  value: boolean;
}

/**
 * Replaces {placeholders} with values. Returns plain text pieces — never HTML:
 * whatever the text contains is rendered as text. Unknown {names} stay as typed.
 */
export function fillText(text: string, values: Partial<Record<VarName, string>>): TextPiece[] {
  const out: TextPiece[] = [];
  const re = /\{([^{}]{1,20})\}/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const v = values[m[1] as VarName];
    if (v === undefined) continue;
    if (m.index > last) out.push({ text: text.slice(last, m.index), value: false });
    out.push({ text: v, value: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), value: false });
  return out;
}
