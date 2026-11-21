import '@fontsource-variable/inter/wght.css';
import './styles/index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DesignSystemPage } from './pages/design-system';
import { Toaster, TooltipProvider } from './ui/overlay';
import { ThemeProvider } from './ui/theme';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider>
        <DesignSystemPage />
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
