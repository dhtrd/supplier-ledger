/** Archiving (owner decision 2026-10-07): hide from the daily list, data stays. */
export const ARCHIVE_SUGGEST_DAYS = 90;
/** «لاحقاً» on the suggestion hides it for this long on this device. */
export const SUGGEST_SNOOZE_DAYS = 7;

const DAY = 86_400_000;
const dayMs = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((dayMs(toIso) - dayMs(fromIso)) / DAY);
}

export interface ArchiveCandidateInput {
  id: string;
  archived: boolean;
  balance: number;
  count: number;
  /** Date of the latest live entry. */
  lastDate: string | null;
}

/**
 * Settled accounts (balance 0) with entries but no movement for 90+ days.
 * Empty accounts are never suggested (they may have just been created).
 */
export function archiveCandidates(rows: readonly ArchiveCandidateInput[], today: string): string[] {
  return rows
    .filter(
      (r) =>
        !r.archived &&
        r.balance === 0 &&
        r.count > 0 &&
        r.lastDate !== null &&
        daysBetween(r.lastDate, today) >= ARCHIVE_SUGGEST_DAYS,
    )
    .map((r) => r.id);
}

/** Only settled accounts with entries need their last movement looked up. */
export function needsLastMovement(
  r: Pick<ArchiveCandidateInput, 'archived' | 'balance' | 'count'>,
): boolean {
  return !r.archived && r.balance === 0 && r.count > 0;
}
