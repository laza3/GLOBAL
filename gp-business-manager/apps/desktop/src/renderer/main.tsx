import { StrictMode, useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router-dom';
import type { Locale } from '@gp/shared';
import './styles.css';
import { ThemeProvider } from './lib/theme';
import { I18nProvider } from './lib/i18n';
import { AuthProvider } from './lib/auth';
import { ToastProvider } from './components/ui';
import { App } from './App';

const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 5000 } } });

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
