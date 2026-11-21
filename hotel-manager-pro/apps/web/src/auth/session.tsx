import { hasPermission, type Permission } from '@hmp/shared';
import { createContext, useContext, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { isApiError } from '../api/client';
import { useMeQuery } from '../api/hotel';
import type { Me } from '../api/types';
import { FullPageError, FullPageLoading } from './screens';

const MeContext = createContext<Me | null>(null);

export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe doit être utilisé sous <RequireHotelAuth>');
  return me;
}

/** `can('rooms:manage')` : masque ce que le serveur refuserait de toute façon (le serveur reste l'autorité). */
export function useCan() {
  const me = useMe();
  return (permission: Permission) => hasPermission(me.permissions, permission);
}

export function MeProvider({ me, children }: { me: Me; children: ReactNode }) {
  return <MeContext value={me}>{children}</MeContext>;
}

/** Garde d'accès : session valide exigée. Non connecté → page de connexion (qui nous ramène ici ensuite). */
export function RequireHotelAuth() {
  const q = useMeQuery();
  const location = useLocation();
  if (q.isPending) return <FullPageLoading />;
  if (q.isError) {
    if (isApiError(q.error) && q.error.status === 401) {
      return <Navigate to="/connexion" replace state={{ from: `${location.pathname}${location.search}` }} />;
    }
    return <FullPageError error={q.error} onRetry={() => void q.refetch()} />;
  }
  return (
    <MeProvider me={q.data}>
      <Outlet />
    </MeProvider>
  );
}

/** Pages d'accueil (connexion, inscription) : déjà connecté → directement à l'application. */
export function RedirectIfAuthenticated({ children }: { children: ReactNode }) {
  const q = useMeQuery();
  if (q.isPending) return <FullPageLoading />;
  if (q.isSuccess) return <Navigate to="/overview" replace />;
  return <>{children}</>;
}
