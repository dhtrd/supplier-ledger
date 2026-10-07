import { useEffect, useMemo, useState } from 'react';
import { errorMessage, reportError } from '../../../core/errors';
import { fb } from '../../../core/firebase';
import { useReady } from '../../../core/session';
import { displayDate } from '../../../shared/lib/dates';
import { balanceSide, formatAmount, SIDE_LABEL } from '../../../shared/lib/money';
import { can } from '../../users/domain/types';
import { sharedWatch } from '../../../shared/lib/sharedWatch';
import { watchEntries, type EntrySnapshot } from '../data/entriesRepo';
import { accountBalance, balanceAfter, latestEntries } from '../domain/statement';
import { entryLabel, type Entry } from '../domain/types';

const SIDE_COLOR = { lah: 'var(--lah)', alayh: 'var(--alayh)', settled: 'var(--ink)' } as const;

/**
 * Desktop-only side panel of the entry form (approved layout «ب»): current
 * balance with the balance after saving (managers only — entry users never
 * see balances) and the last 5 entries, to spot a duplicate before saving.
 */
export function EntryContextPanel({
  accountId,
  nextSigned,
  editingId,
}: {
  accountId: string;
  /** Signed value of the form right now, or null while the amount is invalid. */
  nextSigned: number | null;
  editingId: string | null;
}) {
  const { profile } = useReady();
  const [rows, setRows] = useState<EntrySnapshot[] | undefined>(undefined);
  const [error, setError] = useState('');

  useEffect(
    () =>
      // Same shared listener as the statement: no second read of the account.
      sharedWatch<EntrySnapshot[]>(
        `entries:${accountId}`,
        (n, f) => watchEntries(fb().db, accountId, n, f),
        setRows,
        (e) => {
          reportError('entry-context', e);
          setError(errorMessage(e));
        },
      ),
    [accountId],
  );

  const entries = useMemo(() => (rows ?? []).map((s) => s.entry), [rows]);
  const recent = useMemo(() => latestEntries(entries, 5), [entries]);
  const showBalance = can.seeBalances(profile.role);

  if (error)
    return (
      <aside className="entry-aside">
        <div className="banner banner-err" role="alert">
          تعذّر تحميل سياق الحساب: {error}
        </div>
      </aside>
    );

  return (
    <aside className="entry-aside" aria-label="سياق الحساب">
      {showBalance && (
        <div className="ctx-card">
          <div className="hint">الرصيد الحالي</div>
          {rows === undefined ? (
            <div className="hint">جارٍ التحميل…</div>
          ) : (
            <>
              <Balance halalas={accountBalance(entries)} big />
              <div className="hint">
                بعد الحفظ يصبح:{' '}
                {nextSigned === null ? (
                  '—'
                ) : (
                  <Balance halalas={balanceAfter(entries, nextSigned, editingId)} />
                )}
              </div>
            </>
          )}
        </div>
      )}
      <div className="ctx-card">
        <h2 className="serif ctx-title">آخر العمليات</h2>
        {rows === undefined && <div className="hint">جارٍ التحميل…</div>}
        {rows !== undefined && recent.length === 0 && (
          <div className="hint">لا عمليات في هذا الحساب بعد.</div>
        )}
        {recent.map((e) => (
          <RecentRow key={e.id} e={e} editing={e.id === editingId} />
        ))}
      </div>
    </aside>
  );
}

function Balance({ halalas, big = false }: { halalas: number; big?: boolean }) {
  const side = balanceSide(halalas);
  return (
    <strong
      className="num"
      style={{ color: SIDE_COLOR[side], fontSize: big ? 28 : 'inherit', fontWeight: 700 }}
    >
      {formatAmount(Math.abs(halalas))}{' '}
      <span style={{ fontSize: big ? 15 : 'inherit' }}>{SIDE_LABEL[side]}</span>
    </strong>
  );
}

function RecentRow({ e, editing }: { e: Entry; editing: boolean }) {
  const label = e.voucherNo != null ? `${entryLabel(e)} #${e.voucherNo}` : entryLabel(e);
  const text = e.details.trim() ? `${label} · ${e.details.trim()}` : label;
  return (
    <div className={`ctx-row${editing ? ' editing' : ''}`}>
      <span className="ctx-row-text">
        <span className="num">{displayDate(e.date)}</span> · {text}
        {editing && <span className="hint"> (قيد التعديل)</span>}
      </span>
      {e.type !== 'note' && (
        <b className="num" style={{ color: e.type === 'invoice' ? 'var(--lah)' : 'var(--alayh)' }}>
          {formatAmount(e.amount)}
        </b>
      )}
    </div>
  );
}
