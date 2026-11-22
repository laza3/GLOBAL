import { addDays, formatMoney, todayIn } from '@hmp/shared';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useHotel } from '../../api/hotel';
import { isApiError } from '../../api/client';
import { useCategories, useDeleteRate, useQuote, useRates, useRooms, type RatePeriod } from '../../api/rooms';
import { useCan } from '../../auth/session';
import { formatDate } from '../../lib/format';
import { useCurrency } from '../../lib/use-currency';
import { useDocumentTitle } from '../../lib/use-title';
import { Button } from '../../ui/button';
import { Badge, DataTable, EmptyState, StateBadge } from '../../ui/data';
import { Field, Input, Select } from '../../ui/form';
import { ConfirmDialog } from '../../ui/overlay';
import { Callout, Panel } from '../../ui/page';
import { RateModal } from './modals';

const SOURCE: Record<string, string> = { room: 'Tarif de la chambre', season: 'Saison', base: 'Tarif de base' };

/** Simulateur : montre exactement ce que le serveur facturerait, nuit par nuit (mêmes règles que les réservations). */
function Simulator() {
  const currency = useCurrency();
  const tz = useHotel().data?.timezone ?? 'Indian/Antananarivo';
  const cats = useCategories();
  const [categoryId, setCategoryId] = useState('');
  const [roomId, setRoomId] = useState('any');
  const [checkIn, setCheckIn] = useState(addDays(todayIn(tz), 7));
  const [checkOut, setCheckOut] = useState(addDays(todayIn(tz), 10));
  const rooms = useRooms({ categoryId: categoryId || undefined });
  const cid = categoryId || cats.data?.[0]?.id || '';
  const quote = useQuote({ categoryId: cid, roomId: roomId === 'any' ? undefined : roomId, checkIn, checkOut });

  return (
    <Panel title="Simulateur de prix" description="Vérifiez ce qu'un séjour coûterait, nuit par nuit, avec vos tarifs actuels.">
      <div className="grid gap-4 md:grid-cols-4">
        <Field label="Catégorie">{(c) => <Select {...c} value={cid} onValueChange={(v) => { setCategoryId(v); setRoomId('any'); }} options={(cats.data ?? []).map((x) => ({ value: x.id, label: x.name }))} />}</Field>
        <Field label="Chambre">{(c) => <Select {...c} value={roomId} onValueChange={setRoomId} options={[{ value: 'any', label: 'Selon la catégorie' }, ...(rooms.data ?? []).filter((r) => r.categoryId === cid).map((r) => ({ value: r.id, label: `Chambre ${r.number}` }))]} />}</Field>
        <Field label="Arrivée">{(c) => <Input {...c} type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />}</Field>
        <Field label="Départ">{(c) => <Input {...c} type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />}</Field>
      </div>
      {checkOut <= checkIn ? (
        <Callout tone="warning">Le départ doit être après l&apos;arrivée.</Callout>
      ) : quote.isPending ? (
        <p className="text-[14px] text-ink-2" role="status">Calcul…</p>
      ) : quote.isError ? (
        <Callout tone="danger">{isApiError(quote.error) ? quote.error.message : 'Calcul impossible.'}</Callout>
      ) : (
        <div className="flex flex-col gap-4">
          <table className="w-full text-[14px]">
            <caption className="sr-only">Détail du prix, nuit par nuit</caption>
            <thead><tr className="border-b border-hairline text-left text-[13px] text-ink-2"><th scope="col" className="py-2 font-medium">Nuit</th><th scope="col" className="py-2 font-medium">Origine du tarif</th><th scope="col" className="py-2 text-right font-medium">Prix</th></tr></thead>
            <tbody>
              {quote.data.nights.map((n) => (
                <tr key={n.night} className="border-b border-hairline">
                  <td className="py-2.5">{formatDate(`${n.night}T12:00:00Z`, { timeZone: 'UTC' })}</td>
                  <td className="py-2.5 text-ink-2">{SOURCE[n.source]}{n.periodName ? ` : ${n.periodName}` : ''}</td>
                  <td className="num-col py-2.5 text-right">{formatMoney(n.rate, currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><th scope="row" colSpan={2} className="py-3 text-left font-semibold">Total — {quote.data.nights.length} nuit{quote.data.nights.length > 1 ? 's' : ''}</th><td className="num-display py-3 text-right text-[20px] font-semibold">{formatMoney(quote.data.subtotal, currency)}</td></tr></tfoot>
          </table>
          {!quote.data.minStayRespected && <Callout tone="warning">Cette période impose un séjour minimal de {quote.data.minStay} nuits : ce séjour serait refusé à la réservation.</Callout>}
        </div>
      )}
    </Panel>
  );
}

export default function RatesPage() {
  useDocumentTitle('Tarifs et saisons');
  const manage = useCan()('rooms:manage');
  const currency = useCurrency();
  const cats = useCategories();
  const rates = useRates();
  const del = useDeleteRate();
  const [editing, setEditing] = useState<RatePeriod | 'new' | null>(null);
  const [removing, setRemoving] = useState<RatePeriod | null>(null);
  const hasCats = (cats.data?.length ?? 0) > 0;

  return (
    <>
      <Panel
        title="Saisons et tarifs spéciaux"
        description="Hors de ces périodes, le tarif de base de la catégorie s'applique. Un tarif propre à une chambre remplace tout. Si deux périodes se chevauchent, la priorité la plus haute l'emporte."
        actions={manage && hasCats ? <Button variant="primary" onClick={() => setEditing('new')}><Plus aria-hidden className="size-4" />Nouvelle période</Button> : undefined}
      >
        {rates.isError ? <p className="text-[14px] text-ink-2">Impossible de charger les tarifs.</p> : (
          <DataTable<RatePeriod>
            caption="Périodes tarifaires"
            loading={rates.isPending}
            rows={rates.data ?? []}
            rowKey={(r) => r.id}
            columns={[
              { key: 'n', header: 'Période', cell: (r) => <span className="flex flex-col"><span className="font-medium text-ink">{r.name}</span><span className="text-[13px] text-ink-2">{r.categoryName}</span></span>, sortValue: (r) => r.name },
              { key: 'd', header: 'Dates', cell: (r) => `${formatDate(`${r.startsOn}T12:00:00Z`, { timeZone: 'UTC' })} → ${formatDate(`${r.endsOn}T12:00:00Z`, { timeZone: 'UTC' })}`, sortValue: (r) => r.startsOn },
              { key: 'r', header: 'Par nuit', align: 'right', cell: (r) => <span className="flex flex-col items-end"><span>{formatMoney(r.nightlyRate, currency)}</span>{r.weekendRate != null && <span className="text-[13px] text-ink-2">week-end {formatMoney(r.weekendRate, currency)}</span>}</span> },
              { key: 'm', header: 'Séjour min.', align: 'right', cell: (r) => `${r.minStay} nuit${r.minStay > 1 ? 's' : ''}` },
              { key: 'p', header: 'Priorité', align: 'right', cell: (r) => r.priority },
              { key: 's', header: 'État', cell: (r) => (r.isActive ? <StateBadge tone="success">Active</StateBadge> : <Badge>Désactivée</Badge>) },
              { key: 'a', header: 'Actions', cell: (r) => (manage ? <span className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setEditing(r)} aria-label={`Modifier la période ${r.name}`}>Modifier</Button><Button size="sm" variant="ghost" onClick={() => setRemoving(r)} aria-label={`Supprimer la période ${r.name}`}>Supprimer</Button></span> : null) },
            ]}
            mobileCard={(r) => (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-3"><span className="font-medium text-ink">{r.name}</span>{r.isActive ? <StateBadge tone="success">Active</StateBadge> : <Badge>Désactivée</Badge>}</div>
                <span className="text-[13px] text-ink-2">{r.categoryName} · {r.startsOn} → {r.endsOn}</span>
                <span className="num-col text-[15px] font-medium text-ink">{formatMoney(r.nightlyRate, currency)} / nuit</span>
                {manage && <span className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setEditing(r)}>Modifier</Button><Button size="sm" variant="ghost" onClick={() => setRemoving(r)}>Supprimer</Button></span>}
              </div>
            )}
            empty={<EmptyState kind="calendar" title="Aucune période tarifaire" description={hasCats ? 'Sans période, le tarif de base de chaque catégorie s\'applique toute l\'année.' : "Créez d'abord une catégorie de chambres."} action={manage && hasCats ? <Button variant="primary" onClick={() => setEditing('new')}>Ajouter une période</Button> : undefined} />}
          />
        )}
      </Panel>
      {hasCats && <Simulator />}
      {editing && <RateModal period={editing === 'new' ? null : editing} categories={(cats.data ?? []).filter((c) => c.isActive)} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Supprimer cette période ?"
        description={removing ? `« ${removing.name} » ne s'appliquera plus aux nouvelles réservations. Les réservations déjà enregistrées gardent leur prix.` : ''}
        confirmLabel="Supprimer la période"
        loading={del.isPending}
        onConfirm={() =>
          removing &&
          del.mutate(removing.id, {
            onSuccess: () => { setRemoving(null); toast.success('Période supprimée.'); },
            onError: (e) => { setRemoving(null); toast.error(isApiError(e) ? e.message : 'La suppression a échoué.'); },
          })
        }
      />
    </>
  );
}
