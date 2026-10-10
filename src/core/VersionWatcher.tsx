import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { reportError } from './errors';
import {
  BUILD_ID,
  canReloadOn,
  CHECK_EVENT,
  CHECK_EVERY_MS,
  fetchLatestId,
  readGuard,
  reloadTo,
  shouldReloadFor,
  tidyUrl,
} from './appVersion';

/** Reloads the tab onto a newly published version when it is safe (see appVersion.ts). */
export function VersionWatcher() {
  const { pathname } = useLocation();
  const [latest, setLatest] = useState<string | null>(null);

  useEffect(() => {
    tidyUrl();
    if (import.meta.env.DEV || BUILD_ID === 'dev') return;
    let stopped = false;
    const check = async () => {
      const id = await fetchLatestId(import.meta.env.BASE_URL);
      if (!stopped && id && id !== BUILD_ID) setLatest(id);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    const onRequest = () => void check();
    void check();
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(CHECK_EVENT, onRequest);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(CHECK_EVENT, onRequest);
    };
  }, []);

  useEffect(() => {
    if (!latest || !canReloadOn(pathname)) return;
    if (!shouldReloadFor(latest, Date.now(), readGuard())) {
      reportError('version', `still on ${BUILD_ID} after reloading for ${latest}`);
      return;
    }
    reloadTo(latest);
  }, [latest, pathname]);

  return null;
}
