import { cleanText } from '../../../shared/lib/text';
import type { Role } from '../../users/domain/types';
import { DEFAULT_ROLE_LABELS } from '../../users/domain/types';

/** settings/app */
export interface AppSettings {
  linkMinutes: number;
  payerName: string;
  roleLabels: Record<Role, string>;
  /** Minutes without activity before the idle countdown starts. */
  idleMinutes: number;
  /** Seconds of visible countdown before sign-out / lock. */
  idleCountdownSeconds: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  linkMinutes: 60,
  payerName: 'شركة الضبيبي',
  roleLabels: DEFAULT_ROLE_LABELS,
  idleMinutes: 30,
  idleCountdownSeconds: 10,
};

export const IDLE_MINUTES_MIN = 1;
export const IDLE_MINUTES_MAX = 240;
export const COUNTDOWN_MIN = 5;
export const COUNTDOWN_MAX = 120;

export const LINK_MINUTES_MIN = 5;
export const LINK_MINUTES_MAX = 1440;

export function validateSettings(s: AppSettings): string | null {
  if (
    !Number.isInteger(s.linkMinutes) ||
    s.linkMinutes < LINK_MINUTES_MIN ||
    s.linkMinutes > LINK_MINUTES_MAX
  )
    return `مدة الرابط بين ${LINK_MINUTES_MIN} و${LINK_MINUTES_MAX} دقيقة.`;
  if (
    !Number.isInteger(s.idleMinutes) ||
    s.idleMinutes < IDLE_MINUTES_MIN ||
    s.idleMinutes > IDLE_MINUTES_MAX
  )
    return `مدة الخمول بين ${IDLE_MINUTES_MIN} و${IDLE_MINUTES_MAX} دقيقة.`;
  if (
    !Number.isInteger(s.idleCountdownSeconds) ||
    s.idleCountdownSeconds < COUNTDOWN_MIN ||
    s.idleCountdownSeconds > COUNTDOWN_MAX
  )
    return `العد التنازلي بين ${COUNTDOWN_MIN} و${COUNTDOWN_MAX} ثانية.`;
  if (!cleanText(s.payerName)) return 'أدخل اسم الدافع.';
  if (s.payerName.length > 100) return 'اسم الدافع أطول من 100 حرف.';
  for (const r of ['owner', 'admin', 'entry'] as const) {
    const l = cleanText(s.roleLabels[r]);
    if (!l) return 'لا تترك مسمى دور فارغاً.';
    if (l.length > 40) return 'مسمى الدور أطول من 40 حرفاً.';
  }
  return null;
}

/** Hours after which the owner is warned that the daily backup did not land. */
export const BACKUP_LATE_HOURS = 26;

export function backupState(lastBackupMs: number | null, nowMs: number): 'none' | 'ok' | 'late' {
  if (lastBackupMs === null) return 'none';
  return nowMs - lastBackupMs > BACKUP_LATE_HOURS * 3_600_000 ? 'late' : 'ok';
}

/** "3 ساعات" / "31 ساعة" / "يومين" — rough age for the backup card. */
export function ageLabel(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return 'أقل من ساعة';
  if (h === 1) return 'ساعة';
  if (h === 2) return 'ساعتين';
  if (h <= 10) return `${h} ساعات`;
  if (h < 48) return `${h} ساعة`;
  const d = Math.floor(h / 24);
  if (d === 2) return 'يومين';
  if (d <= 10) return `${d} أيام`;
  return `${d} يوماً`;
}
