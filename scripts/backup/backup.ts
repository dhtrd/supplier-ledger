/**
 * Daily backup → the owner's Dropbox (run by .github/workflows/backup.yml).
 *
 * Writes /backups/YYYY-MM-DD/data.json (every document except image bytes)
 * and uploads only NEW images to /attachments/<account>/<id>.<ext>. Then
 * records meta/backup.lastBackupAt, which the owner sees in Settings with a
 * warning if it is older than 26 hours. Any failure exits non-zero so GitHub
 * reports it — nothing is swallowed. Data is never printed to the log
 * (the repository and its Actions logs are public).
 *
 * Env: FIREBASE_SERVICE_ACCOUNT, DROPBOX_APP_KEY, DROPBOX_APP_SECRET,
 *      DROPBOX_REFRESH_TOKEN
 */
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb, runMain } from '../lib/admin.ts';
import { encode, type Snapshot } from './snapshot.ts';

const COLLECTIONS = ['users', 'settings', 'counters', 'accounts', 'signLinks', 'auditLog', 'meta'];

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

async function dropboxToken(): Promise<string> {
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: need('DROPBOX_REFRESH_TOKEN'),
      client_id: need('DROPBOX_APP_KEY'),
      client_secret: need('DROPBOX_APP_SECRET'),
    }),
  });
  if (!res.ok) throw new Error(`Dropbox auth failed (HTTP ${res.status})`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function upload(token: string, path: string, body: Uint8Array | string): Promise<void> {
  const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      // Dropbox-API-Arg must be ASCII; paths here are ASCII by construction.
      'Dropbox-API-Arg': JSON.stringify({ path, mode: 'overwrite', mute: true }),
    },
    body: typeof body === 'string' ? body : Buffer.from(body),
  });
  if (!res.ok) throw new Error(`Dropbox upload failed for ${path} (HTTP ${res.status})`);
}

runMain(async () => {
  const db = adminDb();
  const token = await dropboxToken();
  const meta = await db.doc('meta/backup').get();
  const since = (meta.get('lastBackupAt') as Timestamp | undefined)?.toMillis() ?? 0;

  const snapshot: Snapshot = { version: 1, takenAt: Date.now(), docs: {} };
  let images = 0;
  for (const name of COLLECTIONS) {
    for (const d of (await db.collection(name).get()).docs)
      snapshot.docs[d.ref.path] = encode(d.data());
  }
  for (const acc of (await db.collection('accounts').get()).docs) {
    for (const d of (await acc.ref.collection('entries').get()).docs)
      snapshot.docs[d.ref.path] = encode(d.data());
    for (const d of (await acc.ref.collection('attachments').get()).docs) {
      const { data, ...rest } = d.data() as {
        data: Uint8Array;
        mime: string;
        createdAt: Timestamp;
      };
      snapshot.docs[d.ref.path] = encode({ ...rest, file: `/attachments/${acc.id}/${d.id}` });
      if (rest.createdAt.toMillis() > since) {
        const ext = rest.mime === 'image/webp' ? 'webp' : 'jpg';
        await upload(token, `/attachments/${acc.id}/${d.id}.${ext}`, data);
        images++;
      }
    }
  }

  const day = new Date(snapshot.takenAt).toISOString().slice(0, 10);
  await upload(token, `/backups/${day}/data.json`, JSON.stringify(snapshot));
  const docs = Object.keys(snapshot.docs).length;
  await db
    .doc('meta/backup')
    .set({ lastBackupAt: Timestamp.fromMillis(snapshot.takenAt), docs, images });
  console.log(`backup ok: ${docs} documents, ${images} new images`);
});
