import { Search } from 'lucide-react';
import { useState } from 'react';
import { useGuests, type GuestRow } from '../../api/guests';
import { useDebounced } from '../../lib/use-debounced';
import { Field, Input } from '../../ui/form';

/** Choix d'un client par recherche (nom, e-mail, téléphone). Réutilisé par la fusion, les réservations, la facturation. */
export function GuestPicker({ value, onChange, label = 'Client', error, excludeId, autoFocus }: {
  value: { id: string; name: string } | null; onChange: (g: { id: string; name: string } | null) => void; label?: string; error?: string; excludeId?: string; autoFocus?: boolean;
}) {
  const [text, setText] = useState('');
  const q = useDebounced(text.trim());
  const results = useGuests({ q: q || undefined, pageSize: 6 });
  const items = (results.data?.items ?? []).filter((g) => g.id !== excludeId);
  const pick = (g: GuestRow) => onChange({ id: g.id, name: `${g.firstName} ${g.lastName}` });
  return (
    <div className="flex flex-col gap-2">
      <Field label={label} error={error} required>
        {(c) => (
          <Input
            {...c}
            type="search"
            leading={<Search className="size-4" />}
            value={value ? value.name : text}
            onChange={(e) => { onChange(null); setText(e.target.value); }}
            placeholder="Nom, e-mail ou téléphone"
            autoComplete="off"
            autoFocus={autoFocus}
          />
        )}
      </Field>
      {!value && q && (
        <ul className="flex flex-col gap-1 rounded-[14px] border border-hairline bg-[var(--glass-data)] p-1.5" aria-label="Résultats de la recherche">
          {items.map((g) => (
            <li key={g.id}>
              <button type="button" onClick={() => pick(g)} className="flex min-h-10 w-full cursor-pointer flex-col items-start rounded-[10px] px-3 py-1.5 text-left hover:bg-accent-soft">
                <span className="text-[14px] font-medium text-ink">{g.firstName} {g.lastName}{g.isVip ? ' · VIP' : ''}</span>
                <span className="text-[13px] text-ink-2">{[g.email, g.phone, g.city].filter(Boolean).join(' · ') || 'Aucune coordonnée'}</span>
              </button>
            </li>
          ))}
          {results.data && items.length === 0 && <li className="px-3 py-2 text-[14px] text-ink-2">Aucun client trouvé.</li>}
        </ul>
      )}
    </div>
  );
}
