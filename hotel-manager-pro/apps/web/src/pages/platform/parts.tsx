import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { isApiError } from '../../api/client';
import { fmt } from '../../ui/stats';
import { Button } from '../../ui/button';
import { useDirectory } from '../../api/platform';
import { Field, Input, Textarea } from '../../ui/form';
import { Modal } from '../../ui/overlay';
import { Callout } from '../../ui/page';
import { formatMoney } from '@hmp/shared';

export const HotelLink = ({ id, name }: { id: string; name: string }) => (
  <Link to={`/platform/hotels/${id}`} className="font-medium text-accent-ink underline-offset-4 hover:underline">
    {name}
  </Link>
);

/** Valeur qui ne change qu'une fois la frappe terminée (recherche sans requête à chaque touche). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return total > 0 ? <p className="text-[13px] text-ink-2">{fmt.int.format(total)} résultat{total > 1 ? 's' : ''}</p> : null;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3">
      <p className="text-[13px] text-ink-2" role="status">
        Page {page} sur {pages} — {fmt.int.format(total)} résultats
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Page précédente">
          <ChevronLeft aria-hidden className="size-4" />
        </Button>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Page suivante">
          <ChevronRight aria-hidden className="size-4" />
        </Button>
      </div>
    </nav>
  );
}

/** Plusieurs devises ne s'additionnent jamais : une ligne par devise. */
export function Amounts({ rows, empty = '—' }: { rows: Array<{ currency: string; amount: number }>; empty?: string }) {
  if (rows.length === 0) return <span className="text-ink-2">{empty}</span>;
  return (
    <span className="flex flex-col">
      {rows.map((r) => (
        <span key={r.currency} className="num-col">
          {formatMoney(r.amount, r.currency)}
        </span>
      ))}
    </span>
  );
}

/**
 * Action sensible : un MOTIF est exigé (il est journalisé). Toute erreur du serveur s'affiche dans la fenêtre, qui reste ouverte.
 */
export function ReasonModal({
  title, description, label = 'Motif', hint, confirmLabel, destructive, extra, onSubmit, onClose,
}: {
  title: string;
  description?: string;
  label?: string;
  hint?: string;
  confirmLabel: string;
  destructive?: boolean;
  extra?: ReactNode;
  onSubmit: (reason: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (reason.trim().length < 3) return setError('Indiquez un motif d\'au moins 3 caractères : il sera conservé dans le journal.');
    setError(null);
    setBusy(true);
    try {
      await onSubmit(reason.trim());
      onClose();
    } catch (e) {
      setError(isApiError(e) ? e.message : 'L\'action a échoué. Réessayez.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Annuler</Button>
          <Button variant={destructive ? 'danger' : 'primary'} loading={busy} onClick={() => void submit()}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {extra}
        <Field label={label} hint={hint} error={error && reason.trim().length < 3 ? error : undefined} required>
          {(c) => <Textarea {...c} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300} />}
        </Field>
        {error && reason.trim().length >= 3 && <Callout tone="danger">{error}</Callout>}
      </div>
    </Modal>
  );
}

/** Choix d'un établissement par recherche (nom, identifiant, e-mail) — jamais une liste de centaines d'entrées. */
export function HotelPicker({ value, onChange, error }: { value: { id: string; name: string } | null; onChange: (h: { id: string; name: string } | null) => void; error?: string }) {
  const [text, setText] = useState('');
  const q = useDebounced(text.trim());
  const results = useDirectory({ q: q || undefined, pageSize: 6 });
  return (
    <div className="flex flex-col gap-2">
      <Field label="Établissement" error={error} required>
        {(c) => <Input {...c} type="search" value={value ? value.name : text} onChange={(e) => { onChange(null); setText(e.target.value); }} placeholder="Rechercher par nom ou e-mail" autoComplete="off" />}
      </Field>
      {!value && q && (
        <ul className="flex flex-col gap-1 rounded-[14px] border border-hairline bg-[var(--glass-data)] p-1.5" aria-label="Résultats">
          {(results.data?.items ?? []).map((h) => (
            <li key={h.id}>
              <button type="button" onClick={() => onChange({ id: h.id, name: h.name })} className="flex min-h-10 w-full cursor-pointer flex-col items-start rounded-[10px] px-3 py-1.5 text-left hover:bg-accent-soft">
                <span className="text-[14px] font-medium text-ink">{h.name}</span>
                <span className="text-[13px] text-ink-2">{h.ownerEmail} · {h.city ?? '—'}</span>
              </button>
            </li>
          ))}
          {results.data && results.data.items.length === 0 && <li className="px-3 py-2 text-[14px] text-ink-2">Aucun résultat.</li>}
        </ul>
      )}
    </div>
  );
}
