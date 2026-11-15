import { createPortal } from 'react-dom';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, Search, X, XCircle } from 'lucide-react';
import { useT } from '../lib/i18n';
import { money, parseMoney, moneyToInput, parseQty, qtyToInput } from '../lib/format';

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

/* ---------- Boutons ---------- */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'gold' | 'ghost' | 'danger' | 'outline'; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: ReactNode };
export function Button({ variant = 'outline', size = 'md', loading, icon, className, children, disabled, ...p }: BtnProps) {
  const v = {
    primary: 'bg-ink-800 text-white hover:bg-ink-700 dark:bg-ink-100 dark:text-ink-900 dark:hover:bg-white',
    gold: 'bg-gradient-to-b from-gold-300 to-gold-400 text-ink-950 hover:from-gold-200 hover:to-gold-300 shadow-sm',
    ghost: 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-white/5',
    danger: 'bg-red-600 text-white hover:bg-red-500',
    outline: 'border border-ink-200 bg-white text-ink-700 hover:bg-ink-50 dark:border-white/10 dark:bg-white/5 dark:text-ink-100 dark:hover:bg-white/10',
  }[variant];
  const s = { sm: 'h-8 px-3 text-xs gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-12 px-6 text-base gap-2' }[size];
  return (
    <button {...p} disabled={disabled || loading} className={cx('inline-flex items-center justify-center rounded-xl font-medium transition-colors duration-150 disabled:opacity-50 select-none', v, s, className)}>
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

/* ---------- Champs ---------- */
const fieldBase = 'rounded-xl border border-ink-200 bg-white px-3 text-sm text-ink-800 placeholder:text-ink-400 transition focus:border-gold-400 focus:outline-none focus:ring-2 focus:ring-gold-300/40 disabled:bg-ink-50 disabled:text-ink-400 dark:border-white/10 dark:bg-white/5 dark:text-ink-50 dark:disabled:bg-white/[0.03]';
const wFull = (c?: string) => (c && /(^|\s)w-/.test(c) ? '' : 'w-full');
export const Input = ({ className, ...p }: React.ComponentProps<'input'>) => <input {...p} className={cx(fieldBase, wFull(className), 'h-10', className)} />;
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(fieldBase, wFull(className), 'py-2', className)} />;
export const Select = ({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...p} className={cx(fieldBase, wFull(className), 'h-10 pr-8 dark:[&>option]:bg-ink-900', className)}>{children}</select>
);

export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string; children: ReactNode; className?: string }) {
  const { t } = useT();
  // <label> englobant : association implicite (lecteurs d'écran, getByLabel) sans avoir à injecter d'id dans l'enfant
  return (
    <label className={cx('block space-y-1.5', className)}>
      <span className="block text-xs font-semibold tracking-wide text-ink-500 dark:text-ink-300">{t(label)}</span>
      {children}
      {hint && !error && <span className="block text-xs text-ink-400">{t(hint)}</span>}
      {error && <span className="block text-xs text-red-600">{error}</span>}
    </label>
  );
}

/** Saisie monétaire : l'état est un texte, la valeur transmise est un entier en unité mineure. */
export function MoneyInput({ value, onChange, className, ...p }: { value: number | null | undefined; onChange: (v: number) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(moneyToInput(value));
  const last = useRef(value);
  useEffect(() => { if (value !== last.current && parseMoney(text) !== value) setText(moneyToInput(value)); last.current = value; }, [value]); // eslint-disable-line
  return (
    <Input {...p} inputMode="decimal" className={cx('text-right tabular', className)} value={text}
      onChange={(e) => { setText(e.target.value); const v = parseMoney(e.target.value); last.current = v; onChange(v); }}
      onBlur={() => setText(moneyToInput(parseMoney(text)))} onFocus={(e) => e.target.select()} />
  );
}
export function QtyInput({ value, onChange, className, ...p }: { value: number | null | undefined; onChange: (milli: number) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(qtyToInput(value));
  const last = useRef(value);
  useEffect(() => { if (value !== last.current && parseQty(text) !== value) setText(qtyToInput(value)); last.current = value; }, [value]); // eslint-disable-line
  return (
    <Input {...p} inputMode="decimal" className={cx('text-right tabular', className)} value={text}
      onChange={(e) => { setText(e.target.value); const v = parseQty(e.target.value); last.current = v; onChange(v); }} onFocus={(e) => e.target.select()} />
  );
}

export function SearchInput({ value, onChange, placeholder, className, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean }) {
  const { t } = useT();
  return (
    <div className={cx('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
      <Input autoFocus={autoFocus} value={value} onChange={(e) => onChange(e.target.value)} placeholder={t(placeholder ?? 'Rechercher…')} className="pl-9" />
    </div>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  const { t } = useT();
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-700 dark:text-ink-200">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 rounded border-ink-300 accent-gold-500" />
      {t(label)}
    </label>
  );
}

/* ---------- Conteneurs ---------- */
export const Card = ({ className, children, ...p }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) => (
  <div {...p} className={cx('rounded-2xl border border-ink-100 bg-white shadow-card dark:border-white/[0.07] dark:bg-ink-900/70', className)}>{children}</div>
);
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  const { t } = useT();
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900 dark:text-white">{t(title)}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-300">{t(subtitle)}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}

const tones = {
  neutral: 'bg-ink-100 text-ink-600 dark:bg-white/10 dark:text-ink-200',
  gold: 'bg-gold-100 text-gold-700 dark:bg-gold-400/15 dark:text-gold-200',
  green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300',
  red: 'bg-red-50 text-red-700 dark:bg-red-400/15 dark:text-red-300',
  blue: 'bg-sky-50 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300',
};
export const Badge = ({ tone = 'neutral', children }: { tone?: keyof typeof tones; children: ReactNode }) => (
  <span className={cx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', tones[tone])}>{children}</span>
);
export function StatusBadge({ status }: { status: string }) {
  const { t } = useT();
  const m: Record<string, [string, keyof typeof tones]> = {
    PAID: ['Payée', 'green'], PARTIAL: ['Partielle', 'gold'], UNPAID: ['Impayée', 'red'], OPEN: ['Ouverte', 'green'], CLOSED: ['Clôturée', 'neutral'],
    ORDERED: ['Commandée', 'blue'], RECEIVED: ['Reçue', 'green'], CANCELLED: ['Annulée', 'red'], VALIDATED: ['Validé', 'green'],
  };
  const [label, tone] = m[status] ?? [status, 'neutral'];
  return <Badge tone={tone}>{t(label)}</Badge>;
}

export function Spinner({ className }: { className?: string }) { return <Loader2 className={cx('size-5 animate-spin text-ink-400', className)} />; }
export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  const { t } = useT();
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon && <div className="mb-1 rounded-2xl bg-ink-50 p-3 text-ink-400 dark:bg-white/5">{icon}</div>}
      <p className="font-medium text-ink-700 dark:text-ink-100">{t(title)}</p>
      {hint && <p className="max-w-sm text-sm text-ink-400">{t(hint)}</p>}
      {action}
    </div>
  );
}
export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-300">{(error as Error).message}</div>;
}

/* ---------- Tableaux ---------- */
export interface Column<T> { key: string; header: string; render: (row: T) => ReactNode; align?: 'right' | 'center'; className?: string; width?: string }
export function DataTable<T>({ columns, rows, rowKey, onRowClick, empty, dense, footer }: { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; onRowClick?: (r: T) => void; empty?: ReactNode; dense?: boolean; footer?: ReactNode }) {
  const { t } = useT();
  if (!rows.length) return <>{empty ?? <EmptyState title="Aucune donnée" />}</>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-ink-100 text-xs font-semibold uppercase tracking-wider text-ink-400 dark:border-white/[0.07]">
            {columns.map((c) => <th key={c.key} style={{ width: c.width }} className={cx('whitespace-nowrap px-4 py-3 text-left font-semibold', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center')}>{t(c.header)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={cx('border-b border-ink-50 last:border-0 transition-colors dark:border-white/[0.04]', onRowClick && 'cursor-pointer hover:bg-gold-50/60 dark:hover:bg-white/[0.04]')}>
              {columns.map((c) => <td key={c.key} className={cx(dense ? 'px-4 py-2' : 'px-4 py-3', 'text-ink-700 dark:text-ink-100', c.align === 'right' && 'text-right tabular', c.align === 'center' && 'text-center', c.className)}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
        {footer}
      </table>
    </div>
  );
}

/* ---------- Modale ---------- */
export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const { t } = useT();
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  // Portal au niveau du <body> : la fenêtre est toujours positionnée par rapport à l'écran, jamais piégée
  // par un ancêtre animé (transform) ; le conteneur défile et `m-auto` centre sans jamais rogner le haut.
  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" aria-label={t(title)}>
      <div className="fixed inset-0 animate-fade-in bg-ink-950/50 backdrop-blur-[2px]" onMouseDown={onClose} />
      <div className="relative flex min-h-full p-3 sm:p-4">
        <div className={cx('relative m-auto flex max-h-[calc(100dvh-1.5rem)] w-full animate-pop-in flex-col rounded-2xl bg-white shadow-pop sm:max-h-[calc(100dvh-2rem)] dark:bg-ink-900 dark:ring-1 dark:ring-white/10', w)}>
          <div className="flex shrink-0 items-center justify-between border-b border-ink-100 px-5 py-4 dark:border-white/[0.07]">
            <h2 className="text-base font-semibold text-ink-900 dark:text-white">{t(title)}</h2>
            <button onClick={onClose} aria-label={t('Fermer')} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 dark:hover:bg-white/10"><X className="size-4" /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex shrink-0 justify-end gap-2 border-t border-ink-100 px-5 py-3 dark:border-white/[0.07]">{footer}</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ---------- Confirmation ---------- */
export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirmer', danger, onConfirm, onClose }: { open: boolean; title: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void }) {
  const { t } = useT();
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" footer={<><Button onClick={onClose}>{t('Annuler')}</Button><Button variant={danger ? 'danger' : 'primary'} onClick={() => { onConfirm(); onClose(); }}>{t(confirmLabel)}</Button></>}>
      <p className="text-sm text-ink-600 dark:text-ink-200">{t(message)}</p>
    </Modal>
  );
}

/* ---------- Onglets ---------- */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  const { t } = useT();
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-ink-100/70 p-1 dark:bg-white/5" role="tablist">
      {tabs.map((tb) => (
        <button key={tb.id} role="tab" aria-selected={value === tb.id} onClick={() => onChange(tb.id)}
          className={cx('whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium transition', value === tb.id ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-700 dark:text-white' : 'text-ink-500 hover:text-ink-800 dark:text-ink-300')}>
          {t(tb.label)}{tb.count != null && <span className="ml-1.5 text-xs text-ink-400">{tb.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------- KPI ---------- */
export function Kpi({ label, value, hint, icon, tone = 'neutral', trend }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: 'neutral' | 'gold' | 'green' | 'red'; trend?: ReactNode }) {
  const { t } = useT();
  const ring = { neutral: 'bg-ink-100 text-ink-600 dark:bg-white/10 dark:text-ink-200', gold: 'bg-gold-100 text-gold-600 dark:bg-gold-400/15 dark:text-gold-300', green: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300', red: 'bg-red-50 text-red-600 dark:bg-red-400/15 dark:text-red-300' }[tone];
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">{t(label)}</p>
        {icon && <span className={cx('rounded-lg p-1.5', ring)}>{icon}</span>}
      </div>
      <p className="mt-2 truncate text-2xl font-semibold tabular tracking-tight text-ink-900 dark:text-white">{value}</p>
      {(hint || trend) && <div className="mt-1 flex items-center gap-2 text-xs text-ink-400">{trend}{hint}</div>}
    </Card>
  );
}

/* ---------- Toasts ---------- */
type Toast = { id: number; kind: 'success' | 'error' | 'info'; text: string };
const ToastCtx = createContext<{ push: (kind: Toast['kind'], text: string) => void }>({ push: () => {} });
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === 'error' ? 6000 : 3200);
  }, []);
  const v = useMemo(() => ({ push }), [push]);
  const Icon = { success: CheckCircle2, error: XCircle, info: Info };
  const color = { success: 'text-emerald-500', error: 'text-red-500', info: 'text-sky-500' };
  return (
    <ToastCtx.Provider value={v}>
      {children}
      <div className="no-print pointer-events-none fixed right-4 top-20 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {items.map((i) => { const I = Icon[i.kind]; return (
          <div key={i.id} className="pointer-events-auto flex animate-pop-in items-start gap-2.5 rounded-xl border border-ink-100 bg-white p-3 text-sm shadow-pop dark:border-white/10 dark:bg-ink-800">
            <I className={cx('mt-0.5 size-4 shrink-0', color[i.kind])} /><span className="text-ink-700 dark:text-ink-100">{i.text}</span>
          </div>); })}
      </div>
    </ToastCtx.Provider>
  );
}

/** Notifie une erreur API par toast. */
export function useErr() {
  const { push } = useToast();
  return (e: unknown) => push('error', (e as Error)?.message ?? 'Erreur');
}
export const Money = ({ v, className }: { v: number | null | undefined; className?: string }) => <span className={cx('tabular', className)}>{money(v)}</span>;
export function Warn({ children }: { children: ReactNode }) {
  return <div className="flex items-start gap-2 rounded-xl bg-gold-50 px-3 py-2 text-sm text-gold-700 dark:bg-gold-400/10 dark:text-gold-200"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{children}</div>;
}
