/**
 * Checks every attachment against Dropbox and repairs what it can.
 *
 *   node scripts/backup/restore-images.ts [--fix] [--inline]
 *
 * For each attachment document:
 *  - original still in Firestore            → ok (moved by the next backup)
 *  - has a Dropbox path and the file exists → ok; with --fix, the view link is
 *                                             re-created if missing
 *  - file missing in Dropbox                → reported (exit 1)
 * --inline downloads originals back INTO Firestore (≤ 300 KB each) — only for
 * leaving Dropbox; it uses database space again.
 *
 * Env: FIREBASE_SERVICE_ACCOUNT (or GOOGLE_APPLICATION_CREDENTIALS),
 *      DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN
 */
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, flag, runMain } from '../lib/admin.ts';
import { download, dropboxToken, exists, sharedLink } from '../lib/dropbox.ts';

runMain(async () => {
  const db = adminDb();
  const token = await dropboxToken();
  const fix = flag('fix');
  const inline = flag('inline');
  let ok = 0;
  let repaired = 0;
  const missing: string[] = [];

  for (const acc of (await db.collection('accounts').get()).docs) {
    for (const d of (await acc.ref.collection('attachments').get()).docs) {
      const a = d.data() as {
        data?: Uint8Array;
        url?: string;
        dropboxPath?: string;
        mime?: string;
      };
      if (a.data) {
        ok++;
        continue;
      }
      const ext = a.mime === 'image/webp' ? 'webp' : 'jpg';
      const path = a.dropboxPath ?? `/attachments/${acc.id}/${d.id}.${ext}`;
      if (!(await exists(token, path))) {
        missing.push(d.ref.path);
        continue;
      }
      if (inline) {
        const bytes = await download(token, path);
        if (bytes.byteLength > 307_200)
          throw new Error(`${d.ref.path}: original larger than 300 KB`);
        await d.ref.update({ data: bytes, url: FieldValue.delete(), movedAt: FieldValue.delete() });
        repaired++;
      } else if (!a.url && fix) {
        await d.ref.update({ url: await sharedLink(token, path), dropboxPath: path });
        repaired++;
      } else ok++;
    }
  }
  console.log(`images: ${ok} ok, ${repaired} repaired, ${missing.length} missing`);
  if (missing.length) {
    for (const p of missing) console.error(`missing in Dropbox: ${p}`);
    throw new Error('Some originals are missing from Dropbox (thumbnails remain in Firestore).');
  }
});
