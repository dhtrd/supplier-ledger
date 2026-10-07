/**
 * Creates the protected owner account and the default settings (run once).
 *
 *   node scripts/bootstrap/owner.ts --email you@example.com --name "أنور"
 *
 * The owner is the only role that can never be created from the app. No
 * password is set or printed here: the owner uses «نسيت كلمة المرور» on the
 * login screen to set one through Firebase's reset email.
 */
import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { adminApp, adminDb, arg, runMain } from '../lib/admin.ts';

runMain(async () => {
  const email = arg('email');
  const name = arg('name');
  if (!email || !name) throw new Error('Usage: --email <owner email> --name <display name>');
  const auth = getAuth(adminApp());
  const db = adminDb();

  const settings = await db.doc('settings/app').get();
  const ownerUid = settings.exists ? (settings.get('ownerUid') as string | undefined) : undefined;

  let user = await auth.getUserByEmail(email).catch(() => null);
  if (!user) user = await auth.createUser({ email, displayName: name, emailVerified: false });
  if (ownerUid && ownerUid !== user.uid)
    throw new Error('An owner already exists. Refusing to create a second owner.');

  await db.runTransaction(async (tx) => {
    tx.set(db.doc(`users/${user.uid}`), {
      name,
      email,
      role: 'owner',
      active: true,
      assignedAccounts: [],
      createdAt: FieldValue.serverTimestamp(),
      createdBy: 'bootstrap',
    });
    if (!settings.exists) {
      tx.set(db.doc('settings/app'), {
        linkMinutes: 60,
        payerName: 'شركة الضبيبي',
        roleLabels: { owner: 'المالك', admin: 'الإدارة', entry: 'مدخل البيانات' },
        ownerUid: user.uid,
      });
    }
    const counter = await tx.get(db.doc('counters/vouchers'));
    if (!counter.exists) tx.set(db.doc('counters/vouchers'), { next: 0 });
  });
  console.log(
    `owner ready: ${email}. Set the password with «نسيت كلمة المرور» on the login screen.`,
  );
});
