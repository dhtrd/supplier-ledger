/**
 * Firebase web config comes only from build-time env (GitHub repository
 * variables). These values identify the project and are public by design;
 * access is protected by firestore.rules, not by hiding them.
 */
export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  messagingSenderId: string;
}

const KEYS = {
  apiKey: 'VITE_FIREBASE_API_KEY',
  authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
  projectId: 'VITE_FIREBASE_PROJECT_ID',
  appId: 'VITE_FIREBASE_APP_ID',
  messagingSenderId: 'VITE_FIREBASE_MESSAGING_SENDER_ID',
} as const;

export type ConfigResult =
  { ok: true; config: FirebaseWebConfig } | { ok: false; missing: string[] };

export function readConfig(env: Record<string, string | boolean | undefined>): ConfigResult {
  const missing: string[] = [];
  const out: Partial<FirebaseWebConfig> = {};
  for (const [field, envName] of Object.entries(KEYS) as [keyof FirebaseWebConfig, string][]) {
    const v = env[envName];
    if (typeof v !== 'string' || v.trim() === '') missing.push(envName);
    else out[field] = v.trim();
  }
  return missing.length ? { ok: false, missing } : { ok: true, config: out as FirebaseWebConfig };
}
