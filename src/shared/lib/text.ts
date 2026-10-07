/**
 * Invisible or direction-changing characters that make a name look empty or
 * flip the text after it on vouchers, WhatsApp messages and notifications:
 * C0/C1 controls, zero-width marks, bidi embeddings/overrides/isolates, BOM.
 * (Line breaks are kept only where multi-line text is allowed: `keepNewlines`.)
 */
// Built from escapes on purpose (no literal invisible characters in the source).
const INVISIBLE = new RegExp(
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F' +
    '\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u206F\\uFEFF]',
  'g',
);
const NEWLINES = /[\n\r\t]/g;

/**
 * Search form: Arabic/Persian digits → Western, invisible marks removed,
 * spaces collapsed (but kept, so «شركة الأمل» still matches), lower-cased.
 */
export function searchKey(s: string): string {
  return cleanText(s)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** Removes invisible/bidi-control characters and trims. */
export function cleanText(s: string, { keepNewlines = false } = {}): string {
  const out = s.replace(INVISIBLE, '');
  return (keepNewlines ? out : out.replace(NEWLINES, ' ')).trim();
}
