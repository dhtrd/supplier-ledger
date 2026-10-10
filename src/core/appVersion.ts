/**
 * Keeps every open tab on the newest published version (owner decision
 * 2026-10-10: reload automatically). An old tab kept running the previous code
 * after a release, and the server rules refused its saves.
 *
 * The build writes `version.json` ({ id }) next to index.html and embeds the
 * same id here. Every few minutes (and when the tab comes back into view) the
 * app fetches it; when it differs, the page reloads — but never on a screen
 * where something is being typed: there it waits until the user leaves it.
 */
declare const __BUILD_ID__: string;

export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
export const CHECK_EVERY_MS = 5 * 60_000;
/** After one reload for a version, do not try again for it within this window (CDN cache). */
export const RETRY_AFTER_MS = 15 * 60_000;
const GUARD_KEY = 'sl:reloadedFor';
export const CHECK_EVENT = 'sl:check-version';

/** Screens where a reload would throw away typing: forms, sign-in, the public signing page. */
const HOLD = /^\/(login|s\/|users|settings|a\/new$|a\/[^/]+\/edit$|a\/[^/]+\/entry\/)/;

export function canReloadOn(pathname: string): boolean {
  return !HOLD.test(pathname);
}

/** The published id, or null when it cannot be read (offline, dev server). */
export async function fetchLatestId(base: string): Promise<string | null> {
  try {
    const res = await fetch(`${base}version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const id = data && typeof data === 'object' && 'id' in data ? data.id : null;
    return typeof id === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Same page and screen, new URL: the query makes the browser fetch a fresh index.html. */
export function freshUrl(loc: Pick<Location, 'pathname' | 'hash'>, id: string): string {
  return `${loc.pathname}?v=${encodeURIComponent(id)}${loc.hash}`;
}

/** True unless we already reloaded for `id` recently (avoids a loop on a stale CDN copy). */
export function shouldReloadFor(id: string, now: number, guard: string | null): boolean {
  if (!guard) return true;
  const [gid, at] = guard.split('@');
  return gid !== id || now - Number(at) > RETRY_AFTER_MS;
}

export function reloadTo(id: string): void {
  try {
    sessionStorage.setItem(GUARD_KEY, `${id}@${Date.now()}`);
  } catch {
    // Storage blocked: still reload (the guard is only a loop breaker).
  }
  window.location.replace(freshUrl(window.location, id));
}

export function readGuard(): string | null {
  try {
    return sessionStorage.getItem(GUARD_KEY);
  } catch {
    return null;
  }
}

/** Ask for a check now (e.g. after the server refused a save). */
export function requestVersionCheck(): void {
  window.dispatchEvent(new Event(CHECK_EVENT));
}

/** Drops the `?v=` cache-buster from the address bar after a reload. */
export function tidyUrl(): void {
  if (!/[?&]v=/.test(window.location.search)) return;
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`);
}
