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
  /** Can this manager edit that user? Owner is protected; nobody edits themselves except the owner's name. */
  editUser: (actor: UserProfile, target: UserProfile) =>
    (actor.role === 'owner' || actor.role === 'admin') &&
    target.role !== 'owner' &&
    target.id !== actor.id,
  accessAccount: (u: UserProfile, accountId: string) =>
    u.role !== 'entry' || u.assignedAccounts.includes(accountId),
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateUserForm(v: {
  name: string;
  email: string;
}): Partial<Record<'name' | 'email', string>> {
  const errors: Partial<Record<'name' | 'email', string>> = {};
  const name = v.name.trim();
  if (!name) errors.name = 'أدخل الاسم.';
  else if (name.length > 80) errors.name = 'الاسم أطول من 80 حرفاً.';
  const email = v.email.trim();
  if (!EMAIL.test(email) || email.length > 200) errors.email = 'أدخل بريداً إلكترونياً صحيحاً.';
  return errors;
}
