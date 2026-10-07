import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AppSettings } from '../features/settings/domain/types';
import { watchSettings } from '../features/settings/data/settingsRepo';
import type { UserProfile } from '../features/users/domain/types';
import { watchProfile } from '../features/users/data/usersRepo';
import { clearOwnFailures, getFailures } from '../features/auth/data/lockoutRepo';
import { isLocked } from '../features/auth/domain/lockout';
import { unlockAfterLogin, watchScreenLock } from '../features/quickUnlock/data/screenLockRepo';
import { deviceId } from '../features/quickUnlock/data/device';
import type { ScreenLock } from '../features/quickUnlock/domain/presence';
import { errorMessage, reportError } from './errors';
import { fb, wipeLocalData } from './firebase';

interface SignedInData {
  user: User;
  profile: UserProfile;
  settings: AppSettings;
  screen: ScreenLock;
}

export type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'error'; message: string }
  | { status: 'noProfile' | 'inactive' | 'lockedOut'; user: User }
  | ({ status: 'ready' } & SignedInData)
  /** Quick-unlock lock: the rules refuse business data until unlocked. */
  | ({ status: 'screenLocked' } & SignedInData);

const Ctx = createContext<SessionState>({ status: 'loading' });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    const { auth, db } = fb();
    let stopProfile: (() => void) | undefined;
    let stopSettings: (() => void) | undefined;
    let stopScreen: (() => void) | undefined;
    const stopInner = () => {
      stopProfile?.();
      stopSettings?.();
      stopScreen?.();
      stopProfile = stopSettings = stopScreen = undefined;
    };
    const fail = (where: string) => (e: unknown) => {
      reportError(where, e);
      setState({ status: 'error', message: errorMessage(e) });
    };

    let generation = 0;
    let hadUser = false;
    /** The app was usable on this page load (so a lock now must wipe the cache). */
    let wasReady = false;
    const stopAuth = onAuthStateChanged(auth, async (user) => {
      stopInner();
      const gen = ++generation;
      if (!user) {
        // Signed out elsewhere (another tab, password change): wipe the device
        // cache here too, exactly like the «تسجيل الخروج» button.
        if (hadUser) return void logout();
        setState({ status: 'signedOut' });
        return;
      }
      hadUser = true;
      wasReady = false;
      setState({ status: 'loading' });
      // 5 failed attempts lock the account (enforced by the rules as well).
      try {
        const fails = user.email ? await getFailures(db, user.email) : 0;
        if (gen !== generation) return;
        if (isLocked(fails)) return setState({ status: 'lockedOut', user });
        if (fails > 0 && user.email) await clearOwnFailures(db, user.email);
      } catch (e) {
        return fail('lockout')(e);
      }
      if (gen !== generation) return;
      // Time of the last password sign-in: a screen lock set before it is
      // lifted automatically (the rules check the same thing).
      let signedInAtMs = 0;
      try {
        signedInAtMs = Date.parse((await user.getIdTokenResult()).authTime) || 0;
      } catch (e) {
        reportError('auth-time', e); // only disables the automatic unlock
      }
      if (gen !== generation) return;
      let profile: UserProfile | null | undefined;
      let settings: AppSettings | undefined;
      let screen: ScreenLock | undefined;
      let autoUnlockTried = false;
      const emit = () => {
        if (profile === undefined) return;
        if (profile === null) return setState({ status: 'noProfile', user });
        if (!profile.active) return setState({ status: 'inactive', user });
        if (!settings || !screen) return;
        if (screen.locked && signedInAtMs > screen.atMs && !autoUnlockTried) {
          autoUnlockTried = true;
          // Signed in again with the password after the lock → lift it. The
          // snapshot that follows re-emits; on failure the lock screen shows.
          unlockAfterLogin(db, user.uid, deviceId()).catch((e) => reportError('auto-unlock', e));
        }
        // Shared devices (owner decision 2026-10-07): when the screen locks
        // after being in use, wipe the cached ledger data and restart on the
        // lock screen; unlocking reads fresh from the server.
        if (screen.locked && wasReady) {
          wasReady = false;
          void wipeLocalData().finally(() => window.location.reload());
          return;
        }
        if (!screen.locked) wasReady = true;
        setState({
          status: screen.locked ? 'screenLocked' : 'ready',
          user,
          profile,
          settings,
          screen,
        });
      };
      stopProfile = watchProfile(
        db,
        user.uid,
        (p) => {
          profile = p;
          // Settings are readable only by active users: start once confirmed.
          if (p?.active && !stopScreen)
            stopScreen = watchScreenLock(
              db,
              user.uid,
              (l) => {
                screen = l;
                emit();
              },
              fail('screen-lock'),
            );
          if (p?.active && !stopSettings) {
            stopSettings = watchSettings(
              db,
              (s) => {
                settings = s;
                emit();
              },
              // If this fails because the user was just deactivated, the
              // profile snapshot that follows replaces the error with «موقوف».
              fail('settings'),
            );
          }
          emit();
        },
        fail('profile'),
      );
    });
    return () => {
      stopInner();
      stopAuth();
    };
  }, []);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  return useContext(Ctx);
}

/** For screens rendered only inside the signed-in shell. */
export type ReadySession = Extract<SessionState, { status: 'ready' }>;

export function useReady(): ReadySession {
  const s = useSession();
  if (s.status !== 'ready') throw new Error('useReady outside a ready session');
  return s;
}

/**
 * Signs out and wipes the cached ledger data from this browser, then reloads
 * on the login page (a closed Firestore cannot be reused).
 */
export async function logout(): Promise<void> {
  try {
    await signOut(fb().auth);
  } finally {
    await wipeLocalData();
    // A hash-only change does not reload the page: set it, then reload.
    window.history.replaceState(null, '', `${window.location.pathname}#/login`);
    window.location.reload();
  }
}
