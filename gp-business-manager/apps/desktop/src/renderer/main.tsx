import { StrictMode, useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router-dom';
import type { Locale } from '@gp/shared';
import './lib/web-bridge';
import './styles.css';
import { ThemeProvider } from './lib/theme';
import { I18nProvider } from './lib/i18n';
import { AuthProvider } from './lib/auth';
import { ToastProvider } from './components/ui';
import { App } from './App';

// Site web : plusieurs personnes modifient les mêmes données depuis des appareils différents → on rafraîchit à l'ouverture d'un écran,
// au retour sur l'onglet et toutes les 20 s (onglet visible uniquement). Application Windows : données locales, pas besoin.
const web = window.gp?.platform === 'web';
const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: web, staleTime: web ? 0 : 5000, ...(web ? { refetchOnMount: 'always' as const, refetchInterval: 20_000 } : {}) } } });

function Root() {
  const [locale, setLocale] = useState<Locale>('fr');
  const onLocale = useCallback((l: Locale) => { setLocale(l); document.documentElement.lang = l; }, []);
  return (
    <ThemeProvider>
      <I18nProvider locale={locale}>
        <QueryClientProvider client={qc}>
          <ToastProvider>
            <AuthProvider onLocale={onLocale}>
              <HashRouter><App /></HashRouter>
            </AuthProvider>
          </ToastProvider>
        </QueryClientProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);

// Site web : service worker (démarrage rapide). Pas dans l'application Windows.
if (window.gp?.platform === 'web' && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
