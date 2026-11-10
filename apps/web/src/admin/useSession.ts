import { useSyncExternalStore } from 'react';
import { session } from '../api/session';

/** Re-renders when the session logs in/out/expires. */
export function useSessionState(): boolean {
  return useSyncExternalStore(
    (cb) => session.subscribe(cb),
    () => session.isAuthenticated,
    () => false,
  );
}
