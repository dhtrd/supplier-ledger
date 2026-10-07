import { afterEach, describe, expect, it, vi } from 'vitest';
import { sharedWatch, stopAllSharedWatches } from '../../src/shared/lib/sharedWatch';

afterEach(() => {
  stopAllSharedWatches();
  vi.useRealTimers();
});

function source() {
  const s = {
    starts: 0,
    stops: 0,
    push: (() => {}) as (v: number) => void,
    fail: (() => {}) as (e: unknown) => void,
  };
  const start = (next: (v: number) => void, fail: (e: unknown) => void) => {
    s.starts++;
    s.push = next;
    s.fail = fail;
    return () => {
      s.stops++;
    };
  };
  return { s, start };
}

describe('sharedWatch', () => {
  it('starts one listener for many screens and replays the latest value', () => {
    const { s, start } = source();
    const a: number[] = [];
    const b: number[] = [];
    const ua = sharedWatch(
      'k',
      start,
      (v) => a.push(v),
      () => {},
    );
    s.push(1);
    const ub = sharedWatch(
      'k',
      start,
      (v) => b.push(v),
      () => {},
    );
    s.push(2);
    expect(s.starts).toBe(1);
    expect(a).toEqual([1, 2]);
    expect(b).toEqual([1, 2]);
    ua();
    ub();
  });
  it('keeps the listener open for a while after the last screen leaves', () => {
    vi.useFakeTimers();
    const { s, start } = source();
    const u = sharedWatch(
      'k',
      start,
      () => {},
      () => {},
      1000,
    );
    u();
    vi.advanceTimersByTime(500);
    const u2 = sharedWatch(
      'k',
      start,
      () => {},
      () => {},
      1000,
    );
    expect(s.starts).toBe(1);
    u2();
    vi.advanceTimersByTime(1001);
    expect(s.stops).toBe(1);
    sharedWatch(
      'k',
      start,
      () => {},
      () => {},
      1000,
    );
    expect(s.starts).toBe(2);
  });
  it('reports errors and restarts after a failure', () => {
    const { s, start } = source();
    const errs: unknown[] = [];
    sharedWatch(
      'k',
      start,
      () => {},
      (e) => errs.push(e),
    );
    s.fail('denied');
    expect(errs).toEqual(['denied']);
    sharedWatch(
      'k',
      start,
      () => {},
      () => {},
    );
    expect(s.starts).toBe(2);
  });
  it('stopAll closes everything at once (sign-out)', () => {
    const { s, start } = source();
    sharedWatch(
      'a',
      start,
      () => {},
      () => {},
    );
    sharedWatch(
      'b',
      start,
      () => {},
      () => {},
    );
    stopAllSharedWatches();
    expect(s.stops).toBe(2);
  });
});
