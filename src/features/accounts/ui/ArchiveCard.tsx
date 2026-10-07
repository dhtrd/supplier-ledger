import { useState } from 'react';
import { errorMessage, reportError } from '../../../core/errors';
import { fb } from '../../../core/firebase';
import { useReady } from '../../../core/session';
import { balanceSide, formatAmount, SIDE_LABEL } from '../../../shared/lib/money';
import { useToast } from '../../../shared/ui/Toast';
import { can } from '../../users/domain/types';
import { accountTotals, setArchived } from '../data/accountsRepo';

/** Archive / bring back from the account form (owner and managers). */
export function ArchiveCard({
  id,
  name,
  archived,
  onChange,
}: {
  id: string;
  name: string;
  archived: boolean;
  onChange: (archived: boolean) => void;
}) {
  const { user, profile } = useReady();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  /** null = not asked yet; a number = balance shown in the confirm step. */
  const [confirmBalance, setConfirmBalance] = useState<number | null>(null);
  if (!can.archiveAccounts(profile.role)) return null;

  const ask = async () => {
    setBusy(true);
    try {
      setConfirmBalance((await accountTotals(fb().db, id)).balance);
    } catch (e) {
      reportError('archive-balance', e);
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = async (next: boolean) => {
    setBusy(true);
    try {
      await setArchived(fb().db, user.uid, { id, archived }, next);
      onChange(next);
      setConfirmBalance(null);
      toast.info(
        next
          ? `أُرشف «${name}». تجده في «المؤرشفة» أسفل قائمة الحسابات.`
          : `أُعيد «${name}» إلى قائمة الحسابات.`,
      );
    } catch (e) {
      reportError('archive', e);
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="stack" style={{ gap: 8 }} aria-labelledby="arch-title">
      <h2 id="arch-title" className="serif" style={{ margin: 0, fontSize: 18 }}>
        الأرشفة
      </h2>
      {archived ? (
        <>
          <p className="hint" style={{ margin: 0 }}>
            الحساب مؤرشف: لا يظهر في قائمة الحسابات ولا يراه مدخل البيانات.
          </p>
          <button type="button" className="btn" onClick={() => void apply(false)} disabled={busy}>
            {busy ? 'جارٍ…' : 'إعادته إلى القائمة'}
          </button>
        </>
      ) : confirmBalance === null ? (
        <>
          <p className="hint" style={{ margin: 0 }}>
            يخفي الحساب من القائمة اليومية فقط؛ كشفه وبياناته تبقى، ويُعاد بضغطة.
          </p>
          <button type="button" className="btn" onClick={() => void ask()} disabled={busy}>
            {busy ? 'جارٍ…' : 'أرشفة الحساب'}
          </button>
        </>
      ) : (
        <>
          {confirmBalance !== 0 && can.seeBalances(profile.role) && (
            <div className="banner banner-warn" role="note">
              رصيده ليس صفراً:{' '}
              <strong className="num">{formatAmount(Math.abs(confirmBalance))}</strong>{' '}
              {SIDE_LABEL[balanceSide(confirmBalance)]}. يبقى ضمن صافي الأرصدة.
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void apply(true)}
              disabled={busy}
            >
              {busy ? 'جارٍ…' : 'نعم، أرشفه'}
            </button>
            <button type="button" className="btn" onClick={() => setConfirmBalance(null)}>
              تراجع
            </button>
          </div>
        </>
      )}
    </section>
  );
}
