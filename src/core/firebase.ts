import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import {
  clearIndexedDbPersistence,
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  terminate,
  type Firestore,
} from 'firebase/firestore';
import { stopAllSharedWatches } from '../shared/lib/sharedWatch';
import { readConfig, type FirebaseWebConfig } from './config';

export interface FirebaseHandles {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  config: FirebaseWebConfig;
}

const useEmulators = import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === 'true';

let handles: FirebaseHandles | null = null;

/** Returns the initialised SDK, or the list of missing env vars. */
export function firebase(): FirebaseHandles | { missing: string[] } {
  if (handles) return handles;
  const res = readConfig(import.meta.env);
  if (!res.ok) return { missing: res.missing };
  const app = initializeApp(res.config);
  // App Check proves requests come from this site (enforce it in the Firebase
  // console once traffic shows as verified). Skipped against the emulators.
  const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
  if (!useEmulators && typeof siteKey === 'string' && siteKey.trim())
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey.trim()),
      isTokenAutoRefreshEnabled: true,
    });
  const auth = getAuth(app);
  // Device cache (owner decision 2026-10-07, fewer reads): reopening a screen
  // re-reads only what changed; live sync is unchanged. It is wiped at every
  // sign-out (see wipeLocalData). If IndexedDB is unavailable (private mode)
  // the SDK falls back to a memory cache by itself.
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  if (useEmulators) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
  handles = { app, auth, db, config: res.config };
  return handles;
}

export function fb(): FirebaseHandles {
  const h = firebase();
  if (!('app' in h)) throw new Error('Firebase is not configured');
  return h;
}

/**
 * A short-lived second app instance so a manager can create a login for a new
 * user without being signed out of their own session.
 */
export async function withSecondaryAuth<T>(work: (auth: Auth) => Promise<T>): Promise<T> {
  const { config } = fb();
  const app = initializeApp(config, `secondary-${Date.now()}`);
  try {
    const auth = getAuth(app);
    if (useEmulators) connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    return await work(auth);
  } finally {
    await deleteApp(app);
  }
}

const WIPE_PENDING = 'sl:wipe-cache';

function setWipePending(on: boolean): void {
  try {
    if (on) localStorage.setItem(WIPE_PENDING, '1');
    else localStorage.removeItem(WIPE_PENDING);
  } catch {
    /* storage blocked: nothing was cached either */
  }
}

/**
 * Removes the cached ledger data from this browser (sign-out). Closes the
 * listeners and this tab's Firestore, then clears IndexedDB. If another open
 * tab still holds the cache, the wipe is remembered and done at the next start.
 * The page must reload afterwards (Firestore cannot be reused once closed).
 */
let wiping: Promise<void> | null = null;

export function wipeLocalData(): Promise<void> {
  wiping ??= doWipe();
  return wiping;
}

async function doWipe(): Promise<void> {
  if (!handles) return;
  stopAllSharedWatches();
  const { db } = handles;
  setWipePending(true);
  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
    setWipePending(false);
  } catch (e) {
    // failed-precondition: another tab still uses it; retried at next start.
    console.warn('local cache wipe deferred:', e instanceof Error ? e.message : e);
  }
}

/** At start-up, before anything reads: finish a wipe that a sign-out could not. */
export async function finishPendingWipe(): Promise<void> {
  let pending: boolean;
  try {
    pending = localStorage.getItem(WIPE_PENDING) === '1';
  } catch {
    return;
  }
  const h = firebase();
  if (!pending || !('db' in h)) return;
  try {
    await clearIndexedDbPersistence(h.db);
    setWipePending(false);
  } catch (e) {
    console.warn('local cache wipe still pending:', e instanceof Error ? e.message : e);
  }
}
