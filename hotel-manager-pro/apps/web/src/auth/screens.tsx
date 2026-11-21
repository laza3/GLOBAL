import { CloudOff, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { isApiError } from '../api/client';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/data';
import { BrandMark } from '../ui/shell';

export function PageBackdrop({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <div className="ambient" aria-hidden />
      {children}
    </div>
  );
}

/** Premier chargement de la session : jamais d'écran blanc, annoncé aux lecteurs d'écran. */
export function FullPageLoading() {
  return (
    <PageBackdrop>
      <div className="grid min-h-dvh place-items-center p-6" role="status">
        <div className="flex w-full max-w-xs flex-col items-center gap-6">
          <BrandMark />
          <div className="flex w-full flex-col gap-3" aria-hidden>
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-4/5" />
          </div>
          <span className="sr-only">Chargement de votre espace…</span>
        </div>
      </div>
    </PageBackdrop>
  );
}

/** Le serveur ne répond pas (ou a échoué) : on le dit honnêtement, avec le moyen de réessayer. */
export function FullPageError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const offline = isApiError(error) && error.code === 'network_error';
  return (
    <PageBackdrop>
      <main id="main" className="grid min-h-dvh place-items-center p-6">
        <div className="surface glass-1 flex w-full max-w-md flex-col items-center gap-5 p-8 text-center [--surface-radius:var(--r-card)]">
          <BrandMark />
          <CloudOff aria-hidden className="size-10 text-ink-3" />
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[19px] font-semibold text-ink">{offline ? 'Serveur injoignable' : 'Un problème est survenu'}</h1>
            <p className="text-[14px] leading-snug text-ink-2">
              {isApiError(error) ? error.message : 'Impossible de charger votre espace pour le moment.'}
            </p>
            {isApiError(error) && error.requestId && <p className="text-[13px] text-ink-3">Référence à communiquer au support : {error.requestId}</p>}
          </div>
          <Button variant="primary" onClick={onRetry}>
            <RefreshCw aria-hidden className="size-4" />
            Réessayer
          </Button>
        </div>
      </main>
    </PageBackdrop>
  );
}
