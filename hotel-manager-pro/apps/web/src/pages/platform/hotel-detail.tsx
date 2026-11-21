import { formatMoney } from '@hmp/shared';
import { ArrowLeft, Ban, CirclePlay, FilePlus2, KeyRound, MoreHorizontal, Repeat, TimerReset } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { useHotelDetail, useReactivateHotel, useSuspendHotel, type HotelDetail } from '../../api/platform';
import { auditLabel } from '../../lib/audit-labels';
import { formatDate } from '../../lib/format';
import { INVOICE_STATUS, INTERVAL_UNIT, PAYMENT_METHOD, PAYMENT_STATUS, SUBSCRIPTION_STATUS, TICKET_STATUS } from '../../lib/labels';
import { useDocumentTitle } from '../../lib/use-title';
import { Button } from '../../ui/button';
import { DataTable, Skeleton, StateBadge } from '../../ui/data';
import { Menu, type MenuItem } from '../../ui/overlay';
import { Callout, DefinitionList, PageHeader, Panel } from '../../ui/page';
import { ActivateModal, CancelSubscriptionModal, CreateInvoiceModal, ExtendTrialModal, GrantTrialModal, IssueLicenseModal } from './hotel-actions';
import { HOTEL_STATUS_BADGE } from './hotels';
import { ReasonModal } from './parts';

type Modal = 'suspend' | 'activate' | 'grant' | 'extend' | 'cancel' | 'license' | 'invoice' | null;
const empty = (text: string) => <p className="px-6 py-8 text-center text-[14px] text-ink-2">{text}</p>;

function Body({ d }: { d: HotelDetail }) {
  const [modal, setModal] = useState<Modal>(null);
  const suspend = useSuspendHotel();
  const reactivate = useReactivateHotel();
  const h = d.hotel;
  const live = d.subscriptions.find((s) => ['trialing', 'active', 'past_due'].includes(s.status));
  const st = HOTEL_STATUS_BADGE[h.status] ?? { label: h.status, tone: 'neutral' as const };

  const items: MenuItem[] = [
    { label: 'Activer une formule', icon: <Repeat />, onSelect: () => setModal('activate') },
    ...(!live ? [{ label: 'Offrir un essai gratuit', icon: <CirclePlay />, onSelect: () => setModal('grant') }] : []),
    ...(live?.status === 'trialing' ? [{ label: "Prolonger l'essai", icon: <TimerReset />, onSelect: () => setModal('extend') }] : []),
    ...(live ? [{ label: "Résilier l'abonnement", icon: <Ban />, onSelect: () => setModal('cancel'), destructive: true }] : []),
    { label: 'Émettre une licence définitive', icon: <KeyRound />, onSelect: () => setModal('license'), separated: true },
    { label: 'Créer une facture', icon: <FilePlus2 />, onSelect: () => setModal('invoice') },
  ];

  return (
    <>
      <Link to="/platform/hotels" className="inline-flex items-center gap-1.5 self-start text-[14px] text-ink-2 hover:text-ink">
        <ArrowLeft aria-hidden className="size-4" />
        Tous les établissements
      </Link>
      <PageHeader
        title={h.name}
        description={`${h.city ?? '—'} · inscrit le ${formatDate(h.createdAt, { long: true })}`}
        actions={
          <>
            <StateBadge tone={st.tone}>{st.label}</StateBadge>
            {h.status === 'suspended' ? (
              <Button variant="primary" loading={reactivate.isPending} onClick={() => reactivate.mutate(h.id, { onSuccess: () => toast.success('Compte réactivé.'), onError: (e) => toast.error(e.message) })}>
                Réactiver le compte
              </Button>
            ) : (
              h.status !== 'closed' && <Button variant="danger" onClick={() => setModal('suspend')}>Suspendre</Button>
            )}
            <Menu
              trigger={
                <Button variant="secondary">
                  <MoreHorizontal aria-hidden className="size-4" />
                  Actions
                </Button>
              }
              items={items}
            />
          </>
        }
      />

      {h.status === 'suspended' && <Callout tone="danger">Compte suspendu le {formatDate(h.suspendedAt, { long: true })}. Motif : {h.suspensionReason ?? '—'}. L&apos;établissement n&apos;a plus accès à ses données ; il peut seulement contacter l&apos;assistance.</Callout>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Établissement">
          <DefinitionList items={[
            { label: 'Propriétaire', value: h.ownerName ?? '—' },
            { label: 'E-mail', value: h.ownerEmail ?? '—' },
            { label: 'Chambres', value: h.roomsCount },
            { label: 'Utilisateurs', value: h.usersCount },
          ]} />
        </Panel>
        <Panel title="Droits d'usage actuels">
          <DefinitionList items={[
            { label: 'Source', value: h.entitlementSource === 'license' ? 'Licence définitive' : h.entitlementSource === 'subscription' ? 'Abonnement' : 'Aucune' },
            { label: 'Formule / édition', value: h.planCode ?? '—' },
            { label: 'Valide jusqu\'au', value: h.entitlementSource === 'license' ? 'Sans échéance' : formatDate(h.validUntil, { long: true }) },
            { label: 'Accès', value: h.isCurrent ? 'En cours de validité' : 'Échu' },
          ]} />
        </Panel>
      </div>

      <Panel title="Abonnements">
        <DataTable
          caption="Abonnements de l'établissement"
          rows={d.subscriptions}
          rowKey={(r) => r.id}
          columns={[
            { key: 'plan', header: 'Formule', cell: (r) => <span className="font-medium">{r.planName}</span> },
            { key: 'status', header: 'État', cell: (r) => { const s = SUBSCRIPTION_STATUS[r.cancelAtPeriodEnd ? 'cancel_at_period_end' : r.status] ?? { label: r.status, tone: 'neutral' as const }; return <StateBadge tone={s.tone}>{s.label}</StateBadge>; } },
            { key: 'start', header: 'Début', cell: (r) => formatDate(r.startedAt) },
            { key: 'end', header: 'Échéance', cell: (r) => formatDate(r.trialEndsAt ?? r.endedAt ?? r.currentPeriodEnd) },
            { key: 'price', header: 'Tarif', align: 'right', cell: (r) => (r.priceAmount ? `${formatMoney(r.priceAmount - r.discountAmount, r.currency)} / ${INTERVAL_UNIT[r.billingInterval]}` : '—') },
          ]}
          empty={empty('Aucun abonnement.')}
        />
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Factures">
          <DataTable
            caption="Factures de l'établissement"
            rows={d.invoices}
            rowKey={(r) => r.id}
            columns={[
              { key: 'n', header: 'Numéro', cell: (r) => <Link className="num-col font-medium text-accent-ink hover:underline" to={`/platform/invoices?open=${r.id}`}>{r.number ?? 'Brouillon'}</Link> },
              { key: 'total', header: 'Total', align: 'right', cell: (r) => formatMoney(r.totalAmount, r.currency) },
              { key: 'due', header: 'Reste', align: 'right', cell: (r) => formatMoney(r.balanceDue, r.currency) },
              { key: 's', header: 'État', cell: (r) => <StateBadge tone={r.isOverdue && r.balanceDue > 0 ? 'danger' : INVOICE_STATUS[r.paymentStatus].tone}>{r.isOverdue && r.balanceDue > 0 ? 'En retard' : INVOICE_STATUS[r.paymentStatus].label}</StateBadge> },
            ]}
            empty={empty('Aucune facture.')}
          />
        </Panel>
        <Panel title="Paiements">
          <DataTable
            caption="Paiements de l'établissement"
            rows={d.payments}
            rowKey={(r) => r.id}
            columns={[
              { key: 'a', header: 'Montant', align: 'right', cell: (r) => formatMoney(r.amount, r.currency) },
              { key: 'm', header: 'Moyen', cell: (r) => <span className="flex flex-col"><span>{PAYMENT_METHOD[r.method] ?? r.method}</span><span className="text-[13px] text-ink-2">{r.reference ?? ''}</span></span> },
              { key: 'd', header: 'Déclaré le', cell: (r) => formatDate(r.submittedAt) },
              { key: 's', header: 'État', cell: (r) => <StateBadge tone={PAYMENT_STATUS[r.status].tone}>{PAYMENT_STATUS[r.status].label}</StateBadge> },
            ]}
            empty={empty('Aucun paiement.')}
          />
        </Panel>
      </div>

      {d.licenses.length > 0 && (
        <Panel title="Licences" description="La clé n'est jamais ré-affichée : seul son préfixe est conservé.">
          <DataTable
            caption="Licences de l'établissement"
            rows={d.licenses}
            rowKey={(r) => r.id}
            columns={[
              { key: 'e', header: 'Édition', cell: (r) => <span className="font-medium">{r.editionCode}</span> },
              { key: 'k', header: 'Clé', cell: (r) => <span className="num-col">{r.keyPrefix}…</span> },
              { key: 's', header: 'État', cell: (r) => <StateBadge tone={r.status === 'active' ? 'success' : r.status === 'pending' ? 'warning' : 'neutral'}>{r.status === 'active' ? 'Active' : r.status === 'pending' ? 'En attente de paiement' : r.status === 'suspended' ? 'Suspendue' : 'Révoquée'}</StateBadge> },
              { key: 'm', header: 'Maintenance', cell: (r) => (r.maintenanceUntil ? formatDate(r.maintenanceUntil) : 'Sans fin') },
            ]}
            empty={empty('Aucune licence.')}
          />
        </Panel>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Assistance">
          <DataTable
            caption="Demandes d'assistance"
            rows={d.tickets}
            rowKey={(r) => r.id}
            columns={[
              { key: 'n', header: 'N°', cell: (r) => <Link className="num-col text-accent-ink hover:underline" to={`/platform/support?open=${r.id}`}>{r.number}</Link> },
              { key: 'sub', header: 'Objet', cell: (r) => r.subject },
              { key: 's', header: 'État', cell: (r) => <StateBadge tone={TICKET_STATUS[r.status].tone}>{TICKET_STATUS[r.status].label}</StateBadge> },
            ]}
            empty={empty('Aucune demande.')}
          />
        </Panel>
        <Panel title="Journal de la plateforme">
          {d.auditLog.length === 0 ? (
            <p className="text-[14px] text-ink-2">Aucune action de la plateforme sur cet établissement.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {d.auditLog.slice(0, 12).map((l, i) => (
                <li key={i} className="flex flex-col text-[14px]">
                  <span className="font-medium text-ink">{auditLabel(l.action)}</span>
                  <span className="text-[13px] text-ink-2">{formatDate(l.createdAt, { time: true })}{typeof l.details?.reason === 'string' ? ` — ${l.details.reason}` : ''}</span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>

      {modal === 'suspend' && (
        <ReasonModal
          title={`Suspendre ${h.name}`}
          description="L'accès est coupé immédiatement. Les données sont conservées ; l'établissement peut seulement contacter l'assistance."
          hint="Visible dans le journal ; communiquez-le aussi à l'établissement."
          confirmLabel="Suspendre le compte"
          destructive
          onSubmit={(reason) => suspend.mutateAsync({ id: h.id, reason }).then(() => void toast.success('Compte suspendu.'))}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'activate' && <ActivateModal hotelId={h.id} onClose={() => setModal(null)} />}
      {modal === 'grant' && <GrantTrialModal hotelId={h.id} onClose={() => setModal(null)} />}
      {modal === 'extend' && live && <ExtendTrialModal subscriptionId={live.id} onClose={() => setModal(null)} />}
      {modal === 'cancel' && live && <CancelSubscriptionModal subscriptionId={live.id} onClose={() => setModal(null)} />}
      {modal === 'license' && <IssueLicenseModal hotelId={h.id} onClose={() => setModal(null)} />}
      {modal === 'invoice' && <CreateInvoiceModal hotelId={h.id} hotelName={h.name} onClose={() => setModal(null)} />}
    </>
  );
}

export default function HotelDetailPage() {
  const { id = '' } = useParams();
  const detail = useHotelDetail(id);
  useDocumentTitle(detail.data ? `${detail.data.hotel.name} — Console` : 'Établissement — Console');
  if (detail.isPending) return <div role="status" className="flex flex-col gap-4"><Skeleton className="h-10 w-1/3" /><Skeleton className="h-40 w-full rounded-[22px]" /><span className="sr-only">Chargement</span></div>;
  if (detail.isError) return <Panel><p className="text-[14px] text-ink-2">Établissement introuvable ou inaccessible.</p><Link to="/platform/hotels" className="text-accent-ink underline">Retour à la liste</Link></Panel>;
  return <Body d={detail.data} />;
}
