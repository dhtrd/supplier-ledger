import { generateToken } from '../../../shared/lib/token';

const KEY = 'sl:deviceId';

/**
 * Random id of this browser, used only to tell the user's own devices apart
 * in the «last active» heartbeat. Not a secret and not tracking.
 */
export function deviceId(): string {
  try {
    const have = localStorage.getItem(KEY);
    if (have && /^[A-Za-z0-9_-]{16,64}$/.test(have)) return have;
    const id = generateToken(12);
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    // Storage blocked: a per-tab id still works (heartbeats just look like a
    // different device each reload).
    return (memoryId ??= generateToken(12));
  }
}
let memoryId: string | undefined;
