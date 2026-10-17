import {
  collection,
  deleteField,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import { AppError } from '../../../core/errors';
import {
  DOC_KINDS,
  normalizeTemplate,
  parseTemplate,
  validateTemplate,
  type AccountTemplates,
  type DocKind,
  type DocTemplate,
} from '../domain/template';

const ref = (db: Firestore, accountId: string) => doc(db, 'templates', accountId);

/** The account's templates; a missing kind means «the current document». */
export async function getTemplates(db: Firestore, accountId: string): Promise<AccountTemplates> {
  const s = await getDoc(ref(db, accountId));
  if (!s.exists()) return {};
  const out: AccountTemplates = {};
  for (const k of DOC_KINDS) {
    const t = parseTemplate(k, s.get(k));
    if (t) out[k] = t;
  }
  return out;
}

/** The stored map exactly as written (the rules compare the link's copy with it). */
export async function getRawTemplate(
  db: Firestore,
  accountId: string,
  kind: DocKind,
): Promise<Record<string, unknown> | null> {
  const s = await getDoc(ref(db, accountId));
  const v: unknown = s.exists() ? s.get(kind) : undefined;
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

/**
 * Saves one document's template (null = back to the current document).
 * Managers only. Logged in auditLog with the whole previous document
 * (owner decision 2026-10-17); a transaction so «before» is the server copy.
 */
export async function saveTemplate(
  db: Firestore,
  uid: string,
  accountId: string,
  kind: DocKind,
  t: DocTemplate | null,
): Promise<void> {
  let value: DocTemplate | ReturnType<typeof deleteField> = deleteField();
  if (t) {
    const clean = normalizeTemplate(kind, t);
    const errors = Object.values(validateTemplate(kind, clean));
    if (errors.length) throw new AppError(errors[0]!);
    value = clean;
  }
  const target = ref(db, accountId);
  const audit = doc(collection(db, 'auditLog'));
  await runTransaction(db, async (tx) => {
    const cur = await tx.get(target);
    tx.set(audit, {
      actor: uid,
      action: 'template',
      kind,
      path: target.path,
      before: cur.exists() ? cur.data() : {},
      at: serverTimestamp(),
    });
    tx.set(
      target,
      { [kind]: value, auditId: audit.id, updatedAt: serverTimestamp(), updatedBy: uid },
      { merge: true },
    );
  });
}
