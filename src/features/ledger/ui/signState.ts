import { expiresAtMs, type SignLink } from '../../signing/data/signLinksRepo';
import type { Entry } from '../domain/types';

export interface SignState {
  kind: 'none' | 'pending' | 'signed';
  link?: SignLink;
  minutesLeft?: number;
}

export function signStateOf(entry: Entry, links: SignLink[], now: number): SignState {
  if (entry.type !== 'payment' && entry.type !== 'confirm') return { kind: 'none' };
  if (entry.signature) return { kind: 'signed' };
  const mine = links.filter((l) => l.entryId === entry.id);
  const signed = mine.find((l) => l.status === 'signed');
  if (signed) return { kind: 'signed', link: signed };
  const live = mine
    .filter((l) => l.status === 'pending' && expiresAtMs(l) > now)
    .sort((a, b) => b.createdAtMs - a.createdAtMs)[0];
  if (live)
    return {
      kind: 'pending',
      link: live,
      minutesLeft: Math.max(1, Math.ceil((expiresAtMs(live) - now) / 60_000)),
    };
  return { kind: 'none' };
}
