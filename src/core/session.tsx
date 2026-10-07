import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AppSettings } from '../features/settings/domain/types';
import { watchSettings } from '../features/settings/data/settingsRepo';
import type { UserProfile } from '../features/users/domain/types';
import { watchProfile } from '../features/users/data/usersRepo';
import { clearOwnFailures, getFailures } from '../features/auth/data/lockoutRepo';
import { isLocked } from '../features/auth/domain/lockout';
import { errorMessage, reportError } from './errors';
import { fb } from './firebase';

export type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'error'; message: string }
  | { status: 'noProfile' | 'inactive' | 'lockedOut'; user: User }
  | { status: 'ready'; user: User; profile: UserProfile; settings: AppSettings };

const Ctx = createContext<SessionState>({ status: 'loading' });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    const { auth, db } = fb();
    let stopProfile: (() => void) | undefined;
    let stopSettings: (() => void) | undefined;
    const stopInner = () => {
      stopProfile?.();
      stopSettings?.();
      stopProfile = stopSettings = undefined;
    };
    const fail = (where: string) => (e: unknown) => {
      reportError(where, e);
      setState({ status: 'error', message: errorMessage(e) });
    };

    let generation = 0;
    const stopAuth = onAuthStateChanged(auth, async (user) => {
      stopInner();
      const gen = ++generation;
      if (!user) {
        setState({ status: 'signedOut' });
        return;
      }
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
      let profile: UserProfile | null | undefined;
      let settings: AppSettings | undefined;
      const emit = () => {
        if (profile === undefined) return;
        if (profile === null) return setState({ status: 'noProfile', user });
        if (!profile.active) return setState({ status: 'inactive', user });
        if (!settings) return;
        setState({ status: 'ready', user, profile, settings });
      };
      stopProfile = watchProfile(
        db,
        user.uid,
        (p) => {
          profile = p;
          // Settings are readable only by active users: start once confirmed.
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
export function useReady(): Extract<SessionState, { status: 'ready' }> {
  const s = useSession();
  if (s.status !== 'ready') throw new Error('useReady outside a ready session');
  return s;
}

export async function logout(): Promise<void> {
  await signOut(fb().auth);
}
