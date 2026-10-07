import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  type Auth,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase/firestore';
import { AppError } from '../../../core/errors';
import { bool, str, strList } from '../../../shared/lib/firestore';
import type { Role, UserProfile } from '../domain/types';

export function toProfile(s: DocumentSnapshot): UserProfile {
  const d = s.data() ?? {};
  const r = str(d.role);
  return {
    id: s.id,
    name: str(d.name),
    email: str(d.email),
    role: r === 'owner' || r === 'admin' ? r : 'entry',
    active: bool(d.active),
    assignedAccounts: strList(d.assignedAccounts),
  };
}

export function watchProfile(
  db: Firestore,
  uid: string,
  next: (p: UserProfile | null) => void,
  fail: (e: unknown) => void,
): () => void {
  return onSnapshot(doc(db, 'users', uid), (s) => next(s.exists() ? toProfile(s) : null), fail);
}

export async function listUsers(db: Firestore): Promise<UserProfile[]> {
  const snap = await getDocs(collection(db, 'users'));
  const order: Record<Role, number> = { owner: 0, admin: 1, entry: 2 };
  return snap.docs
    .map(toProfile)
    .sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name, 'ar'));
}

export interface UserInput {
  name: string;
  email: string;
  role: 'admin' | 'entry';
  active: boolean;
  assignedAccounts: string[];
}

/**
 * Creates the login with the initial password the manager typed (on a
 * throw-away secondary auth instance, so the manager stays signed in). The
 * password is never stored or logged by the app; later changes go through the
 * reset email sent to the user's own address.
 */
export async function createUser(
  db: Firestore,
  actorUid: string,
  input: UserInput,
  initialPassword: string,
  secondary: <T>(work: (auth: Auth) => Promise<T>) => Promise<T>,
): Promise<string> {
  const email = input.email.trim().toLowerCase();
  const uid = await secondary(async (auth) => {
    const cred = await createUserWithEmailAndPassword(auth, email, initialPassword);
    await signOut(auth);
    return cred.user.uid;
  });
  try {
    await setDoc(doc(db, 'users', uid), {
      name: input.name.trim(),
      email,
      role: input.role,
      active: input.active,
      assignedAccounts: input.role === 'entry' ? input.assignedAccounts : [],
      createdAt: serverTimestamp(),
      createdBy: actorUid,
    });
  } catch (e) {
    throw new AppError(
      `أُنشئ حساب الدخول للبريد ${email} لكن تعذّر حفظ صلاحياته. ` +
        'لن يستطيع الدخول للبيانات. احذف المستخدم من Firebase Authentication ثم أعد المحاولة. ' +
        `(${e instanceof Error ? e.message : 'unknown'})`,
    );
  }
  return uid;
}

export async function updateUser(
  db: Firestore,
  actorUid: string,
  uid: string,
  input: Omit<UserInput, 'email'>,
): Promise<void> {
  await updateDoc(doc(db, 'users', uid), {
    name: input.name.trim(),
    role: input.role,
    active: input.active,
    assignedAccounts: input.role === 'entry' ? input.assignedAccounts : [],
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });
}

/** The owner may change only his own display name. */
export async function renameSelf(db: Firestore, uid: string, name: string): Promise<void> {
  await updateDoc(doc(db, 'users', uid), {
    name: name.trim(),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

export async function sendReset(auth: Auth, email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
}
