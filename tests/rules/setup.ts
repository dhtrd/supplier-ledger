import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp, type Firestore } from 'firebase/firestore';

export const PROJECT_ID = 'demo-supplier-ledger';
export const ACC_A = 'accA'; // assigned to the data-entry user
export const ACC_B = 'accB'; // NOT assigned

export async function createEnv(): Promise<RulesTestEnvironment> {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
      host,
      port: Number(port),
    },
  });
}

const past = (minutesAgo: number) => Timestamp.fromMillis(Date.now() - minutesAgo * 60_000);

/** Seeds a realistic baseline with rules disabled. */
export async function seed(env: RulesTestEnvironment): Promise<void> {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    const user = (role: string, assigned: string[] = [], active = true) => ({
      name: role,
      email: `${role}@example.com`,
      role,
      active,
      assignedAccounts: assigned,
      createdAt: past(60),
      createdBy: 'bootstrap',
    });
    await setDoc(doc(db, 'users/owner'), user('owner'));
    await setDoc(doc(db, 'users/admin'), user('admin'));
    await setDoc(doc(db, 'users/entry'), user('entry', [ACC_A]));
    await setDoc(doc(db, 'users/inactive'), user('entry', [ACC_A], false));
    await setDoc(doc(db, 'settings/app'), {
      linkMinutes: 60,
      payerName: 'شركة الضبيبي',
      roleLabels: { owner: 'المالك', admin: 'الإدارة', entry: 'مدخل البيانات' },
      ownerUid: 'owner',
    });
    await setDoc(doc(db, 'counters/vouchers'), { next: 100 });
    await setDoc(doc(db, 'meta/backup'), { lastBackupAt: past(30) });
    for (const id of [ACC_A, ACC_B]) {
      await setDoc(doc(db, `accounts/${id}`), {
        name: `حساب ${id}`,
        phone: '0500000000',
        group: 'suppliers',
        deleted: false,
        createdAt: past(60),
        createdBy: 'owner',
      });
      await setDoc(doc(db, `accounts/${id}/entries/inv1`), {
        type: 'invoice',
        amount: 100000,
        signed: 100000,
        date: '2026-09-01',
        details: 'فاتورة',
        attachments: [],
        deleted: false,
        createdAt: past(50),
        createdBy: 'owner',
      });
      await setDoc(doc(db, `accounts/${id}/entries/pay1`), {
        type: 'payment',
        amount: 50000,
        signed: -50000,
        date: '2026-09-02',
        details: 'دفعة',
        attachments: [],
        voucherNo: 99,
        deleted: false,
        createdAt: past(40),
        createdBy: 'owner',
      });
    }
  });
}

export { past };
