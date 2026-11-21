import '@fontsource-variable/inter/wght.css';
import './styles/index.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { router } from './app/router';
import { api, isApiError } from './api/client';
import { Toaster, TooltipProvider } from './ui/overlay';
import { ThemeProvider } from './ui/theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      // On ne réessaie pas une erreur « définitive » (droits, introuvable, validation) ; on réessaie les coupures réseau et les erreurs serveur
      retry: (count, error) => count < 2 && !(isApiError(error) && error.status >= 400 && error.status < 500),
    },
    mutations: { retry: false },
  },
});

// Session expirée EN COURS d'utilisation : on vide tout (aucune donnée de l'ancienne session ne reste en mémoire) et on revient à la connexion.
api.setUnauthenticatedHandler((scope) => {
  const wasSignedIn = queryClient.getQueryData(scope === 'platform' ? ['platform', 'me'] : ['me']);
  if (!wasSignedIn) return;
  queryClient.clear();
  void router.navigate(scope === 'platform' ? '/platform/connexion' : '/connexion', {
    replace: true,
    state: { from: window.location.pathname + window.location.search },
  });
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <RouterProvider router={router} />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
