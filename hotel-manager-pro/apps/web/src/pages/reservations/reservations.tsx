import { formatMoney } from '@hmp/shared';
import { CalendarPlus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useReservations, type ReservationRow } from '../../api/reservations';
import { useCan } from '../../auth/session';
import { formatDate, formatDay, plural } from '../../lib/format';
import { ReservationBadge } from '../../lib/reservation-status';
import { useDebounced } from '../../lib/use-debounced';
import { useDocumentTitle } from '../../lib/use-title';
import { Button, buttonVariants } from '../../ui/button';
import { Badge, DataTable, EmptyState, StateBadge, VipBadge } from '../../ui/data';
import { Field, Input, SegmentedControl, Select } from '../../ui/form';
import { PageHeader, Panel } from '../../ui/page';
import { Pager } from '../../ui/pager';

const STATUS_FILTERS = [
  { value: 'all', label: 'Tous les états' },
  { value: 'tentative,pending,confirmed', label: 'À venir' },
  { value: 'tentative', label: 'Options' },
  { value: 'pending', label: 'En attente' },
  { value: 'confirmed', label: 'Confirmées' },
  { value: 'checked_in', label: 'En séjour' },
  { value: 'checked_out', label: 'Terminées' },
  { value: 'cancelled', label: 'Annulées' },
  { value: 'no_show', label: 'Non présentés' },
];

function Balance({ r }: { r: ReservationRow }) {
  if (['cancelled', 'no_show'].includes(r.status)) return <span className="text-ink-3">—</span>;
  if (r.balanceDue === 0) return <StateBadge tone="success">Soldée</StateBadge>;
  return (
    <span className="flex flex-col items-end">
      <span className="num-col">{formatMoney(r.balanceDue, r.currency)}</span>
      {r.depositRequired > 0 && !r.depositSatisfied && <span className="text-[12.5px] text-[var(--st-pending)]">Acompte attendu</span>}
    </span>
  );
}

export default function ReservationsPage() {
  useDocumentTitle('Réservations');
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const q = useDebounced(text.trim());
  const status = params.get('status') ?? 'all';
  const sort = (params.get('sort') as 'created' | 'arrival_asc') ?? 'created';
  const page = Number(params.get('page') ?? 1) || 1;
  const list = useReservations({ q: q || undefined, status: status === 'all' ? undefined : status, sort, page, pageSize: 25 });
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v === null || v === '' ? next.delete(k) : next.set(k, v));
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };
  const filtered = !!q || status !== 'all';

  return (
    <>
      <PageHeader
        title="Réservations"
        description="Toutes les réservations de l'établissement. Une chambre ne peut jamais être réservée deux fois sur les mêmes nuits."
        actions={can('reservations:create') ? <Link to="/reservations/new" className={buttonVariants({ variant: 'primary' })}><CalendarPlus aria-hidden className="size-4" />Nouvelle réservation</Link> : undefined}
      />
      <Panel>
        <div className="grid items-end gap-4 md:grid-cols-[1fr_14rem_auto]">
          <Field label="Rechercher" hint="Référence, nom du client, e-mail ou numéro de chambre">
            {(c) => <Input {...c} type="search" leading={<Search className="size-4" />} value={text} onChange={(e) => { setText(e.target.value); set({ q: e.target.value.trim() || null }); }} autoComplete="off" />}
          </Field>
          <Field label="État">{(c) => <Select {...c} value={status} onValueChange={(v) => set({ status: v === 'all' ? null : v })} options={STATUS_FILTERS} />}</Field>
          <SegmentedControl label="Tri" value={sort} onValueChange={(v) => set({ sort: v === 'created' ? null : v })} options={[{ value: 'created', label: 'Récentes' }, { value: 'arrival_asc', label: 'Arrivée' }]} />
        </div>
        {list.isError ? (
          <p className="text-[14px] text-ink-2">Impossible de charger les réservations.</p>
        ) : (
          <>
            <DataTable<ReservationRow>
              caption="Réservations"
              loading={list.isPending}
              rows={list.data?.items ?? []}
              rowKey={(r) => r.id}
              columns={[
                { key: 'r', header: 'Référence', cell: (r) => <Link to={`/reservations/${r.id}`} className="font-medium text-accent-ink underline-offset-4 hover:underline">{r.reference}</Link> },
                { key: 'g', header: 'Client', cell: (r) => <span className="flex flex-wrap items-center gap-2"><span>{r.guestFirstName} {r.guestLastName}</span>{r.guestIsVip && <VipBadge />}{r.groupName && <Badge>{r.groupName}</Badge>}</span> },
                { key: 's', header: 'Séjour', cell: (r) => <span className="flex flex-col"><span>{formatDay(r.checkIn)} → {formatDay(r.checkOut)}</span><span className="text-[13px] text-ink-2">{r.roomsCount} {plural(r.roomsCount, 'chambre', 'chambres')}{r.roomNumbers.length ? ` · ${r.roomNumbers.join(', ')}` : ''}</span></span> },
                { key: 't', header: 'État', cell: (r) => <span className="flex flex-col items-start gap-1"><ReservationBadge status={r.status} />{r.status === 'tentative' && r.tentativeExpiresAt && <span className="text-[12.5px] text-ink-2">jusqu'au {formatDate(r.tentativeExpiresAt, { time: true })}</span>}</span> },
                { key: 'm', header: 'Total', align: 'right', cell: (r) => <span className="num-col">{formatMoney(r.total, r.currency)}</span> },
                { key: 'b', header: 'Reste à payer', align: 'right', cell: (r) => <Balance r={r} /> },
              ]}
              mobileCard={(r) => (
                <Link to={`/reservations/${r.id}`} className="flex flex-col gap-1.5">
                  <span className="flex items-center justify-between gap-3"><span className="font-medium text-ink">{r.reference}</span><ReservationBadge status={r.status} /></span>
                  <span className="text-[14px] text-ink">{r.guestFirstName} {r.guestLastName}{r.guestIsVip ? ' · VIP' : ''}</span>
                  <span className="text-[13px] text-ink-2">{formatDay(r.checkIn)} → {formatDay(r.checkOut)} · {r.roomsCount} {plural(r.roomsCount, 'chambre', 'chambres')}{r.roomNumbers.length ? ` (${r.roomNumbers.join(', ')})` : ''}</span>
                  <span className="num-col text-[14px] font-medium text-ink">{formatMoney(r.total, r.currency)}</span>
                </Link>
              )}
              empty={<EmptyState kind={filtered ? 'search' : 'calendar'} title={filtered ? 'Aucune réservation ne correspond' : 'Aucune réservation pour le moment'} description={filtered ? 'Essayez une autre recherche, ou retirez le filtre.' : "Créez la première réservation : cherchez les chambres libres, choisissez le client, c'est enregistré."} action={!filtered && can('reservations:create') ? <Link to="/reservations/new"><Button variant="primary"><CalendarPlus aria-hidden className="size-4" />Créer une réservation</Button></Link> : undefined} />}
            />
            <Pager page={page} pageSize={25} total={list.data?.total ?? 0} onPage={(p) => set({ page: String(p) })} />
          </>
        )}
      </Panel>
    </>
  );
}
