/** Owner decisions 2026-10-07 (2): 15-minute lock expiry, no voucher-number gaps. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, Timestamp, updateDoc, type Firestore } from 'firebase/firestore';
import { ACC_A, createEnv, seed } from './setup';
import { getAccounts } from '../../src/features/accounts/data/accountsRepo';
import { getFailures, recordFailure } from '../../src/features/auth/data/lockoutRepo';
import { emailKey } from '../../src/features/auth/domain/lockout';
import { createEntry } from '../../src/features/ledger/data/entriesRepo';

let env: RulesTestEnvironment;
const withEmail = (uid: string) =>
  env
    .authenticatedContext(uid, { email: `${uid}@example.com` })
    .firestore() as unknown as Firestore;
const anon = () => env.unauthenticatedContext().firestore() as unknown as Firestore;

beforeAll(async () => {
  env = await createEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await seed(env);
});

const setLock = async (minutesAgo: number) => {
  const key = await emailKey('entry@example.com');
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore() as unknown as Firestore, 'lockouts', key), {
      fails: 5,
      lastFailAt: Timestamp.fromMillis(Date.now() - minutesAgo * 60_000),
    });
  });
};

describe('5 failures lock for 15 minutes', () => {
  it('locked within 15 minutes; free again after, and counting restarts at 1', async () => {
    await setLock(14);
    await assertFails(getAccounts(withEmail('entry'), [ACC_A]));
    await assertFails(recordFailure(anon(), 'entry@example.com'));
    await setLock(16);
    await assertSucceeds(getAccounts(withEmail('entry'), [ACC_A]));
    expect(await getFailures(withEmail('entry'), 'entry@example.com')).toBe(0);
    await recordFailure(anon(), 'entry@example.com');
    let fails = 0;
    await env.withSecurityRulesDisabled(async (ctx) => {
      fails = (
        await getDoc(
          doc(
            ctx.firestore() as unknown as Firestore,
            'lockouts',
            await emailKey('entry@example.com'),
          ),
        )
      ).data()?.fails;
    });
    expect(fails).toBe(1);
  });
  it('an expired count cannot be pushed past 5 or reset by others', async () => {
    await setLock(16);
    const key = await emailKey('entry@example.com');
    const { serverTimestamp } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(anon(), 'lockouts', key), { fails: 6, lastFailAt: serverTimestamp() }),
    );
    await assertFails(updateDoc(doc(withEmail('admin'), 'lockouts', key), { fails: 0 }));
  });
});

describe('no gaps in voucher numbers', () => {
  it('the counter moves only with the payment that takes the number', async () => {
    const staff = withEmail('entry');
    await assertFails(updateDoc(doc(staff, 'counters', 'vouchers'), { next: 101 }));
    await assertFails(
      updateDoc(doc(staff, 'counters', 'vouchers'), {
        next: 101,
        lastAccount: ACC_A,
        lastEntry: 'inv1',
      }),
    );
    const { voucherNo } = await createEntry(
      staff,
      'entry',
      ACC_A,
      { type: 'payment', amount: 100, signed: -100, date: '2026-10-01', details: '' },
      [],
    );
    expect(voucherNo).toBe(101);
    const { voucherNo: n2 } = await createEntry(
      staff,
      'entry',
      ACC_A,
      { type: 'payment', amount: 100, signed: -100, date: '2026-10-01', details: '' },
      [],
    );
    expect(n2).toBe(102);
  });
});
