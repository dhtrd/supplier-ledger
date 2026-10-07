/**
 * Fingerprint / face unlock on this device (WebAuthn platform authenticator
 * with the PRF extension).
 *
 * The rules cannot verify a WebAuthn signature (no Cloud Functions), so the
 * fingerprint does not talk to the server directly. Instead, when it is
 * enabled the PIN proof is encrypted with a key that only the authenticator
 * can produce after the fingerprint/face check (PRF output). Unlocking with
 * the fingerprint decrypts that proof and sends it exactly like a typed PIN,
 * so it goes through the same server check and 5-attempt counter.
 *
 * Devices whose authenticator lacks PRF simply don't offer the option.
 */
import { fromBase64, toBase64 } from '../../../shared/lib/backupCrypto';

const STORE = (uid: string) => `sl:bio:${uid}`;
const ab = (u: Uint8Array): ArrayBuffer => u.slice().buffer;

interface Stored {
  v: 1;
  credId: string;
  salt: string;
  iv: string;
  ct: string;
  /** PIN this proof belongs to (screenLocks.pinVer). */
  pinVer: string;
}

function read(uid: string): Stored | null {
  try {
    const raw = localStorage.getItem(STORE(uid));
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Stored>;
    return s.v === 1 &&
      typeof s.credId === 'string' &&
      typeof s.salt === 'string' &&
      typeof s.iv === 'string' &&
      typeof s.ct === 'string' &&
      typeof s.pinVer === 'string'
      ? (s as Stored)
      : null;
  } catch {
    return null;
  }
}

export function hasBiometric(uid: string): boolean {
  return read(uid) !== null;
}

export function disableBiometric(uid: string): void {
  try {
    localStorage.removeItem(STORE(uid));
  } catch {
    /* nothing stored */
  }
}

/** A fingerprint reader / face camera exists and is set up on this device. */
export async function platformAuthenticatorAvailable(): Promise<boolean> {
  try {
    return (
      typeof PublicKeyCredential !== 'undefined' &&
      (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
    );
  } catch {
    return false;
  }
}

async function aesKey(prfOutput: ArrayBuffer): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: new TextEncoder().encode('supplier-ledger quick unlock v1'),
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

type PrfResults = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };

async function prfFromGet(credId: Uint8Array, salt: Uint8Array): Promise<ArrayBuffer> {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: ab(credId) }],
      userVerification: 'required',
      timeout: 60_000,
      extensions: { prf: { eval: { first: ab(salt) } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  const out = (cred?.getClientExtensionResults() as PrfResults | undefined)?.prf?.results?.first;
  if (!out) throw new BiometricUnsupported();
  return out;
}

export class BiometricUnsupported extends Error {
  constructor() {
    super('هذا الجهاز أو المتصفح لا يدعم فتح البرنامج بالبصمة أو الوجه.');
  }
}

/** Register the fingerprint/face here and keep the PIN proof encrypted. */
export async function enableBiometric(
  user: { uid: string; email: string; name: string },
  proof: string,
  pinVer: string,
): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: 'دفتر الموردين' },
      user: {
        id: new TextEncoder().encode(user.uid).slice(0, 64),
        name: user.email,
        displayName: user.name,
      },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'discouraged',
      },
      timeout: 60_000,
      extensions: { prf: { eval: { first: ab(salt) } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new BiometricUnsupported();
  const ext = cred.getClientExtensionResults() as PrfResults;
  if (ext.prf?.enabled === false || (!ext.prf?.enabled && !ext.prf?.results))
    throw new BiometricUnsupported();
  const credId = new Uint8Array(cred.rawId);
  // Some authenticators return the PRF output on create; others only on get.
  const out = ext.prf?.results?.first ?? (await prfFromGet(credId, salt));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ab(iv) },
    await aesKey(out),
    new TextEncoder().encode(proof),
  );
  const stored: Stored = {
    v: 1,
    credId: toBase64(credId),
    salt: toBase64(salt),
    iv: toBase64(iv),
    ct: toBase64(new Uint8Array(ct)),
    pinVer,
  };
  localStorage.setItem(STORE(user.uid), JSON.stringify(stored));
}

export type BiometricProof =
  | { kind: 'proof'; proof: string }
  /** The PIN was changed (maybe on another device): this key is outdated. */
  | { kind: 'stale' }
  | { kind: 'none' };

/** Ask for the fingerprint/face and recover the PIN proof. */
export async function biometricProof(uid: string, currentPinVer: string): Promise<BiometricProof> {
  const s = read(uid);
  if (!s) return { kind: 'none' };
  if (s.pinVer !== currentPinVer) {
    disableBiometric(uid);
    return { kind: 'stale' };
  }
  const out = await prfFromGet(fromBase64(s.credId), fromBase64(s.salt));
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ab(fromBase64(s.iv)) },
    await aesKey(out),
    ab(fromBase64(s.ct)),
  );
  return { kind: 'proof', proof: new TextDecoder().decode(plain) };
}

/** Arabic text for WebAuthn failures (the browser's own messages are English). */
export function biometricErrorMessage(e: unknown): string | null {
  if (e instanceof BiometricUnsupported) return e.message;
  if (!(e instanceof DOMException)) return null;
  switch (e.name) {
    case 'NotAllowedError':
      return 'أُلغي التحقق بالبصمة/الوجه أو انتهت مهلته.';
    case 'InvalidStateError':
      return 'البصمة/الوجه مسجّلة لهذا الحساب على هذا الجهاز مسبقاً.';
    case 'SecurityError':
      return 'المتصفح منع البصمة/الوجه على هذا العنوان.';
    case 'NotSupportedError':
      return 'هذا الجهاز أو المتصفح لا يدعم فتح البرنامج بالبصمة أو الوجه.';
    case 'OperationError':
      return 'تعذّر فك مفتاح البصمة. اكتب الرمز، ثم أعد تفعيل البصمة من «حسابي».';
    default:
      return null;
  }
}
