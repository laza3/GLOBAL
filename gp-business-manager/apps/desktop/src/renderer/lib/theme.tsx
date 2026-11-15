import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Mode = 'light' | 'dark';
const Ctx = createContext<{ mode: Mode; toggle: () => void }>({ mode: 'light', toggle: () => {} });

const read = (): Mode => {
  try { const v = localStorage.getItem('gp.theme'); if (v === 'dark' || v === 'light') return v; } catch { /* ignore */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(read);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', mode === 'dark');
    try { localStorage.setItem('gp.theme', mode); } catch { /* ignore */ }
  }, [mode]);
  return <Ctx.Provider value={{ mode, toggle: () => setMode((m) => (m === 'dark' ? 'light' : 'dark')) }}>{children}</Ctx.Provider>;
}
export const useTheme = () => useContext(Ctx);
