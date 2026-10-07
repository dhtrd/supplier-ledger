/**
 * Restores a backup snapshot (data.json downloaded from Dropbox).
 *
 *   node scripts/backup/restore.ts --file data.json --confirm <projectId>
 *
 * Refuses to run unless --confirm matches the target project id, so a restore
 * can never hit the wrong project by accident. Image bytes are restored
 * separately from /attachments (documents keep a pointer to the file).
 */
import { readFileSync } from 'node:fs';
import { adminApp, adminDb, arg, runMain } from '../lib/admin.ts';
import { decode, type Snapshot } from './snapshot.ts';

runMain(async () => {
  const file = arg('file');
  if (!file) throw new Error('Usage: --file <data.json> --confirm <projectId>');
  const db = adminDb();
  const projectId = adminApp().options.projectId ?? process.env.FIREBASE_PROJECT_ID ?? '';
  if (!projectId) throw new Error('Cannot determine the target project id.');
  if (arg('confirm') !== projectId)
    throw new Error(`Refusing: pass --confirm ${projectId} to restore into this project.`);

  const snapshot = JSON.parse(readFileSync(file, 'utf8')) as Snapshot;
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
