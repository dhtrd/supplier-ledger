import { useEffect, useRef, useState } from 'react';
import { errorMessage, reportError } from '../../../core/errors';
import { fb } from '../../../core/firebase';
import { watchAccount } from '../../accounts/data/accountsRepo';
import type { Account } from '../../accounts/domain/types';
import { syncSignedLink, watchOpenLinks, type SignLink } from '../../signing/data/signLinksRepo';
import { sharedWatch } from '../../../shared/lib/sharedWatch';
import { watchEntries, type EntrySnapshot } from '../data/entriesRepo';

export interface LedgerState {
  account: Account | null | undefined;
  entries: EntrySnapshot[] | undefined;
  links: SignLink[];
  error: string;
  syncError: string;
}

/**
 * Live account + entries + open signing links. Signatures collected on public
 * links are copied onto their payment entries as soon as staff open the
 * account (Spark has no Cloud Functions to do it server-side).
 */
export function useLedger(accountId: string, uid: string): LedgerState {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [entries, setEntries] = useState<EntrySnapshot[] | undefined>(undefined);
  const [links, setLinks] = useState<SignLink[]>([]);
  const [error, setError] = useState('');
  const [syncError, setSyncError] = useState('');
  const syncing = useRef(new Set<string>());

  useEffect(() => {
    const { db } = fb();
    const fail = (where: string) => (e: unknown) => {
      reportError(where, e);
      const code = e && typeof e === 'object' && 'code' in e ? String(e.code) : '';
      setError(
        code.includes('permission-denied')
          ? 'هذا الحساب غير مسند إليك أو غير موجود.'
          : errorMessage(e),
      );
    };
    // Shared + kept alive a few minutes: moving between the statement, the
    // entry form and prints does not start new queries (fewer reads).
    const stops = [
      sharedWatch<Account | null>(
        `account:${accountId}`,
        (n, f) => watchAccount(db, accountId, n, f),
        setAccount,
        fail('account'),
      ),
      sharedWatch<EntrySnapshot[]>(
        `entries:${accountId}`,
        (n, f) => watchEntries(db, accountId, n, f),
        setEntries,
        fail('entries'),
      ),
      sharedWatch<SignLink[]>(
        `links:${accountId}`,
        (n, f) => watchOpenLinks(db, accountId, n, f),
        setLinks,
        fail('links'),
      ),
    ];
    return () => stops.forEach((s) => s());
  }, [accountId]);

  useEffect(() => {
    const { db } = fb();
    for (const l of links) {
      if (l.status !== 'signed' || l.synced || syncing.current.has(l.id)) continue;
      syncing.current.add(l.id);
      syncSignedLink(db, uid, l).catch((e) => {
        reportError('sync-signature', e);
        setSyncError(`تعذّر نقل توقيع السند ${l.voucherNo} إلى الكشف: ${errorMessage(e)}`);
        syncing.current.delete(l.id);
      });
    }
  }, [links, uid]);

  return { account, entries, links, error, syncError };
}
