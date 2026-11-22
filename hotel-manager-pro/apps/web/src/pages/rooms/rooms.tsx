import { formatMoney } from '@hmp/shared';
import { Archive, BedDouble, Plus, Rows3, Search, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { isApiError } from '../../api/client';
import { useArchiveRoom, useCategories, useRooms, type Room } from '../../api/rooms';
import { useCan } from '../../auth/session';
import { ROOM_STATUS } from '../../lib/labels';
import { useCurrency } from '../../lib/use-currency';
import { useDocumentTitle } from '../../lib/use-title';
import { Button, buttonVariants } from '../../ui/button';
import { DataTable, EmptyState, RoomStatusBadge } from '../../ui/data';
import { Field, Input, Select, Switch } from '../../ui/form';
import { Panel } from '../../ui/page';
import { BulkModal, RoomModal } from './modals';

export default function RoomsPage() {
  useDocumentTitle('Chambres');
  const can = useCan();
  const manage = can('rooms:manage');
  const currency = useCurrency();
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [status, setStatus] = useState('all');
  const [archived, setArchived] = useState(false);
  const cats = useCategories();
  const rooms = useRooms({ q: q.trim() || undefined, categoryId: categoryId === 'all' ? undefined : categoryId, status: status === 'all' ? undefined : status, archived: archived ? 'true' : 'false' });
  const archive = useArchiveRoom();
  const [editing, setEditing] = useState<Room | 'new' | null>(null);
  const [bulk, setBulk] = useState(false);

  const noCategory = cats.isSuccess && cats.data.length === 0;
  const act = (r: Room) =>
    archive.mutate({ id: r.id, restore: r.isArchived }, {
      onSuccess: () => toast.success(r.isArchived ? `Chambre ${r.number} restaurée.` : `Chambre ${r.number} archivée.`),
      onError: (e) => toast.error(isApiError(e) ? e.message : "L'action a échoué."),
    });

  const actions = (r: Room) =>
    manage ? (
      <span className="flex gap-2">
        {!r.isArchived && <Button size="sm" variant="secondary" onClick={() => setEditing(r)} aria-label={`Modifier la chambre ${r.number}`}>Modifier</Button>}
        <Button size="sm" variant="ghost" onClick={() => act(r)} aria-label={`${r.isArchived ? 'Restaurer' : 'Archiver'} la chambre ${r.number}`}>
          {r.isArchived ? <Undo2 aria-hidden className="size-4" /> : <Archive aria-hidden className="size-4" />}
          {r.isArchived ? 'Restaurer' : 'Archiver'}
        </Button>
      </span>
    ) : null;

  if (noCategory) {
    return (
      <Panel>
        <EmptyState
          kind="key"
          title="Commencez par créer une catégorie"
          description="Une catégorie regroupe des chambres semblables (Standard, Deluxe, Suite…) et porte leur tarif de base. Ensuite, ajoutez vos chambres une à une ou en série."
          action={manage ? <Link to="categories" className={buttonVariants({ variant: 'primary' })}><Plus aria-hidden className="size-4" />Créer une catégorie</Link> : undefined}
        />
      </Panel>
    );
  }

  return (
    <>
      <Panel
        actions={
          manage ? (
            <span className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setBulk(true)}><Rows3 aria-hidden className="size-4" />Ajouter en série</Button>
              <Button variant="primary" onClick={() => setEditing('new')}><Plus aria-hidden className="size-4" />Ajouter une chambre</Button>
            </span>
          ) : undefined
        }
      >
        <div className="grid items-end gap-4 md:grid-cols-[1fr_13rem_13rem_auto]">
          <Field label="Rechercher">{(c) => <Input {...c} type="search" leading={<Search className="size-4" />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Numéro ou nom" />}</Field>
          <Field label="Catégorie">{(c) => <Select {...c} value={categoryId} onValueChange={setCategoryId} options={[{ value: 'all', label: 'Toutes' }, ...(cats.data ?? []).map((x) => ({ value: x.id, label: x.name }))]} />}</Field>
          <Field label="État aujourd'hui">{(c) => <Select {...c} value={status} onValueChange={setStatus} options={[{ value: 'all', label: 'Tous' }, ...Object.entries(ROOM_STATUS).filter(([k]) => k !== 'archived').map(([value, s]) => ({ value, label: s.label }))]} />}</Field>
          <div className="pb-1"><Switch label="Archivées" checked={archived} onCheckedChange={setArchived} /></div>
        </div>
        {rooms.isError ? (
          <p className="text-[14px] text-ink-2">Impossible de charger les chambres.</p>
        ) : (
          <DataTable<Room>
            caption="Chambres"
            loading={rooms.isPending}
            rows={rooms.data ?? []}
            rowKey={(r) => r.id}
            columns={[
              { key: 'n', header: 'Chambre', cell: (r) => <span className="flex flex-col"><span className="num-col font-semibold text-ink">{r.number}</span>{r.name && <span className="text-[13px] text-ink-2">{r.name}</span>}</span>, sortValue: (r) => r.number },
              { key: 'c', header: 'Catégorie', cell: (r) => r.categoryName, sortValue: (r) => r.categoryName },
              { key: 'f', header: 'Étage', cell: (r) => r.floor ?? '—' },
              { key: 'cap', header: 'Capacité', cell: (r) => `${r.capacity} pers. · ${r.beds} lit${r.beds > 1 ? 's' : ''}` },
              { key: 'rate', header: 'Tarif / nuit', align: 'right', cell: (r) => <span className="flex flex-col items-end"><span>{formatMoney(r.baseNightlyRate, currency)}</span>{r.nightlyRate != null && <span className="text-[13px] text-ink-2">tarif propre</span>}</span>, sortValue: (r) => r.baseNightlyRate },
              { key: 's', header: 'État', cell: (r) => <RoomStatusBadge status={r.displayStatus} /> },
              { key: 'a', header: 'Actions', cell: actions },
            ]}
            mobileCard={(r) => (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3"><span className="num-col text-[17px] font-semibold text-ink">{r.number}{r.name ? ` · ${r.name}` : ''}</span><RoomStatusBadge status={r.displayStatus} /></div>
                <span className="text-[13px] text-ink-2">{r.categoryName} · {r.capacity} pers. · {formatMoney(r.baseNightlyRate, currency)} / nuit</span>
                {actions(r)}
              </div>
            )}
            empty={<EmptyState kind="calendar" title={q || categoryId !== 'all' || status !== 'all' ? 'Aucune chambre ne correspond' : 'Aucune chambre'} description={q || categoryId !== 'all' || status !== 'all' ? 'Modifiez les filtres.' : 'Ajoutez vos chambres une à une, ou toute une plage d\'un coup.'} action={manage && !q ? <Button variant="primary" onClick={() => setBulk(true)}><BedDouble aria-hidden className="size-4" />Ajouter des chambres</Button> : undefined} />}
          />
        )}
      </Panel>
      {editing && <RoomModal room={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {bulk && <BulkModal onClose={() => setBulk(false)} />}
    </>
  );
}
