import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
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
  const auth = getAuth(app);
  // Memory cache only (the default): no ledger data is left in the browser
  // after logout on a shared device.
  const db = getFirestore(app);
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
