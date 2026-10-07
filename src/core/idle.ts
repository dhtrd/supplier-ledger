/** Pure idle-timer state (unit-tested). */
export type IdlePhase =
  { kind: 'active' } | { kind: 'warning'; secondsLeft: number } | { kind: 'expired' };

export function idlePhase(
  idleMs: number,
  idleMinutes: number,
  countdownSeconds: number,
): IdlePhase {
  const warnAt = idleMinutes * 60_000;
  if (idleMs < warnAt) return { kind: 'active' };
  const left = Math.ceil((warnAt + countdownSeconds * 1000 - idleMs) / 1000);
  return left > 0 ? { kind: 'warning', secondsLeft: left } : { kind: 'expired' };
}
