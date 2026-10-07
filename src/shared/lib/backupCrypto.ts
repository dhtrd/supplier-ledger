/**
 * Encrypted backup envelope (AES-256-GCM via WebCrypto — the same code runs in
 * the browser and in Node 22 scripts). Two key sources:
 *  - a 32-byte key (base64) kept in GitHub Secrets for the automatic backups;
 *  - a passphrase typed by the owner/admin for on-device downloads
 *    (PBKDF2-SHA256, 310,000 iterations — OWASP 2023 guidance).
 * No imports, so Node scripts can load it directly.
 */

export const ENVELOPE_FORMAT = 'supplier-ledger-backup';
export const PBKDF2_ITERATIONS = 310_000;
export const PASSPHRASE_MIN = 10;

export interface Envelope {
  format: typeof ENVELOPE_FORMAT;
  v: 1;
  enc: 'AES-256-GCM';
  kdf: null | { name: 'PBKDF2-SHA256'; iterations: number; salt: string };
  iv: string;
  /** base64(ciphertext || 16-byte GCM tag) */
  data: string;
}

const subtle = () => globalThis.crypto.subtle;
type Key = Awaited<ReturnType<ReturnType<typeof subtle>['importKey']>>;
/** Fresh ArrayBuffer copy (accepted as BufferSource by both DOM and Node typings). */
const ab = (u: Uint8Array): ArrayBuffer => u.slice().buffer as ArrayBuffer;

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function random(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

async function keyFromRaw(rawB64: string): Promise<Key> {
  const raw = fromBase64(rawB64.trim());
  if (raw.length !== 32) throw new Error('Backup key must be 32 bytes (base64).');
  return subtle().importKey('raw', ab(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function keyFromPassphrase(passphrase: string, salt: Uint8Array, iterations: number) {
  const base = await subtle().importKey(
    'raw',
    ab(new TextEncoder().encode(passphrase)),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: ab(salt), iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export type Secret = { key: string } | { passphrase: string };

export async function encryptText(plain: string, secret: Secret): Promise<Envelope> {
  const iv = random(12);
  let key: Key;
  let kdf: Envelope['kdf'] = null;
  if ('key' in secret) key = await keyFromRaw(secret.key);
  else {
    if (secret.passphrase.length < PASSPHRASE_MIN)
      throw new Error(`Passphrase must be at least ${PASSPHRASE_MIN} characters.`);
    const salt = random(16);
    key = await keyFromPassphrase(secret.passphrase, salt, PBKDF2_ITERATIONS);
    kdf = { name: 'PBKDF2-SHA256', iterations: PBKDF2_ITERATIONS, salt: toBase64(salt) };
  }
  const ct = new Uint8Array(
    await subtle().encrypt(
      { name: 'AES-GCM', iv: ab(iv) },
      key,
      ab(new TextEncoder().encode(plain)),
    ),
  );
  return {
    format: ENVELOPE_FORMAT,
    v: 1,
    enc: 'AES-256-GCM',
    kdf,
    iv: toBase64(iv),
    data: toBase64(ct),
  };
}

export function isEnvelope(x: unknown): x is Envelope {
  return !!x && typeof x === 'object' && (x as { format?: unknown }).format === ENVELOPE_FORMAT;
}

/** Throws on a wrong key/passphrase or any tampering (GCM authentication). */
export async function decryptText(env: Envelope, secret: Secret): Promise<string> {
  if (env.v !== 1 || env.enc !== 'AES-256-GCM') throw new Error('Unsupported backup envelope.');
  let key: Key;
  if (env.kdf) {
    if (!('passphrase' in secret)) throw new Error('This backup needs its passphrase.');
    key = await keyFromPassphrase(secret.passphrase, fromBase64(env.kdf.salt), env.kdf.iterations);
  } else {
    if (!('key' in secret)) throw new Error('This backup needs the backup key.');
    key = await keyFromRaw(secret.key);
  }
  try {
    const plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: ab(fromBase64(env.iv)) },
      key,
      ab(fromBase64(env.data)),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error('Wrong key/passphrase, or the backup file was modified.');
  }
}
