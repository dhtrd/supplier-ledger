import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

export function useMediaQuery(q: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(q);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(q).matches,
    () => false,
  );
}

export const useDesktop = () => useMediaQuery('(min-width: 900px)');

/** Object URL for raw image bytes, revoked automatically. */
export function useBlobUrl(
  data: Uint8Array | null | undefined,
  mime = 'image/webp',
): string | null {
  const url = useMemo(
    () =>
      data && data.byteLength
        ? URL.createObjectURL(new Blob([data as BlobPart], { type: mime }))
        : null,
    [data, mime],
  );
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return url;
}

/** Re-renders every `ms` (for countdowns). */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
