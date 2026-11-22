import { formatMoney } from '@hmp/shared';
import { ArrowLeft, BedDouble, CalendarCheck, CircleSlash, Pencil, Plus, UserX } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { isApiError } from '../../api/client';
import { useCancelRoom, useConfirmReservation, useNoShow, useReservation, type ReservationLine } from '../../api/reservations';
import { useCan } from '../../auth/session';
import { auditLabel } from '../../lib/audit-labels';
import { formatDate, formatDay, plural } from '../../lib/format';
import { ReservationBadge, SOURCE_LABEL } from '../../lib/reservation-status';
import { useDocumentTitle } from '../../lib/use-title';
import { Button } from '../../ui/button';
import { Badge, EmptyState, Skeleton, StateBadge } from '../../ui/data';
import { ConfirmDialog } from '../../ui/overlay';
import { Callout, DefinitionList, PageHeader, Panel } from '../../ui/page';
import { AddRoomModal, CancelReservationModal, EditLineModal, EditReservationModal } from './modals';

type Dialog = null | 'edit' | 'cancel' | 'confirm' | 'noshow' | 'add' | { line: ReservationLine; kind: 'edit' | 'cancel' };

const LINE_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = { confirmed: 'info', pending: 'warning', tentative: 'warning', checked_in: 'success', checked_out: 'neutral', cancelled: 'danger', no_show: 'danger' };
const LINE_LABEL: Record<string, string> = { confirmed: 'Confirmée', pending: 'En attente', tentative: 'Option', checked_in: 'En séjour', checked_out: 'Partie', cancelled: 'Annulée', no_show: 'Non présenté' };

export default function ReservationDetailPage() {
  const { id } = useParams();
  const can = useCan();
  const res = useReservation(id);
  const d = res.data;
  useDocumentTitle(d ? `Réservation ${d.reference}` : 'Réservation');
  const [dialog, setDialog] = useState<Dialog>(null);
  const confirm = useConfirmReservation();
  const noShow = useNoShow();
  const cancelRoom = useCancelRoom();
  const close = () => setDialog(null);
  const fail = (e: unknown) => { close(); toast.error(isApiError(e) ? e.message : "L'action a échoué."); };

  if (res.isPending) return <div className="flex flex-col gap-4" role="status" aria-label="Chargement de la réservation"><Skeleton className="h-9 w-64" /><Skeleton className="h-48 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (res.isError || !d) {
    const notFound = isApiError(res.error) && res.error.status === 404;
    return <EmptyState kind="search" title={notFound ? 'Réservation introuvable' : 'Impossible de charger la réservation'} description={notFound ? "Elle n'existe pas, ou n'appartient pas à cet établissement." : 'Vérifiez votre connexion et réessayez.'} action={<Link to="/reservations" className="text-accent-ink underline">Retour aux réservations</Link>} />;
  }

  const update = can('reservations:update');
  const cancel = can('reservations:cancel');
  const guestName = `${d.guest.firstName} ${d.guest.lastName}`;
  const live = d.rooms.filter((l) => !['cancelled', 'no_show'].includes(l.status));
  const shown = d.status === 'cancelled' || d.status === 'no_show' ? d.rooms : live;
  const first = shown[0];
  const last = shown[shown.length - 1];

  return (
    <>
      <PageHeader
        title={d.reference}
        description={`${guestName} · ${first ? `${formatDay(first.checkIn, true)} → ${formatDay(shown.reduce((m, l) => (l.checkOut > m ? l.checkOut : m), last?.checkOut ?? ''), true)}` : ''}`}
        actions={
          <>
            <ReservationBadge status={d.status} />
            {update && d.actions.confirm && <Button variant="primary" onClick={() => setDialog('confirm')}><CalendarCheck aria-hidden className="size-4" />Confirmer</Button>}
            {update && d.actions.edit && <Button variant="secondary" onClick={() => setDialog('edit')}><Pencil aria-hidden className="size-4" />Modifier</Button>}
            {update && d.actions.noShow && <Button variant="secondary" onClick={() => setDialog('noshow')}><UserX aria-hidden className="size-4" />Non présenté</Button>}
            {cancel && d.actions.cancel && <Button variant="danger" onClick={() => setDialog('cancel')}><CircleSlash aria-hidden className="size-4" />Annuler</Button>}
          </>
        }
      />
      <Link to="/reservations" className="-mt-2 inline-flex min-h-10 items-center gap-2 self-start text-[14px] font-medium text-accent-ink hover:underline"><ArrowLeft aria-hidden className="size-4" />Toutes les réservations</Link>

      {d.status === 'tentative' && d.tentativeExpiresAt && <Callout tone="warning">Option valable jusqu'au {formatDate(d.tentativeExpiresAt, { time: true })}. Sans confirmation avant cette échéance, la réservation est annulée et les chambres sont libérées automatiquement.</Callout>}
      {d.status === 'cancelled' && <Callout tone="danger">Annulée le {formatDate(d.cancelledAt, { time: true })}{d.cancelReason ? ` — ${d.cancelReason}` : ''}.</Callout>}
      {d.status === 'no_show' && <Callout tone="danger">Le client ne s'est pas présenté. Les chambres ont été libérées.</Callout>}

      <div className="grid items-start gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel
            title="Chambres"
            actions={update && d.actions.addRoom ? <Button size="sm" variant="secondary" onClick={() => setDialog('add')}><Plus aria-hidden className="size-4" />Ajouter une chambre</Button> : undefined}
          >
            <ul className="flex flex-col gap-3" aria-label="Chambres de la réservation">
              {d.rooms.map((l) => {
                const open = !['cancelled', 'no_show', 'checked_out'].includes(l.status);
                return (
                  <li key={l.id} className="flex flex-col gap-3 rounded-[16px] border border-hairline bg-[var(--glass-data)] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink"><BedDouble aria-hidden className="size-4 text-ink-3" />Chambre {l.roomNumber ?? '—'}<span className="font-normal text-ink-2">· {l.categoryName}</span></span>
                        <span className="text-[14px] text-ink-2">{formatDay(l.checkIn)} → {formatDay(l.checkOut)} · {l.nights} {plural(l.nights, 'nuit', 'nuits')} · {l.adults} {plural(l.adults, 'adulte', 'adultes')}{l.children > 0 ? `, ${l.children} ${plural(l.children, 'enfant', 'enfants')}` : ''}</span>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <StateBadge tone={LINE_TONE[l.status] ?? 'neutral'}>{LINE_LABEL[l.status] ?? l.status}</StateBadge>
                        <span className="num-col text-[15px] font-semibold text-ink">{formatMoney(l.gross - l.discount, d.currency)}</span>
                      </div>
                    </div>
                    <details className="text-[14px]">
                      <summary className="min-h-8 cursor-pointer text-accent-ink">Prix nuit par nuit</summary>
                      <table className="mt-2 w-full">
                        <caption className="sr-only">Prix de chaque nuit de la chambre {l.roomNumber}</caption>
                        <tbody>
                          {l.nightly.map((n) => (
                            <tr key={n.night} className="border-t border-hairline">
                              <th scope="row" className="py-1.5 text-left font-normal text-ink-2">{formatDay(n.night)}</th>
                              <td className="num-col py-1.5 text-right">{formatMoney(n.rate, d.currency)}{n.discount > 0 && <span className="ml-2 text-ink-2">− {formatMoney(n.discount, d.currency)}</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                    {update && open && (
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setDialog({ line: l, kind: 'edit' })} aria-label={`Modifier la chambre ${l.roomNumber}`}>Modifier</Button>
                        {cancel && d.actions.cancelRoom && l.status !== 'checked_in' && <Button size="sm" variant="ghost" onClick={() => setDialog({ line: l, kind: 'cancel' })} aria-label={`Annuler la chambre ${l.roomNumber}`}>Annuler cette chambre</Button>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel title="Historique" description="Chaque action sur cette réservation est tracée.">
            {d.history.length === 0 ? <p className="text-[14px] text-ink-2">Aucun événement.</p> : (
              <ol className="flex flex-col">
                {d.history.map((h) => (
                  <li key={h.id} className="flex flex-col gap-0.5 border-t border-hairline py-3 first:border-0 first:pt-0">
                    <span className="text-[14px] font-medium text-ink">{auditLabel(h.action)}</span>
                    <span className="text-[13px] text-ink-2">{h.summary}</span>
                    <span className="text-[12.5px] text-ink-3">{formatDate(h.at, { time: true })}{h.actorName ? ` · ${h.actorName}` : ' · automatique'}</span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Montants">
            <dl className="flex flex-col gap-2 text-[14px]">
              <Row label="Prix des nuits" value={formatMoney(d.subtotal, d.currency)} />
              {d.discount > 0 && <Row label="Remise" value={`− ${formatMoney(d.discount, d.currency)}`} />}
              {d.taxes.map((t) => <Row key={t.ruleId} label={`${t.name}${t.inclusive ? ' (incluse)' : ''}`} value={formatMoney(t.amount, d.currency)} muted />)}
              <Row label="Total" value={formatMoney(d.total, d.currency)} strong divider />
              {d.depositRequired > 0 && <Row label="Acompte demandé" value={formatMoney(d.depositRequired, d.currency)} />}
              <Row label="Déjà payé" value={formatMoney(d.amountPaid, d.currency)} />
              <Row label="Reste à payer" value={formatMoney(d.balanceDue, d.currency)} strong />
            </dl>
            {d.depositRequired > 0 && (d.depositSatisfied ? <StateBadge tone="success">Acompte reçu</StateBadge> : <StateBadge tone="warning">Acompte attendu</StateBadge>)}
            <p className="text-[13px] text-ink-2">Les prix de chaque nuit sont figés à la réservation : un changement de tarif n'a pas d'effet sur cette réservation.</p>
          </Panel>

          <Panel title="Client et séjour">
            <DefinitionList
              items={[
                { label: 'Client', value: <Link to={`/guests/${d.guest.id}`} className="text-accent-ink underline-offset-4 hover:underline">{guestName}{d.guest.isVip ? ' · VIP' : ''}</Link> },
                ...(d.guest.phone ? [{ label: 'Téléphone', value: d.guest.phone }] : []),
                ...(d.guest.email ? [{ label: 'E-mail', value: d.guest.email }] : []),
                { label: 'Origine', value: SOURCE_LABEL[d.source] ?? d.source },
                ...(d.groupName ? [{ label: 'Groupe', value: <Badge>{d.groupName}</Badge> }] : []),
                { label: 'Créée le', value: formatDate(d.createdAt, { time: true }) },
              ]}
            />
            {d.specialRequests && <div><h3 className="text-[13px] font-medium text-ink-2">Demandes particulières</h3><p className="text-[14px] whitespace-pre-line text-ink">{d.specialRequests}</p></div>}
            {d.internalNotes && <div><h3 className="text-[13px] font-medium text-ink-2">Notes internes</h3><p className="text-[14px] whitespace-pre-line text-ink">{d.internalNotes}</p></div>}
          </Panel>
        </div>
      </div>

      {dialog === 'edit' && <EditReservationModal d={d} onClose={close} />}
      {dialog === 'add' && <AddRoomModal d={d} onClose={close} />}
      {dialog === 'cancel' && <CancelReservationModal d={d} onClose={close} />}
      {typeof dialog === 'object' && dialog && dialog.kind === 'edit' && <EditLineModal d={d} line={dialog.line} onClose={close} />}
      <ConfirmDialog
        open={dialog === 'confirm'}
        onOpenChange={(o) => !o && close()}
        title="Confirmer cette réservation ?"
        description={d.status === 'tentative' ? "L'option devient une réservation ferme : elle n'expire plus." : 'La réservation passe de « en attente » à « confirmée ».'}
        confirmLabel="Confirmer"
        destructive={false}
        loading={confirm.isPending}
        onConfirm={() => confirm.mutate({ id: d.id, version: d.version }, { onSuccess: () => { close(); toast.success('Réservation confirmée.'); }, onError: fail })}
      />
      <ConfirmDialog
        open={dialog === 'noshow'}
        onOpenChange={(o) => !o && close()}
        title="Marquer le client « non présenté » ?"
        description="Les chambres sont libérées et la réservation est clôturée. Les montants déjà encaissés restent sur la note du client."
        confirmLabel="Non présenté"
        loading={noShow.isPending}
        onConfirm={() => noShow.mutate({ id: d.id, version: d.version }, { onSuccess: () => { close(); toast.success('Réservation clôturée : client non présenté.'); }, onError: fail })}
      />
      <ConfirmDialog
        open={typeof dialog === 'object' && !!dialog && dialog.kind === 'cancel'}
        onOpenChange={(o) => !o && close()}
        title="Annuler cette chambre ?"
        description={typeof dialog === 'object' && dialog ? `La chambre ${dialog.line.roomNumber} est libérée et le total de la réservation est recalculé.` : ''}
        confirmLabel="Annuler la chambre"
        loading={cancelRoom.isPending}
        onConfirm={() => typeof dialog === 'object' && dialog && cancelRoom.mutate({ id: d.id, lineId: dialog.line.id, version: d.version }, { onSuccess: () => { close(); toast.success('Chambre annulée.'); }, onError: fail })}
      />
    </>
  );
}

function Row({ label, value, strong, muted, divider }: { label: string; value: string; strong?: boolean; muted?: boolean; divider?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3${divider ? ' mt-1 border-t border-hairline pt-3' : ''}`}>
      <dt className={muted ? 'text-ink-3' : 'text-ink-2'}>{label}</dt>
      <dd className={`num-col ${strong ? 'text-[16px] font-semibold text-ink' : muted ? 'text-ink-3' : 'text-ink'}`}>{value}</dd>
    </div>
  );
}
