/** Dates are plain 'YYYY-MM-DD' strings (calendar days, no time zone drift). */

export const MONTHS_AR = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
] as const;

export const WEEKDAYS_AR = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'] as const;

const pad = (n: number) => String(n).padStart(2, '0');

export function toIso(y: number, monthIndex: number, d: number): string {
  // Normalises overflow (e.g. month -1) through Date.UTC.
  const dt = new Date(Date.UTC(y, monthIndex, d));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return toIso(y, m - 1, d) === s;
}

export function parseIso(s: string): { y: number; m: number; d: number } {
  if (!isIsoDate(s)) throw new RangeError(`Invalid date: ${s}`);
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return { y, m: m - 1, d };
}

export function daysInMonth(y: number, monthIndex: number): number {
  return new Date(Date.UTC(y, monthIndex + 1, 0)).getUTCDate();
}

/** Display form: 2026/09/15 */
export function displayDate(iso: string): string {
  return iso.replace(/-/g, '/');
}

/**
 * Date + time for display, always 12-hour with ص/م (owner decision), Gregorian
 * calendar, Latin digits, Riyadh time — e.g. «07/10/2026، 2:58 م».
 */
export function formatDateTime(ms: number, dateStyle: 'short' | 'medium' = 'medium'): string {
  return new Date(ms).toLocaleString('ar-SA-u-ca-gregory-nu-latn', {
    timeZone: 'Asia/Riyadh',
    dateStyle,
    timeStyle: 'short',
    hourCycle: 'h12',
  });
}

/**
 * File-name stamp in Riyadh time, 12-hour (owner decision):
 * «2026-10-07_02-58م» or, with seconds, «2026-10-07_02-58-30م».
 */
export function fileStamp(ms: number, withSeconds = false): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Riyadh',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  const period = parts.dayPeriod === 'AM' ? 'ص' : 'م';
  const time = [parts.hour, parts.minute, ...(withSeconds ? [parts.second] : [])].join('-');
  return `${todayRiyadh(new Date(ms))}_${time}${period}`;
}

/** Wall clock for the lock screen: Riyadh time, 12-hour — { time: '3:02', period: 'م' }. */
export function clock12(ms: number): { time: string; period: 'ص' | 'م' } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Riyadh',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  return { time: `${parts.hour}:${parts.minute}`, period: parts.dayPeriod === 'AM' ? 'ص' : 'م' };
}

const WEEKDAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/** «الأربعاء 2026/10/07» in Riyadh time. */
export function longDay(ms: number): string {
  const iso = todayRiyadh(new Date(ms));
  const [y, m, d] = iso.split('-').map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()]} ${displayDate(iso)}`;
}

/** Today's date in Asia/Riyadh as 'YYYY-MM-DD'. */
export function todayRiyadh(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(now);
}

/** Calendar cells for a month view, weeks starting on Sunday; null = blank cell. */
export function monthGrid(y: number, monthIndex: number): (string | null)[] {
  const first = new Date(Date.UTC(y, monthIndex, 1)).getUTCDay();
  const cells: (string | null)[] = Array.from({ length: first }, () => null);
  for (let d = 1; d <= daysInMonth(y, monthIndex); d++) cells.push(toIso(y, monthIndex, d));
  return cells;
}

export type Range = { from: string; to: string };

export function rangePresets(
  today: string,
): Record<'thisMonth' | 'lastMonth' | 'last3Months' | 'thisYear', Range> {
  const { y, m } = parseIso(today);
  return {
    thisMonth: { from: toIso(y, m, 1), to: today },
    lastMonth: { from: toIso(y, m - 1, 1), to: toIso(y, m, 0) },
    last3Months: { from: toIso(y, m - 3, 1), to: today },
    thisYear: { from: toIso(y, 0, 1), to: today },
  };
}

/** Ensures from <= to by swapping when needed. */
export function normalizeRange(r: Range): Range {
  return r.from <= r.to ? r : { from: r.to, to: r.from };
}
