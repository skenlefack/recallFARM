import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/endpoints';
import { session } from '../api/session';
import type { Me, Membership, VerifyResponse } from '../api/types';
import { useSessionState } from './useSession';

interface AuthValue {
  me: Me | undefined;
  membership: Membership | null;
  orgId: string | null;
  isLoading: boolean;
  error: unknown;
  signIn: (r: VerifyResponse) => void;
  signOut: () => void;
  can: (role: string) => boolean;
  switchOrg: (id: string) => void;
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const authed = useSessionState();

  const meQ = useQuery({ queryKey: ['me'], queryFn: api.me, enabled: authed, staleTime: 5 * 60_000 });

  useEffect(
    () =>
      session.subscribe((reason) => {
        if (reason === 'expired' || reason === 'logout') {
          qc.clear();
          if (reason === 'expired' && location.pathname.startsWith('/admin') && location.pathname !== '/admin/login') {
            navigate(`/admin/login?expired=1&next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
          }
        }
      }),
    [qc, navigate],
  );

  const me = authed ? meQ.data : undefined;
  const membership = useMemo(() => {
    if (!me?.memberships.length) return null;
    return me.memberships.find((m) => m.organisation_id === session.orgId) ?? me.memberships[0];
  }, [me]);

  const signIn = useCallback(
    (r: VerifyResponse) => {
      qc.clear();
      session.setTokens(r.access_token, r.refresh_token, 'login');
      if (r.user && 'memberships' in r.user && r.user.entitlements) qc.setQueryData(['me'], r.user as Me);
    },
    [qc],
  );
  const signOut = useCallback(() => {
    session.clear('logout');
    navigate('/admin/login', { replace: true });
  }, [navigate]);
  const can = useCallback((role: string) => !!me && (me.platform_roles.includes(role as never) || me.platform_roles.includes('platform_admin')), [me]);
  const switchOrg = useCallback(
    (id: string) => {
      session.setOrg(id);
      qc.invalidateQueries();
    },
    [qc],
  );

  const value: AuthValue = {
    me,
    membership,
    orgId: membership?.organisation_id ?? null,
    isLoading: authed && meQ.isLoading,
    error: meQ.error,
    signIn,
    signOut,
    can,
    switchOrg,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const authed = useSessionState();
  const loc = useLocation();
  if (!authed) return <Navigate to={`/admin/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}
