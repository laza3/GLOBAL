import { formatMoney } from '@hmp/shared';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { useSaveTable, useTables, type DiningTable } from '../../api/restaurant';
import { useCan } from '../../auth/session';
import { useCurrency } from '../../lib/use-currency';
import { useDocumentTitle } from '../../lib/use-title';
import { ActionModal } from '../../ui/action-modal';
import { Button } from '../../ui/button';
import { Badge, EmptyState, StateBadge } from '../../ui/data';
import { Field, Input, Switch } from '../../ui/form';
import { Panel } from '../../ui/page';

function TableModal({ table, onClose }: { table: DiningTable | null; onClose: () => void }) {
  const save = useSaveTable();
  const [label, setLabel] = useState(table?.label ?? '');
  const [area, setArea] = useState(table?.area ?? '');
  const [seats, setSeats] = useState(String(table?.seats ?? 4));
  const [active, setActive] = useState(table?.isActive ?? true);
  return (
    <ActionModal title={table ? `Modifier la table ${table.label}` : 'Nouvelle table'} confirmLabel="Enregistrer" onClose={onClose}
      onSubmit={() => {
        const n = Number(seats);
        if (!label.trim()) return 'Donnez un nom à la table.';
        if (!Number.isInteger(n) || n < 1 || n > 60) return 'Le nombre de places doit être entre 1 et 60.';
        return save.mutateAsync({ id: table?.id, body: { label: label.trim(), area: area.trim() || null, seats: n, ...(table ? { isActive: active } : {}) } }).then(() => void toast.success('Table enregistrée.'));
      }}>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Nom" required>{(c) => <Input {...c} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={30} placeholder="T1, Terrasse 2…" autoFocus />}</Field>
        <Field label="Places">{(c) => <Input {...c} inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value)} />}</Field>
      </div>
      <Field label="Zone (facultatif)">{(c) => <Input {...c} value={area} onChange={(e) => setArea(e.target.value)} maxLength={40} placeholder="Salle, terrasse, bar…" />}</Field>
      {table && <Switch label="Table en service" checked={active} onCheckedChange={setActive} />}
    </ActionModal>
  );
}

export default function TablesPage() {
  useDocumentTitle('Tables du restaurant');
  const can = useCan();
  const currency = useCurrency();
  const tables = useTables();
  const [editing, setEditing] = useState<DiningTable | 'new' | null>(null);
  const manage = can('restaurant:manage');
  return (
    <Panel title="Tables" description="Une table est occupée dès qu'une commande est en cours, et se libère à l'encaissement." actions={manage ? <Button variant="primary" onClick={() => setEditing('new')}><Plus aria-hidden className="size-4" />Nouvelle table</Button> : undefined}>
      {tables.data && tables.data.length === 0 ? <EmptyState kind="key" title="Aucune table" description="Ajoutez vos tables pour savoir lesquelles sont occupées. Vous pouvez aussi prendre des commandes au comptoir sans table." action={manage ? <Button variant="primary" onClick={() => setEditing('new')}>Ajouter une table</Button> : undefined} /> : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Tables">
          {(tables.data ?? []).map((t) => (
            <li key={t.id} className="flex flex-col gap-2 rounded-[16px] border border-hairline bg-[var(--glass-data)] p-4">
              <span className="flex items-start justify-between gap-2"><span className="flex flex-col"><span className="text-[16px] font-semibold text-ink">{t.label}</span><span className="text-[13px] text-ink-2">{t.seats} places{t.area ? ` · ${t.area}` : ''}</span></span>{!t.isActive ? <Badge>Hors service</Badge> : t.busy ? <StateBadge tone="warning">Occupée</StateBadge> : <StateBadge tone="success">Libre</StateBadge>}</span>
              {t.busy && t.orderId && <Link to={`/restaurant?open=${t.orderId}`} className="text-[13px] text-accent-ink hover:underline">{t.orderNumber} · {formatMoney(t.orderTotal ?? 0, currency)}</Link>}
              {manage && <Button size="sm" variant="ghost" className="self-start" onClick={() => setEditing(t)} aria-label={`Modifier la table ${t.label}`}>Modifier</Button>}
            </li>
          ))}
        </ul>
      )}
      {editing && <TableModal table={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Panel>
  );
}
