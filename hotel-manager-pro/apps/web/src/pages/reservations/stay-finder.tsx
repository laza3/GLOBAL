import { addDays, formatMoney, nightsBetween, todayIn, type DateString } from '@hmp/shared';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useHotel } from '../../api/hotel';
import { isApiError } from '../../api/client';
import { useAvailability, type AvailabilityCategory, type NewLine } from '../../api/reservations';
import { formatDay, plural } from '../../lib/format';
import { Button } from '../../ui/button';
import { Badge, EmptyState, Skeleton } from '../../ui/data';
import { Field, Input, Select } from '../../ui/form';
import { Callout } from '../../ui/page';

export interface PickedLine extends NewLine { categoryName: string; roomNumber: string | null; subtotal: number }

/**
 * Recherche de disponibilité : dates + personnes → catégories avec chambres libres, prix exact du séjour (le même calcul que le
 * serveur appliquera) et choix de la chambre. Sert à la création d'une réservation et à l'ajout d'une chambre.
 */
export function StayFinder({ currency, onPick, defaults }: {
  currency: string; onPick: (line: PickedLine) => void; defaults?: { checkIn?: DateString; checkOut?: DateString; adults?: number };
}) {
  const tz = useHotel().data?.timezone ?? 'Indian/Antananarivo';
  const today = todayIn(tz);
  const [checkIn, setCheckIn] = useState<DateString>(defaults?.checkIn ?? today);
  const [checkOut, setCheckOut] = useState<DateString>(defaults?.checkOut ?? addDays(today, 1));
  const [adults, setAdults] = useState(String(defaults?.adults ?? 2));
  const [children, setChildren] = useState('0');
  const a = Math.min(Math.max(Math.trunc(Number(adults)) || 1, 1), 30);
  const c = Math.min(Math.max(Math.trunc(Number(children)) || 0, 0), 30);
  const valid = !!checkIn && !!checkOut && checkOut > checkIn && checkIn >= today;
  const avail = useAvailability({ checkIn, checkOut, adults: a, children: c }, valid);
  const nights = valid ? nightsBetween(checkIn, checkOut) : 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Arrivée" required>{(f) => <Input {...f} type="date" min={today} value={checkIn} onChange={(e) => { setCheckIn(e.target.value); if (e.target.value && checkOut <= e.target.value) setCheckOut(addDays(e.target.value, 1)); }} />}</Field>
        <Field label="Départ" required>{(f) => <Input {...f} type="date" min={checkIn ? addDays(checkIn, 1) : today} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />}</Field>
        <Field label="Adultes">{(f) => <Input {...f} inputMode="numeric" value={adults} onChange={(e) => setAdults(e.target.value)} />}</Field>
        <Field label="Enfants">{(f) => <Input {...f} inputMode="numeric" value={children} onChange={(e) => setChildren(e.target.value)} />}</Field>
      </div>
      {!valid ? (
        <Callout tone="warning">{checkIn && checkIn < today ? "L'arrivée ne peut pas être dans le passé." : checkOut <= checkIn ? "Le départ doit être après l'arrivée." : 'Indiquez les dates du séjour.'}</Callout>
      ) : avail.isPending ? (
        <div className="flex flex-col gap-3" role="status" aria-label="Recherche des disponibilités"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
      ) : avail.isError ? (
        <Callout tone="danger">{isApiError(avail.error) ? avail.error.message : 'Recherche impossible.'}</Callout>
      ) : avail.data.categories.length === 0 ? (
        <EmptyState kind="calendar" title="Aucune catégorie de chambres" description="Créez d'abord une catégorie et des chambres dans le module Chambres." />
      ) : (
        <ul className="flex flex-col gap-3" aria-label={`Disponibilités du ${formatDay(checkIn)} au ${formatDay(checkOut)}, ${nights} ${plural(nights, 'nuit', 'nuits')}`}>
          {avail.data.categories.map((cat) => (
            <CategoryRow key={cat.id} cat={cat} currency={currency} nights={nights}
              onAdd={(roomId) => {
                const room = roomId ? cat.rooms.find((r) => r.id === roomId) : null;
                onPick({ categoryId: cat.id, roomId, checkIn, checkOut, adults: a, children: c, categoryName: cat.name, roomNumber: room?.number ?? null, subtotal: room?.subtotal ?? cat.subtotal });
              }} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CategoryRow({ cat, currency, nights, onAdd }: { cat: AvailabilityCategory; currency: string; nights: number; onAdd: (roomId: string | null) => void }) {
  const [roomId, setRoomId] = useState('auto');
  const blocked = cat.freeCount === 0 || !cat.minStayRespected;
  return (
    <li className="flex flex-col gap-3 rounded-[16px] border border-hairline bg-[var(--glass-data)] p-4 md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] font-semibold text-ink">{cat.name}</span>
          {cat.freeCount === 0 ? <Badge>Complet</Badge> : <Badge tone="accent">{cat.freeCount} {plural(cat.freeCount, 'chambre libre', 'chambres libres')}</Badge>}
        </span>
        <span className="num-col text-[14px] text-ink-2">
          {formatMoney(cat.subtotal, currency)} pour {nights} {plural(nights, 'nuit', 'nuits')} · {formatMoney(cat.averageRate, currency)} / nuit en moyenne
        </span>
        {!cat.minStayRespected && <span className="text-[13px] text-[var(--st-pending)]">Séjour minimal de {cat.minStay} nuits sur cette période.</span>}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {cat.freeCount > 1 && (
          <div className="w-56">
            <Field label="Chambre">
              {(f) => <Select {...f} value={roomId} onValueChange={setRoomId} options={[{ value: 'auto', label: 'Attribution automatique' }, ...cat.rooms.map((r) => ({ value: r.id, label: `Chambre ${r.number} · ${r.capacity} pers.` }))]} />}
            </Field>
          </div>
        )}
        <Button variant="primary" disabled={blocked} onClick={() => onAdd(roomId === 'auto' ? null : roomId)} aria-label={`Ajouter une chambre ${cat.name}`}>
          <Plus aria-hidden className="size-4" />Ajouter
        </Button>
      </div>
    </li>
  );
}
