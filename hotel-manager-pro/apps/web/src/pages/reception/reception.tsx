import { addDays, formatMoney } from '@hmp/shared';
import { ChevronLeft, ChevronRight, DoorOpen, LogIn, LogOut, Repeat, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { isApiError } from '../../api/client';
import { useAvailability } from '../../api/reservations';
import { useChangeRoom, useCheckIn, useCheckOut, useReceptionOverview, type ReceptionLine } from '../../api/reception';
import { useCan } from '../../auth/session';
import { formatDay, plural } from '../../lib/format';
import { useDocumentTitle } from '../../lib/use-title';
import { ActionModal } from '../../ui/action-modal';
import { Button, buttonVariants } from '../../ui/button';
import { Badge, EmptyState, Skeleton, StateBadge } from '../../ui/data';
import { Field, Input, SegmentedControl, Select, Switch } from '../../ui/form';
import { ConfirmDialog } from '../../ui/overlay';
import { Callout, PageHeader, Panel } from '../../ui/page';

type Section = 'arrivals' | 'departures' | 'inhouse';
type Dialog = null | { kind: 'force'; line: ReceptionLine } | { kind: 'out'; line: ReceptionLine; unpaid?: boolean } | { kind: 'room'; line: ReceptionLine };

const HK_LABEL: Record<string, string> = { dirty: 'À nettoyer', cleaning: 'En nettoyage', clean: 'Propre', inspected: 'Contrôlée' };

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warning' }) {
  return (
    <div className="surface glass-1 flex flex-col gap-1 p-5 [--surface-radius:var(--r-card)]">
      <dt className="text-[13px] text-ink-2">{label}</dt>
      <dd className={`num-display text-[26px] font-semibold ${tone === 'warning' ? 'text-[var(--st-pending)]' : 'text-ink'}`}>{value}</dd>
      {sub && <span className="text-[12.5px] text-ink-3">{sub}</span>}
    </div>
  );
}

export default function ReceptionPage() {
  useDocumentTitle('Réception');
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const requested = params.get('date') && /^\d{4}-\d{2}-\d{2}$/.test(params.get('date')!) ? params.get('date')! : undefined;
  const section = (params.get('section') as Section) ?? 'arrivals';
  const ov = useReceptionOverview(requested);
  const [dialog, setDialog] = useState<Dialog>(null);
  const checkIn = useCheckIn();
  const checkOut = useCheckOut();
  const o = ov.data;
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v === null || v === '' ? next.delete(k) : next.set(k, v));
    setParams(next, { replace: true });
  };

  const doCheckIn = (line: ReceptionLine, force = false) =>
    checkIn.mutate({ lineIds: [line.lineId], force }, {
      onSuccess: () => { setDialog(null); toast.success(`Arrivée enregistrée — chambre ${line.roomNumber}.`); },
      onError: (e) => {
        if (isApiError(e) && e.code === 'room_not_ready') return setDialog({ kind: 'force', line });
        setDialog(null);
        toast.error(isApiError(e) ? e.message : "L'arrivée n'a pas pu être enregistrée.");
      },
    });

  const list = !o ? [] : section === 'arrivals' ? o.arrivals : section === 'departures' ? o.departures : o.inHouse;
  const today = o?.today;

  return (
    <>
      <PageHeader title="Réception" description="La journée en un coup d'œil : qui arrive, qui part, qui est en séjour. Les actions respectent l'état réel des chambres et des notes." />
      <Panel>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-2" role="group" aria-label="Jour affiché">
            <Button variant="secondary" size="icon" onClick={() => o && set({ date: addDays(o.date, -1) })} aria-label="Jour précédent" disabled={!o}><ChevronLeft aria-hidden className="size-4" /></Button>
            <Button variant="secondary" onClick={() => set({ date: null })}>Aujourd'hui</Button>
            <Button variant="secondary" size="icon" onClick={() => o && set({ date: addDays(o.date, 1) })} aria-label="Jour suivant" disabled={!o}><ChevronRight aria-hidden className="size-4" /></Button>
            <span className="ml-2 text-[15px] font-medium text-ink" aria-live="polite">{o ? formatDay(o.date, true) : ''}</span>
          </div>
          <SegmentedControl label="Liste affichée" value={section} onValueChange={(v) => set({ section: v === 'arrivals' ? null : v })} options={[{ value: 'arrivals', label: 'Arrivées' }, { value: 'departures', label: 'Départs' }, { value: 'inhouse', label: 'En séjour' }]} />
        </div>

        {ov.isError ? <Callout tone="danger">Impossible de charger la journée.</Callout> : !o ? (
          <div className="flex flex-col gap-3" role="status" aria-label="Chargement"><Skeleton className="h-20 w-full" /><Skeleton className="h-40 w-full" /></div>
        ) : (
          <>
            <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Chiffres du jour">
              <Tile label="Arrivées" value={`${o.counts.arrivalsDone}/${o.counts.arrivals}`} sub="enregistrées" />
              <Tile label="Départs" value={`${o.counts.departuresDone}/${o.counts.departures}`} sub="enregistrés" />
              <Tile label="En séjour" value={String(o.counts.inHouse)} sub={o.counts.inHouse > 1 ? 'chambres occupées' : 'chambre occupée'} />
              <Tile label="Départs en retard" value={String(o.counts.overdue)} sub="date de départ dépassée" tone={o.counts.overdue ? 'warning' : undefined} />
            </dl>
            {o.overdue.length > 0 && (
              <Callout tone="warning">
                {o.overdue.length} {plural(o.overdue.length, 'client devait', 'clients devaient')} partir avant aujourd'hui : {o.overdue.map((l) => `chambre ${l.roomNumber} (${l.guestName})`).join(', ')}. Enregistrez leur départ, ou prolongez leur séjour depuis la réservation.
              </Callout>
            )}
            {list.length === 0 ? (
              <EmptyState kind="calendar" title={section === 'arrivals' ? 'Aucune arrivée ce jour' : section === 'departures' ? 'Aucun départ ce jour' : 'Personne en séjour'} description={section === 'inhouse' ? "Les clients apparaissent ici dès l'enregistrement de leur arrivée." : 'Rien à traiter pour cette journée.'} />
            ) : (
              <ul className="flex flex-col gap-3" aria-label={section === 'arrivals' ? 'Arrivées' : section === 'departures' ? 'Départs' : 'Clients en séjour'}>
                {list.map((l) => {
                  const arrived = l.status === 'checked_in' || l.status === 'checked_out';
                  const notReady = l.housekeepingStatus && !['clean', 'inspected'].includes(l.housekeepingStatus);
                  return (
                    <li key={l.lineId} className="flex flex-col gap-3 rounded-[16px] border border-hairline bg-[var(--glass-data)] p-4 md:flex-row md:items-center md:justify-between">
                      <div className="flex min-w-0 items-start gap-4">
                        <span className="flex size-12 shrink-0 flex-col items-center justify-center rounded-[12px] bg-accent-soft text-accent-ink"><DoorOpen aria-hidden className="size-3.5" /><span className="num-col text-[15px] font-semibold">{l.roomNumber ?? '—'}</span></span>
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink">{l.guestName}{l.isVip && <Badge tone="champagne">VIP</Badge>}</span>
                          <span className="text-[13px] text-ink-2"><Link to={`/reservations/${l.reservationId}`} className="text-accent-ink hover:underline">{l.reference}</Link> · {l.categoryName} · {formatDay(l.checkIn)} → {formatDay(l.checkOut)} · {l.adults + l.children} {plural(l.adults + l.children, 'personne', 'personnes')}</span>
                          <span className="flex flex-wrap items-center gap-2 pt-1">
                            {l.balanceDue > 0 ? <StateBadge tone="warning">Reste {formatMoney(l.balanceDue, l.currency)}</StateBadge> : <StateBadge tone="success">Soldée</StateBadge>}
                            {!l.depositSatisfied && l.status !== 'checked_out' && <StateBadge tone="warning">Acompte attendu</StateBadge>}
                            {section === 'arrivals' && !arrived && notReady && <StateBadge tone="warning">{HK_LABEL[l.housekeepingStatus!] ?? 'Chambre non prête'}</StateBadge>}
                            {arrived && l.status === 'checked_out' && <Badge>Parti</Badge>}
                            {arrived && l.status === 'checked_in' && section === 'arrivals' && <StateBadge tone="success">Arrivé</StateBadge>}
                          </span>
                          {l.specialRequests && <span className="pt-1 text-[13px] text-ink-2">« {l.specialRequests} »</span>}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {l.folioId && can('billing:read') && l.balanceDue > 0 && <Link to={`/billing/folios/${l.folioId}`} className={buttonVariants({ variant: 'secondary' })}>Encaisser</Link>}
                        {can('reception:checkin') && (l.status === 'pending' || l.status === 'confirmed') && today && l.checkIn <= today && <Button variant="primary" loading={checkIn.isPending} onClick={() => doCheckIn(l)} aria-label={`Enregistrer l'arrivée de ${l.guestName}, chambre ${l.roomNumber}`}><LogIn aria-hidden className="size-4" />Arrivée</Button>}
                        {can('reception:checkin') && l.status === 'checked_in' && <Button variant="secondary" onClick={() => setDialog({ kind: 'room', line: l })} aria-label={`Changer ${l.guestName} de chambre`}><Repeat aria-hidden className="size-4" />Changer de chambre</Button>}
                        {can('reception:checkout') && l.status === 'checked_in' && <Button variant={section === 'departures' ? 'primary' : 'secondary'} onClick={() => setDialog({ kind: 'out', line: l })} aria-label={`Enregistrer le départ de ${l.guestName}, chambre ${l.roomNumber}`}><LogOut aria-hidden className="size-4" />Départ</Button>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </Panel>

      <ConfirmDialog
        open={dialog?.kind === 'force'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="La chambre n'est pas prête"
        description={dialog?.kind === 'force' ? `La chambre ${dialog.line.roomNumber} est « ${HK_LABEL[dialog.line.housekeepingStatus ?? ''] ?? 'non prête'} ». Enregistrer l'arrivée quand même ? Cette décision est tracée.` : ''}
        confirmLabel="Enregistrer quand même"
        destructive={false}
        loading={checkIn.isPending}
        onConfirm={() => dialog?.kind === 'force' && doCheckIn(dialog.line, true)}
      />
      {dialog?.kind === 'out' && <CheckOutModal line={dialog.line} today={o?.today ?? ''} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'room' && <ChangeRoomModal line={dialog.line} today={o?.today ?? dialog.line.checkIn} onClose={() => setDialog(null)} />}
    </>
  );
}

function CheckOutModal({ line, today, onClose }: { line: ReceptionLine; today: string; onClose: () => void }) {
  const out = useCheckOut();
  const [allowUnpaid, setAllowUnpaid] = useState(false);
  const [shorten, setShorten] = useState(false);
  const [needsUnpaid, setNeedsUnpaid] = useState(false);
  const early = line.checkOut > today && line.checkIn < today;
  return (
    <ActionModal
      title={`Départ de ${line.guestName}`}
      description={`Chambre ${line.roomNumber} · ${line.reference}. La chambre passera « à nettoyer ».`}
      confirmLabel="Enregistrer le départ"
      onClose={onClose}
      onSubmit={() =>
        out.mutateAsync({ lineIds: [line.lineId], allowUnpaid, shorten }).then((r) => {
          toast.success(r.folioClosed ? 'Départ enregistré — note clôturée.' : r.unpaid > 0 ? `Départ enregistré — solde impayé ${formatMoney(r.unpaid, line.currency)}.` : 'Départ enregistré.');
        }).catch((e) => {
          if (isApiError(e) && e.code === 'balance_outstanding') setNeedsUnpaid(true);
          throw e;
        })
      }
    >
      {line.balanceDue > 0 && <Callout tone="warning">Il reste {formatMoney(line.balanceDue, line.currency)} à régler. Encaissez-le avant le départ, ou confirmez le départ avec un solde impayé (tracé).</Callout>}
      {(needsUnpaid || line.balanceDue > 0) && <Switch label="Départ avec solde impayé" description="La note reste ouverte : le paiement pourra être encaissé plus tard." checked={allowUnpaid} onCheckedChange={setAllowUnpaid} />}
      {early && <Switch label="Départ anticipé : retirer les nuits non occupées" description={`Départ prévu le ${formatDay(line.checkOut)}. Les nuits restantes ne sont plus facturées (refusé si la réservation est déjà facturée).`} checked={shorten} onCheckedChange={setShorten} />}
    </ActionModal>
  );
}

function ChangeRoomModal({ line, today, onClose }: { line: ReceptionLine; today: string; onClose: () => void }) {
  const change = useChangeRoom();
  const [roomId, setRoomId] = useState('');
  const [reason, setReason] = useState('');
  // Libre du jour (ou de l'arrivée, si elle est à venir) jusqu'au départ : la partie déjà passée du séjour ne compte pas
  const avail = useAvailability({ checkIn: today > line.checkIn ? today : line.checkIn, checkOut: line.checkOut, adults: line.adults, children: line.children, excludeLineId: line.lineId });
  const options = (avail.data?.categories ?? []).flatMap((c) => c.rooms.filter((r) => r.id !== line.roomId).map((r) => ({ value: r.id, label: `Chambre ${r.number} — ${c.name}` })));
  return (
    <ActionModal
      title={`Changer ${line.guestName} de chambre`}
      description={`Actuellement chambre ${line.roomNumber}. L'ancienne chambre passe « à nettoyer ». Les nuits restantes gardent leur prix convenu.`}
      confirmLabel="Changer de chambre"
      onClose={onClose}
      onSubmit={() => {
        if (!roomId) return 'Choisissez la nouvelle chambre.';
        return change.mutateAsync({ lineId: line.lineId, roomId, reason: reason.trim() || undefined }).then((r) => void toast.success(`Chambre ${r.from} → ${r.to}.`));
      }}
    >
      <Field label="Nouvelle chambre" required hint="Chambres libres jusqu'au départ du client et assez grandes.">{(c) => <Select {...c} value={roomId} onValueChange={setRoomId} options={options} placeholder={avail.isPending ? 'Recherche…' : options.length ? 'Choisir une chambre' : 'Aucune chambre libre'} />}</Field>
      <Field label="Motif (facultatif)">{(c) => <Input {...c} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Bruit, climatisation en panne…" />}</Field>
    </ActionModal>
  );
}
