/** Maps SDK / app errors to a clear Arabic message. Never hides the failure. */
const MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'البريد أو كلمة المرور غير صحيحة.',
  'auth/wrong-password': 'البريد أو كلمة المرور غير صحيحة.',
  'auth/user-not-found': 'البريد أو كلمة المرور غير صحيحة.',
  'auth/invalid-email': 'صيغة البريد الإلكتروني غير صحيحة.',
  'auth/user-disabled': 'هذا الحساب موقوف.',
  'auth/too-many-requests': 'محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة.',
  'auth/network-request-failed': 'تعذّر الاتصال بالإنترنت.',
  'auth/email-already-in-use': 'هذا البريد مسجّل لمستخدم آخر.',
  'auth/weak-password': 'كلمة المرور ضعيفة.',
  'auth/missing-email': 'أدخل البريد الإلكتروني.',
  'permission-denied':
    'ليست لديك صلاحية لهذه العملية، أو تغيّرت البيانات. حدّث الصفحة وأعد المحاولة.',
  unavailable: 'تعذّر الاتصال بالخادم. تحقق من الإنترنت وأعد المحاولة.',
  'deadline-exceeded': 'استغرق الخادم وقتاً طويلاً. أعد المحاولة.',
  'resource-exhausted': 'تجاوزت الحصة اليومية المجانية. حاول غداً أو راجع خطة Firebase.',
  aborted: 'تعارضت العملية مع تعديل آخر في الوقت نفسه. أعد المحاولة.',
  'not-found': 'العنصر غير موجود.',
  'failed-precondition': 'العملية تحتاج إعداداً في Firebase (فهرس أو قاعدة بيانات).',
};

export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof AppError) return e.message;
  if (e && typeof e === 'object' && 'code' in e) {
    const code = String((e as { code: unknown }).code).replace(/^firestore\//, '');
    const msg = MESSAGES[code];
    if (msg) return msg;
    return `حدث خطأ غير متوقع (${code}).`;
  }
  return 'حدث خطأ غير متوقع. أعد المحاولة.';
}

/** Logs the technical detail for the developer console (no data payloads). */
export function reportError(where: string, e: unknown): void {
  const code = e && typeof e === 'object' && 'code' in e ? String(e.code) : '';
  console.error(`[${where}]`, code || (e instanceof Error ? e.message : e));
}
