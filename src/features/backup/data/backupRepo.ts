import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase/firestore';
import { millis, str } from '../../../shared/lib/firestore';
import { encodeValue, type Snapshot } from '../domain/snapshot';

/** Asks GitHub Actions for an immediate Dropbox backup (picked up within ~15 min). */
export async function requestBackup(db: Firestore, uid: string): Promise<void> {
  await addDoc(collection(db, 'backupRequests'), {
    requestedBy: uid,
    requestedAt: serverTimestamp(),
    status: 'pending',
  });
}

export interface BackupRequest {
  id: string;
  requestedBy: string;
  requestedAtMs: number;
  status: 'pending' | 'done' | 'failed';
  doneAtMs: number;
  message: string;
}

export async function listBackupRequests(db: Firestore, max = 5): Promise<BackupRequest[]> {
  const snap = await getDocs(
    query(collection(db, 'backupRequests'), orderBy('requestedAt', 'desc'), limit(max)),
  );
  return snap.docs.map((s) => {
    const d = s.data();
    const st = str(d.status);
    return {
      id: s.id,
      requestedBy: str(d.requestedBy),
      requestedAtMs: millis(d.requestedAt),
      status: st === 'done' || st === 'failed' ? st : 'pending',
      doneAtMs: millis(d.doneAt),
      message: str(d.message),
    };
  });
}

/**
 * Reads every document a manager may read into one snapshot (same format as
 * the Dropbox backups). Roughly one read per document.
 */
export async function exportSnapshot(
  db: Firestore,
  opts: { includeMeta: boolean },
  onProgress?: (docs: number) => void,
): Promise<Snapshot> {
  const docs: Snapshot['docs'] = {};
  const put = (s: DocumentSnapshot) => {
    if (!s.exists()) return;
    docs[s.ref.path] = encodeValue(s.data());
    onProgress?.(Object.keys(docs).length);
  };
  const all = async (path: string) => (await getDocs(collection(db, path))).docs.forEach(put);

  put(await getDoc(doc(db, 'settings', 'app')));
  put(await getDoc(doc(db, 'counters', 'vouchers')));
  if (opts.includeMeta) put(await getDoc(doc(db, 'meta', 'backup')));
  await all('users');
  await all('signLinks');
  await all('auditLog');
  await all('backupRequests');
  const accounts = await getDocs(collection(db, 'accounts'));
  for (const a of accounts.docs) {
    put(a);
    await all(`accounts/${a.id}/entries`);
    await all(`accounts/${a.id}/attachments`);
  }
  return { version: 1, takenAt: Date.now(), docs };
}
