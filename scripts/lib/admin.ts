/**
 * Firebase Admin bootstrap for maintenance scripts (migration, backup,
 * restore, owner bootstrap). Credentials come ONLY from the environment:
 *  - FIREBASE_SERVICE_ACCOUNT: the service-account JSON (CI secret), or
 *  - GOOGLE_APPLICATION_CREDENTIALS: path to the JSON file (local runs), or
 *  - FIRESTORE_EMULATOR_HOST: talk to the local emulator (tests / dry runs).
 * Nothing is ever printed from the credentials.
 */
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

export function adminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const json = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return initializeApp({ projectId: projectId ?? 'demo-supplier-ledger' });
  }
  if (json) {
    const parsed = JSON.parse(json) as {
      project_id: string;
      client_email: string;
      private_key: string;
    };
    return initializeApp({
      credential: cert({
        projectId: parsed.project_id,
        clientEmail: parsed.client_email,
        privateKey: parsed.private_key,
      }),
      projectId: parsed.project_id,
    });
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS)
    return initializeApp(projectId ? { projectId } : undefined);
  throw new Error(
    'No credentials: set FIREBASE_SERVICE_ACCOUNT, GOOGLE_APPLICATION_CREDENTIALS or FIRESTORE_EMULATOR_HOST.',
  );
}

export function adminDb(): Firestore {
  return getFirestore(adminApp());
}

/** Fails loudly (non-zero exit) — never swallow errors in maintenance jobs. */
export function runMain(main: () => Promise<void>): void {
  main().catch((err: unknown) => {
    console.error('FAILED:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
