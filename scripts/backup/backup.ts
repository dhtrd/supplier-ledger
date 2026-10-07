/**
 * Backup → the owner's Dropbox (run by .github/workflows/backup.yml).
 *
 *   node scripts/backup/backup.ts             daily run (12:00 Riyadh)
 *   node scripts/backup/backup.ts --requests  on-demand: runs only if a
 *                                             manager pressed «نسخة الآن»
 *
 * 1. Moves new original images (≤ 300 KB each) out of Firestore into
 *    /attachments/<account>/<id>.<ext> and stores a view link instead; the
 *    small thumbnail stays in Firestore.
 * 2. Writes every document, AES-256-GCM encrypted, to
 *    /backups/YYYY-MM-DD/data[-hh-mm-ssص|م].json.enc, Riyadh time (key: BACKUP_ENCRYPTION_KEY).
 * 3. Deletes backup folders older than 30 days (images are never deleted —
 *    they are the only copy of the originals).
 * 4. Removes notifications older than 90 days (they stay in the backups).
 * 5. Records meta/backup for the owner's Settings page.
 *
 * Nothing is printed except counts (the repository and its logs are public).
 * Any failure exits non-zero.
 *
 * Env: FIREBASE_SERVICE_ACCOUNT, DROPBOX_APP_KEY, DROPBOX_APP_SECRET,
 *      DROPBOX_REFRESH_TOKEN, BACKUP_ENCRYPTION_KEY
 */
import { FieldValue, Timestamp, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb, flag, runMain } from '../lib/admin.ts';
import {
  deletePath,
  dropboxToken,
  expiredBackupFolders,
  listFolderNames,
  sharedLink,
  upload,
} from '../lib/dropbox.ts';
import { encryptText } from '../../src/shared/lib/backupCrypto.ts';
import { fileStamp, todayRiyadh } from '../../src/shared/lib/dates.ts';
import { encode, type Snapshot } from './snapshot.ts';
import { syncTotals } from '../lib/totals.ts';

const COLLECTIONS = [
  'users',
  'settings',
  'counters',
  'accounts',
  'signLinks',
  'auditLog',
  'meta',
  'lockouts',
  'backupRequests',
  'notifications',
];
const RETENTION_DAYS = 30;
/** Notifications are kept 90 days (approved spec); older ones are in the backups. */
const NOTIFICATION_DAYS = 90;

function backupKey(): string {
  const k = process.env.BACKUP_ENCRYPTION_KEY;
  if (!k) throw new Error('Missing environment variable BACKUP_ENCRYPTION_KEY');
  return k;
}

runMain(async () => {
  const db = adminDb();
  const key = backupKey();

  let requests: QueryDocumentSnapshot[] = [];
  if (flag('requests')) {
    requests = (
      await db.collection('backupRequests').where('status', '==', 'pending').limit(20).get()
    ).docs;
    if (!requests.length) {
      console.log('no pending backup requests');
      return;
    }
  }

  try {
    const token = await dropboxToken();

    // ---- 1. move original images to Dropbox --------------------------------
    let moved = 0;
    let moveError: unknown = null;
    const accounts = (await db.collection('accounts').get()).docs;
    for (const acc of accounts) {
      const pending = await acc.ref.collection('attachments').where('data', '!=', null).get();
      for (const d of pending.docs) {
        try {
          const { data, mime } = d.data() as { data: Uint8Array; mime: string };
          const ext = mime === 'image/webp' ? 'webp' : 'jpg';
          const path = `/attachments/${acc.id}/${d.id}.${ext}`;
          await upload(token, path, data);
          const url = await sharedLink(token, path);
          await d.ref.update({
            url,
            dropboxPath: path,
            movedAt: Timestamp.now(),
            data: FieldValue.delete(),
          });
          moved++;
        } catch (e) {
          moveError ??= e; // keep going; report after the data backup is safe
        }
      }
    }

    // ---- 2. encrypted snapshot ---------------------------------------------
    const snapshot: Snapshot = { version: 1, takenAt: Date.now(), docs: {} };
    for (const name of COLLECTIONS)
      for (const d of (await db.collection(name).get()).docs)
        snapshot.docs[d.ref.path] = encode(d.data());
    for (const acc of accounts) {
      for (const sub of ['entries', 'attachments'])
        for (const d of (await acc.ref.collection(sub).get()).docs)
          snapshot.docs[d.ref.path] = encode(d.data());
    }
    const json = JSON.stringify(snapshot);
    const envelope = await encryptText(json, { key });
    // Riyadh date folder; on-demand copies carry a 12-hour time stamp.
    const day = todayRiyadh(new Date(snapshot.takenAt));
    const file = requests.length
      ? `/backups/${day}/data-${fileStamp(snapshot.takenAt, true).slice(11)}.json.enc`
      : `/backups/${day}/data.json.enc`;
    await upload(token, file, JSON.stringify(envelope));
    const docs = Object.keys(snapshot.docs).length;

    // ---- 3. retention ------------------------------------------------------
    const expired = expiredBackupFolders(
      await listFolderNames(token, '/backups'),
      day,
      RETENTION_DAYS,
    );
    for (const name of expired) await deletePath(token, `/backups/${name}`);

    // Daily run only, after the snapshot above holds them.
    let oldNotes = 0;
    if (!requests.length) {
      const cutoff = Timestamp.fromMillis(snapshot.takenAt - NOTIFICATION_DAYS * 86_400_000);
      const old = await db.collection('notifications').where('at', '<', cutoff).limit(450).get();
      if (!old.empty) {
        const batch = db.batch();
        for (const d of old.docs) batch.delete(d.ref);
        await batch.commit();
        oldNotes = old.size;
      }
    }

    // Daily: verify every account's running totals (also initialises new ones).
    let totalsNote = '';
    if (!requests.length) {
      const t = await syncTotals(db);
      totalsNote = `, totals ${t.initialised} initialised / ${t.corrected.length} corrected`;
      // Visible in the Actions run (no names/amounts: the logs are public).
      if (t.corrected.length)
        console.log(
          `::warning::${t.corrected.length} account totals were wrong and were corrected`,
        );
    }

    // ---- 4. status ---------------------------------------------------------
    await db.doc('meta/backup').set({
      lastBackupAt: Timestamp.fromMillis(snapshot.takenAt),
      docs,
      images: moved,
      // Firestore holds only documents + thumbnails now; JSON size ≈ usage.
      bytes: Buffer.byteLength(json),
      encrypted: true,
    });
    for (const r of requests) await r.ref.update({ status: 'done', doneAt: Timestamp.now(), file });
    console.log(
      `backup ok: ${docs} documents, ${moved} images moved, ${expired.length} old folders removed, ${oldNotes} old notifications removed${totalsNote}`,
    );
    if (moveError)
      throw new Error(
        `data backup saved, but moving an image failed: ${moveError instanceof Error ? moveError.message : 'unknown'}`,
      );
  } catch (e) {
    for (const r of requests)
      await r.ref
        .update({
          status: 'failed',
          doneAt: Timestamp.now(),
          message: 'فشل النسخ — راجع GitHub Actions',
        })
        .catch((err: unknown) =>
          console.error(
            'could not mark request as failed:',
            err instanceof Error ? err.message : err,
          ),
        );
    throw e;
  }
});
