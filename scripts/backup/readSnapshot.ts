/** Opens any backup format (encrypted envelope or plain JSON). */
import { decryptText, isEnvelope } from '../../src/shared/lib/backupCrypto.ts';
import type { Snapshot } from './snapshot.ts';

export async function readSnapshot(text: string): Promise<Snapshot> {
  const parsed = JSON.parse(text) as unknown;
  if (!isEnvelope(parsed)) return parsed as Snapshot;
  if (parsed.kdf) {
    const passphrase = process.env.BACKUP_PASSPHRASE;
    if (!passphrase) throw new Error('Set BACKUP_PASSPHRASE to open this backup.');
    return JSON.parse(await decryptText(parsed, { passphrase })) as Snapshot;
  }
  const key = process.env.BACKUP_ENCRYPTION_KEY;
  if (!key) throw new Error('Set BACKUP_ENCRYPTION_KEY to open this backup.');
  return JSON.parse(await decryptText(parsed, { key })) as Snapshot;
}
