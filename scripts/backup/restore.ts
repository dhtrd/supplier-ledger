/**
 * Restores a backup into Firestore.
 *
 *   node scripts/backup/restore.ts --file data.json.enc --confirm <projectId>
 *
 * Accepts the encrypted Dropbox backups (key from BACKUP_ENCRYPTION_KEY), the
 * passphrase-protected on-device downloads (*.slbackup, passphrase from
 * BACKUP_PASSPHRASE) and old plain data.json files. Refuses to run unless
 * --confirm matches the target project id. Images: documents keep their
 * thumbnail and Dropbox link; run restore-images.ts to verify/relink.
 */
import { readFileSync } from 'node:fs';
import { adminApp, adminDb, arg, runMain } from '../lib/admin.ts';
import { decode } from './snapshot.ts';
import { readSnapshot } from './readSnapshot.ts';

runMain(async () => {
  const file = arg('file');
  if (!file) throw new Error('Usage: --file <backup> --confirm <projectId>');
  const db = adminDb();
  const projectId = adminApp().options.projectId ?? process.env.FIREBASE_PROJECT_ID ?? '';
  if (!projectId) throw new Error('Cannot determine the target project id.');
  if (arg('confirm') !== projectId)
    throw new Error(`Refusing: pass --confirm ${projectId} to restore into this project.`);

  const snapshot = await readSnapshot(readFileSync(file, 'utf8'));
  if (snapshot.version !== 1)
    throw new Error(`Unsupported snapshot version ${String(snapshot.version)}`);
  let batch = db.batch();
  let ops = 0;
  let total = 0;
  for (const [path, data] of Object.entries(snapshot.docs)) {
    batch.set(db.doc(path), decode(data) as Record<string, unknown>);
    total++;
    if (++ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops) await batch.commit();
  console.log(`restored ${total} documents`);
});
