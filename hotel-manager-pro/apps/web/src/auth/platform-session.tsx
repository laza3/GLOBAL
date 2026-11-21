import { createContext, useContext, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { isApiError } from '../api/client';
import { usePlatformMeQuery, type PlatformAdmin } from '../api/platform';
import { FullPageError, FullPageLoading } from './screens';

const AdminContext = createContext<PlatformAdmin | null>(null);

export function usePlatformAdmin(): PlatformAdmin {
  const a = useContext(AdminContext);
  if (!a) throw new Error('usePlatformAdmin doit être utilisé sous <RequirePlatformAuth>');
  return a;
}

export function PlatformAdminProvider({ admin, children }: { admin: PlatformAdmin; children: ReactNode }) {
  return <AdminContext value={admin}>{children}</AdminContext>;
}

/** Garde de la console : session SUPER-ADMINISTRATEUR exigée (cookie, table et rôle distincts de ceux des hôtels). */
export function RequirePlatformAuth() {
  const q = usePlatformMeQuery();
  const location = useLocation();
  if (q.isPending) return <FullPageLoading />;
  if (q.isError) {
    if (isApiError(q.error) && q.error.status === 401) {
      return <Navigate to="/platform/connexion" replace state={{ from: `${location.pathname}${location.search}` }} />;
    }
    return <FullPageError error={q.error} onRetry={() => void q.refetch()} />;
  }
  return (
    <PlatformAdminProvider admin={q.data}>
      <Outlet />
    </PlatformAdminProvider>
  );
}

export function RedirectIfPlatformAuthenticated({ children }: { children: ReactNode }) {
  const q = usePlatformMeQuery();
  if (q.isPending) return <FullPageLoading />;
  if (q.isSuccess) return <Navigate to="/platform/dashboard" replace />;
  return <>{children}</>;
}
