import { addDays, formatMoney, nightsBetween, weekday, type DateString } from '@hmp/shared';
import { Ban, CalendarPlus, ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useCalendar, BLOCK_REASON_LABEL, type BlockItem, type CalendarData, type StayItem } from '../../api/calendar';
import { useCategories } from '../../api/rooms';
import { isApiError } from '../../api/client';
import { useCan } from '../../auth/session';
import { cn } from '../../lib/cn';
import { formatDay, plural } from '../../lib/format';
import { ReservationBadge } from '../../lib/reservation-status';
import { useDocumentTitle } from '../../lib/use-title';
import { Button, buttonVariants } from '../../ui/button';
import { EmptyState, Skeleton } from '../../ui/data';
import { Field, Input, SegmentedControl, Select } from '../../ui/form';
import { Drawer } from '../../ui/overlay';
import { Callout, DefinitionList, PageHeader, Panel } from '../../ui/page';
import { BlockModal, EndBlockModal, MoveStayModal, UnblockDialog } from './modals';
import type { ReservationStatus } from '../../api/reservations';

const DAY_LABELS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const dayNumber = (d: string) => Number(d.slice(8));
const monthLabel = (d: string) => MONTHS[Number(d.slice(5, 7)) - 1];

/** Teinte d'une barre de séjour : mêmes jetons que les pastilles d'état, pour que couleur et libellé disent la même chose. */
const STAY_TOKEN: Record<string, string> = { tentative: 'pending', pending: 'pending', confirmed: 'confirmed', checked_in: 'inhouse', checked_out: 'departed' };
const stayStyle = (status: string) => {
  const t = STAY_TOKEN[status] ?? 'confirmed';
  return { background: `var(--st-${t}-soft)`, color: `var(--st-${t})`, boxShadow: `inset 3px 0 0 var(--st-${t})`, ...(status === 'tentative' ? { outline: `1px dashed var(--st-${t})`, outlineOffset: '-2px' } : {}) };
};
const BLOCK_STYLE = { background: 'repeating-linear-gradient(135deg, var(--st-cancelled-soft) 0 6px, transparent 6px 12px)', color: 'var(--st-cancelled)', boxShadow: 'inset 3px 0 0 var(--st-cancelled)' };

type Selection = { kind: 'stay'; item: StayItem } | { kind: 'block'; item: BlockItem } | null;
type Dialog = null | 'block' | { move: StayItem } | { end: BlockItem } | { unblock: BlockItem };

export default function CalendarPage() {
  useDocumentTitle('Calendrier');
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const days = ([7, 14, 30].includes(Number(params.get('days'))) ? Number(params.get('days')) : 14) as 7 | 14 | 30;
  const from = params.get('from') && /^\d{4}-\d{2}-\d{2}$/.test(params.get('from')!) ? (params.get('from') as DateString) : undefined;
  const categoryId = params.get('category') ?? 'all';
  const cats = useCategories();
  const cal = useCalendar({ from, days, categoryId: categoryId === 'all' ? undefined : categoryId });
  const [selection, setSelection] = useState<Selection>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v === null || v === '' ? next.delete(k) : next.set(k, v));
    setParams(next, { replace: true });
  };
  const data = cal.data;
  const shift = (n: number) => data && set({ from: addDays(data.from, n) });
  const manage = can('calendar:move');

  return (
    <>
      <PageHeader
        title="Calendrier"
        description="L'occupation de toutes les chambres, nuit par nuit. Une barre = un séjour ; une zone hachurée = chambre bloquée (maintenance, hors service)."
        actions={
          <>
            {manage && <Button variant="secondary" onClick={() => setDialog('block')}><Lock aria-hidden className="size-4" />Bloquer une chambre</Button>}
            {can('reservations:create') && <Link to="/reservations/new" className={buttonVariants({ variant: 'primary' })}><CalendarPlus aria-hidden className="size-4" />Nouvelle réservation</Link>}
          </>
        }
      />
      <Panel>
        <div className="grid items-end gap-4 lg:grid-cols-[auto_11rem_14rem_auto]">
          <div className="flex items-center gap-2" role="group" aria-label="Période affichée">
            <Button variant="secondary" size="icon" onClick={() => shift(-days)} aria-label={`${days} jours plus tôt`} disabled={!data}><ChevronLeft aria-hidden className="size-4" /></Button>
            <Button variant="secondary" onClick={() => set({ from: null })}>Aujourd'hui</Button>
            <Button variant="secondary" size="icon" onClick={() => shift(days)} aria-label={`${days} jours plus tard`} disabled={!data}><ChevronRight aria-hidden className="size-4" /></Button>
          </div>
          <Field label="À partir du">{(c) => <Input {...c} type="date" value={data?.from ?? ''} onChange={(e) => e.target.value && set({ from: e.target.value })} />}</Field>
          <Field label="Catégorie">{(c) => <Select {...c} value={categoryId} onValueChange={(v) => set({ category: v === 'all' ? null : v })} options={[{ value: 'all', label: 'Toutes les catégories' }, ...(cats.data ?? []).map((x) => ({ value: x.id, label: x.name }))]} />}</Field>
          <SegmentedControl label="Durée affichée" value={String(days) as '7' | '14' | '30'} onValueChange={(v) => set({ days: v === '14' ? null : v })} options={[{ value: '7', label: '7 jours' }, { value: '14', label: '14 jours' }, { value: '30', label: '30 jours' }]} />
        </div>

        {cal.isError ? (
          <Callout tone="danger">{isApiError(cal.error) ? cal.error.message : 'Impossible de charger le calendrier.'}</Callout>
        ) : !data ? (
          <div className="flex flex-col gap-3" role="status" aria-label="Chargement du calendrier"><Skeleton className="h-10 w-full" /><Skeleton className="h-64 w-full" /></div>
        ) : data.rooms.length === 0 ? (
          <EmptyState kind="calendar" title="Aucune chambre à afficher" description="Créez vos chambres dans le module Chambres, elles apparaîtront ici." action={<Link to="/rooms" className="text-accent-ink underline">Aller aux chambres</Link>} />
        ) : (
          <Grid data={data} onSelect={setSelection} />
        )}
        <Legend />
      </Panel>

      <Drawer
        open={!!selection}
        onOpenChange={(o) => !o && setSelection(null)}
        title={selection?.kind === 'stay' ? `Séjour ${selection.item.reference}` : selection ? `Chambre bloquée — ${BLOCK_REASON_LABEL[selection.item.reason]}` : ''}
        description={selection ? (data?.rooms.find((r) => r.id === selection.item.roomId) ? `Chambre ${data.rooms.find((r) => r.id === selection.item.roomId)!.number}` : '') : undefined}
      >
        {selection?.kind === 'stay' && (
          <div className="flex flex-col gap-4">
            <ReservationBadge status={selection.item.status as ReservationStatus} />
            <DefinitionList items={[
              { label: 'Client', value: `${selection.item.guestName}${selection.item.isVip ? ' · VIP' : ''}` },
              { label: 'Arrivée', value: formatDay(selection.item.startsOn, true) },
              { label: 'Départ', value: formatDay(selection.item.endsOn, true) },
              { label: 'Durée', value: `${nightsBetween(selection.item.startsOn, selection.item.endsOn)} ${plural(nightsBetween(selection.item.startsOn, selection.item.endsOn), 'nuit', 'nuits')}` },
              { label: 'Personnes', value: `${selection.item.adults} ${plural(selection.item.adults, 'adulte', 'adultes')}${selection.item.children ? `, ${selection.item.children} ${plural(selection.item.children, 'enfant', 'enfants')}` : ''}` },
              { label: 'Reste à payer', value: formatMoney(selection.item.balanceDue, selection.item.currency) },
            ]} />
            <div className="flex flex-wrap gap-2">
              <Link to={`/reservations/${selection.item.reservationId}`} className={buttonVariants({ variant: 'primary' })}>Ouvrir la réservation</Link>
              {manage && ['tentative', 'pending', 'confirmed', 'checked_in'].includes(selection.item.status) && <Button variant="secondary" onClick={() => { const it = selection.item; setSelection(null); setDialog({ move: it }); }}>Déplacer</Button>}
            </div>
          </div>
        )}
        {selection?.kind === 'block' && (
          <div className="flex flex-col gap-4">
            <DefinitionList items={[
              { label: 'Motif', value: BLOCK_REASON_LABEL[selection.item.reason] },
              { label: 'Depuis le', value: formatDay(selection.item.startsOn, true) },
              { label: "Jusqu'au", value: selection.item.endsOn ? formatDay(selection.item.endsOn, true) : "Jusqu'à nouvel ordre" },
              ...(selection.item.notes ? [{ label: 'Note', value: selection.item.notes }] : []),
            ]} />
            {manage && (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => { const it = selection.item; setSelection(null); setDialog({ end: it }); }}>Modifier la fin</Button>
                <Button variant="danger" onClick={() => { const it = selection.item; setSelection(null); setDialog({ unblock: it }); }}>Lever le blocage</Button>
              </div>
            )}
          </div>
        )}
      </Drawer>

      {dialog === 'block' && data && <BlockModal rooms={data.rooms} today={data.today} onClose={() => setDialog(null)} />}
      {typeof dialog === 'object' && dialog && 'move' in dialog && <MoveStayModal stay={dialog.move} rooms={data?.rooms ?? []} onClose={() => setDialog(null)} />}
      {typeof dialog === 'object' && dialog && 'end' in dialog && <EndBlockModal block={dialog.end} onClose={() => setDialog(null)} />}
      {typeof dialog === 'object' && dialog && 'unblock' in dialog && <UnblockDialog block={dialog.unblock} onClose={() => setDialog(null)} />}
    </>
  );
}

function Legend() {
  const items: Array<[string, string]> = [['confirmed', 'Confirmée'], ['pending', 'En attente ou option (tirets)'], ['inhouse', 'En séjour'], ['departed', 'Parti']];
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-ink-2" aria-label="Légende">
      {items.map(([t, label]) => <li key={t} className="flex items-center gap-2"><span aria-hidden className="size-3.5 rounded-[4px]" style={{ background: `var(--st-${t}-soft)`, boxShadow: `inset 3px 0 0 var(--st-${t})` }} />{label}</li>)}
      <li className="flex items-center gap-2"><span aria-hidden className="size-3.5 rounded-[4px]" style={BLOCK_STYLE} /><Ban aria-hidden className="size-3.5" />Chambre bloquée</li>
    </ul>
  );
}

/** Grille : un vrai tableau (lecteurs d'écran), colonne des chambres figée, une cellule par nuit, une barre par séjour. */
function Grid({ data, onSelect }: { data: CalendarData; onSelect: (s: Selection) => void }) {
  const dates = useMemo(() => Array.from({ length: data.days }, (_, i) => addDays(data.from, i)), [data.from, data.days]);
  const byRoom = useMemo(() => {
    const m = new Map<string, Array<StayItem | BlockItem>>();
    for (const it of data.items) m.set(it.roomId, [...(m.get(it.roomId) ?? []), it]);
    return m;
  }, [data.items]);
  const groups = useMemo(() => {
    const g: Array<{ name: string; rooms: typeof data.rooms }> = [];
    for (const r of data.rooms) {
      const last = g[g.length - 1];
      if (last && last.name === r.categoryName) last.rooms.push(r);
      else g.push({ name: r.categoryName, rooms: [r] });
    }
    return g;
  }, [data]);
  const cellTone = (d: DateString) => cn(d === data.today && 'bg-accent-soft', d !== data.today && [5, 6].includes(weekday(d)) && 'bg-silver-soft');

  return (
    <div tabIndex={0} role="region" aria-label="Grille d'occupation" className="overflow-x-auto rounded-[14px] border border-hairline">
      <table className="border-collapse text-[13px]" style={{ tableLayout: 'fixed', width: `calc(9rem + ${data.days} * 2.9rem)` }}>
        <caption className="sr-only">Occupation des chambres du {formatDay(data.from)} au {formatDay(addDays(data.to, -1))}</caption>
        <colgroup><col style={{ width: '9rem' }} />{dates.map((d) => <col key={d} style={{ width: '2.9rem' }} />)}</colgroup>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 bg-[var(--glass-data)] px-3 py-2 text-left font-medium text-ink-2">Chambre</th>
            {dates.map((d, i) => (
              <th key={d} scope="col" aria-label={`${DAY_LABELS[weekday(d)]} ${dayNumber(d)} ${monthLabel(d)}`} className={cn('border-l border-hairline px-0.5 py-1.5 text-center font-medium', cellTone(d), d === data.today ? 'text-accent-ink' : 'text-ink-2')}>
                {(i === 0 || dayNumber(d) === 1) && <span className="block text-[11px] leading-none text-ink-3">{monthLabel(d)}</span>}
                <span className="block text-[11px] leading-tight">{DAY_LABELS[weekday(d)]}</span>
                <span className="block text-[14px] leading-tight text-ink">{dayNumber(d)}</span>
              </th>
            ))}
          </tr>
          <tr className="border-t border-hairline">
            <th scope="row" className="sticky left-0 z-10 bg-[var(--glass-data)] px-3 py-1.5 text-left font-medium text-ink-2">Occupation</th>
            {data.occupancy.map((o) => {
              const sellable = o.total - o.blocked;
              return (
                <td key={o.date} title={`${o.occupied} chambre${o.occupied > 1 ? 's' : ''} occupée${o.occupied > 1 ? 's' : ''} sur ${sellable}`} className={cn('border-l border-hairline px-0.5 py-1.5 text-center text-[12px] text-ink-2', cellTone(o.date))}>
                  <span className="num-col">{o.occupied}/{sellable}</span>
                </td>
              );
            })}
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.name}>
            <tr className="border-t border-hairline"><th scope="rowgroup" colSpan={data.days + 1} className="sticky left-0 bg-silver-soft px-3 py-1.5 text-left text-[12px] font-semibold text-ink-2">{g.name}</th></tr>
            {g.rooms.map((room) => {
              const items = (byRoom.get(room.id) ?? []).slice().sort((a, b) => (a.startsOn < b.startsOn ? -1 : 1));
              const cells: React.ReactNode[] = [];
              let i = 0;
              const used = new Set<string>();
              while (i < data.days) {
                const date = dates[i]!;
                const it = items.find((x) => !used.has(x.id) && x.startsOn <= date && (x.endsOn === null || x.endsOn > date));
                if (!it) { cells.push(<td key={date} className={cn('h-10 border-l border-hairline', cellTone(date))} />); i++; continue; }
                used.add(it.id);
                const end = it.endsOn === null || it.endsOn > data.to ? data.to : it.endsOn;
                const span = Math.max(1, nightsBetween(date, end));
                const label = it.kind === 'stay'
                  ? `Chambre ${room.number}, ${it.guestName}, du ${formatDay(it.startsOn)} au ${formatDay(it.endsOn)}, ${it.status === 'tentative' ? 'option' : it.status === 'pending' ? 'en attente' : it.status === 'confirmed' ? 'confirmée' : it.status === 'checked_in' ? 'en séjour' : 'terminée'}`
                  : `Chambre ${room.number} bloquée : ${BLOCK_REASON_LABEL[it.reason]}${it.endsOn ? `, jusqu'au ${formatDay(it.endsOn)}` : ", jusqu'à nouvel ordre"}`;
                cells.push(
                  <td key={it.id} colSpan={span} className="h-10 border-l border-hairline p-0.5">
                    <button type="button" onClick={() => onSelect(it.kind === 'stay' ? { kind: 'stay', item: it } : { kind: 'block', item: it })} aria-label={label}
                      className={cn('flex h-full w-full cursor-pointer items-center gap-1.5 overflow-hidden rounded-[8px] px-2 text-left text-[12.5px] font-medium whitespace-nowrap', it.startsOn < data.from && 'rounded-l-none', (it.endsOn === null || it.endsOn > data.to) && 'rounded-r-none')}
                      style={it.kind === 'stay' ? stayStyle(it.status) : BLOCK_STYLE}>
                      {it.kind === 'block' && <Ban aria-hidden className="size-3.5 shrink-0" />}
                      <span className="truncate">{it.kind === 'stay' ? it.guestName : BLOCK_REASON_LABEL[it.reason]}</span>
                    </button>
                  </td>,
                );
                i += span;
              }
              return (
                <tr key={room.id} className="border-t border-hairline">
                  <th scope="row" className="sticky left-0 z-10 bg-[var(--glass-data)] px-3 py-1 text-left font-medium text-ink"><span>{room.number}</span>{room.name && <span className="ml-1.5 text-[12px] font-normal text-ink-3">{room.name}</span>}</th>
                  {cells}
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}
