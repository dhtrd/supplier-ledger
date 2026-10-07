import { cleanText } from '../../../shared/lib/text';
export type Role = 'owner' | 'admin' | 'entry';

/** users/{uid} */
export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  assignedAccounts: string[];
}

export const DEFAULT_ROLE_LABELS: Record<Role, string> = {
  owner: 'المالك',
  admin: 'الإدارة',
  entry: 'مدخل البيانات',
};

/**
 * What each role may do in the UI. This only mirrors firestore.rules (the real
 * enforcement); keep both in sync.
 */
export const can = {
  manageAccounts: (r: Role) => r === 'owner' || r === 'admin',
  manageUsers: (r: Role) => r === 'owner' || r === 'admin',
  editSettings: (r: Role) => r === 'owner',
  viewBackup: (r: Role) => r === 'owner',
  viewAudit: (r: Role) => r === 'owner' || r === 'admin',
  /**
   * Balances (list, net, statement and running balance, side panel, Excel/PDF,
   * voucher print). Owner decision 2026-10-07: every role, data-entry users in
   * their assigned accounts (the rules already limit them to those).
   */
  seeBalances: (r: Role) => r === 'owner' || r === 'admin' || r === 'entry',
  /** On-demand backups (request + encrypted download). */
  backupNow: (r: Role) => r === 'owner' || r === 'admin',
  /** Notifications tab (signed-voucher/invoice edits, trash moves and restores). */
  viewNotifications: (r: Role) => r === 'owner' || r === 'admin',
  /** Trash screen and restoring from it. */
  restoreFromTrash: (r: Role) => r === 'owner' || r === 'admin',
  /** Archive accounts and bring them back. */
  archiveAccounts: (r: Role) => r === 'owner' || r === 'admin',
  /** Can this manager edit that user? Owner is protected; nobody edits themselves except the owner's name. */
  editUser: (actor: UserProfile, target: UserProfile) =>
    (actor.role === 'owner' || actor.role === 'admin') &&
    target.role !== 'owner' &&
    target.id !== actor.id,
  accessAccount: (u: UserProfile, accountId: string) =>
    u.role !== 'entry' || u.assignedAccounts.includes(accountId),
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Password policy (approved hardening): ≥ 10 characters with letters and digits. */
export const PASSWORD_MIN = 10;

export function validatePassword(p: string): string | null {
  if (p.length < PASSWORD_MIN) return `كلمة المرور ${PASSWORD_MIN} أحرف على الأقل.`;
  if (p.length > 128) return 'كلمة المرور أطول من 128 حرفاً.';
  if (!/[A-Za-z\u0621-\u064A]/.test(p)) return 'يجب أن تحتوي كلمة المرور على حروف.';
  if (!/[0-9\u0660-\u0669]/.test(p)) return 'يجب أن تحتوي كلمة المرور على أرقام.';
  if (/\s/.test(p)) return 'كلمة المرور لا تحتوي مسافات.';
  return null;
}

export function validateUserForm(v: {
  name: string;
  email: string;
}): Partial<Record<'name' | 'email', string>> {
  const errors: Partial<Record<'name' | 'email', string>> = {};
  const name = cleanText(v.name);
  if (!name) errors.name = 'أدخل الاسم.';
  else if (name.length > 80) errors.name = 'الاسم أطول من 80 حرفاً.';
  const email = v.email.trim();
  if (!EMAIL.test(email) || email.length > 200) errors.email = 'أدخل بريداً إلكترونياً صحيحاً.';
  return errors;
}
