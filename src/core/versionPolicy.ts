/**
 * Pure rules of the automatic reload (no DOM types, so the unit tests compile
 * in the Node project too). See appVersion.ts.
 */

/** After one reload for a version, do not try again for it within this window (CDN cache). */
export const RETRY_AFTER_MS = 15 * 60_000;

/** Screens where a reload would throw away typing: forms, sign-in, the public signing page. */
const HOLD = /^\/(login|s\/|users|settings|a\/new$|a\/[^/]+\/edit$|a\/[^/]+\/entry\/)/;

export function canReloadOn(pathname: string): boolean {
  return !HOLD.test(pathname);
}

/** Same page and screen, new URL: the query makes the browser fetch a fresh index.html. */
export function freshUrl(loc: { pathname: string; hash: string }, id: string): string {
  return `${loc.pathname}?v=${encodeURIComponent(id)}${loc.hash}`;
}

/** True unless we already reloaded for `id` recently (avoids a loop on a stale CDN copy). */
export function shouldReloadFor(id: string, now: number, guard: string | null): boolean {
  if (!guard) return true;
  const [gid, at] = guard.split('@');
  return gid !== id || now - Number(at) > RETRY_AFTER_MS;
}
