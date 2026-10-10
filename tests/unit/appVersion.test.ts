import { describe, expect, it } from 'vitest';
import {
  canReloadOn,
  freshUrl,
  RETRY_AFTER_MS,
  shouldReloadFor,
} from '../../src/core/versionPolicy';

describe('automatic reload onto a new version', () => {
  it('waits on screens where something is being typed', () => {
    for (const p of ['/', '/a/badr', '/notifications', '/trash', '/audit', '/print/voucher/a/b'])
      expect(canReloadOn(p)).toBe(true);
    for (const p of [
      '/login',
      '/s/abcdefghijklmnopqrstuv',
      '/users',
      '/settings',
      '/a/new',
      '/a/badr/edit',
      '/a/badr/entry/new',
      '/a/badr/entry/e1',
    ])
      expect(canReloadOn(p)).toBe(false);
  });
  it('keeps the screen and busts the cached index.html', () => {
    expect(freshUrl({ pathname: '/supplier-ledger/', hash: '#/a/badr?e=1' }, 'abc123')).toBe(
      '/supplier-ledger/?v=abc123#/a/badr?e=1',
    );
  });
  it('does not loop when the CDN still serves the old page', () => {
    const now = 1_000_000_000;
    expect(shouldReloadFor('v2', now, null)).toBe(true);
    expect(shouldReloadFor('v2', now, `v2@${now - 1000}`)).toBe(false);
    expect(shouldReloadFor('v2', now, `v2@${now - RETRY_AFTER_MS - 1}`)).toBe(true);
    expect(shouldReloadFor('v3', now, `v2@${now - 1000}`)).toBe(true);
  });
});
