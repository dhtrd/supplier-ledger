/**
 * One live Firestore listener per key, shared by every screen that needs it,
 * kept open for a while after the last screen leaves (owner decision
 * 2026-10-07: fewer reads, same live sync). Going statement → entry form →
 * statement re-uses the open listener instead of starting a new query.
 */
type Next<T> = (v: T) => void;
type Fail = (e: unknown) => void;

interface Slot<T> {
  has: boolean;
  value: T | undefined;
  error: unknown;
  subs: Set<{ next: Next<T>; fail: Fail }>;
  stop: () => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export const KEEP_ALIVE_MS = 5 * 60_000;
const slots = new Map<string, Slot<unknown>>();

export function sharedWatch<T>(
  key: string,
  start: (next: Next<T>, fail: Fail) => () => void,
  next: Next<T>,
  fail: Fail,
  keepAliveMs = KEEP_ALIVE_MS,
): () => void {
  let slot = slots.get(key) as Slot<T> | undefined;
  if (!slot) {
    const s: Slot<T> = {
      has: false,
      value: undefined,
      error: undefined,
      subs: new Set(),
      stop: () => {},
      timer: undefined,
    };
    slots.set(key, s as Slot<unknown>);
    s.stop = start(
      (v) => {
        s.has = true;
        s.value = v;
        s.error = undefined;
        for (const sub of s.subs) sub.next(v);
      },
      (e) => {
        s.error = e;
        for (const sub of s.subs) sub.fail(e);
        // A failed listener is dead: drop it so the next screen starts afresh.
        slots.delete(key);
      },
    );
    slot = s;
  }
  if (slot.timer) {
    clearTimeout(slot.timer);
    slot.timer = undefined;
  }
  const sub = { next, fail };
  slot.subs.add(sub);
  // Hand the latest value to a screen joining an open listener.
  if (slot.error !== undefined) fail(slot.error);
  else if (slot.has) next(slot.value as T);

  const own = slot;
  return () => {
    own.subs.delete(sub);
    if (own.subs.size || slots.get(key) !== own) return;
    own.timer = setTimeout(() => {
      if (own.subs.size) return;
      own.stop();
      if (slots.get(key) === own) slots.delete(key);
    }, keepAliveMs);
  };
}

/** Closes every listener now (sign-out, before the local cache is wiped). */
export function stopAllSharedWatches(): void {
  for (const s of slots.values()) {
    if (s.timer) clearTimeout(s.timer);
    s.stop();
  }
  slots.clear();
}
