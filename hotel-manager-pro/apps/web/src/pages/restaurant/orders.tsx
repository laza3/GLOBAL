import { formatMoney } from '@hmp/shared';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { isApiError } from '../../api/client';
import { ORDER_STATUS, useCancelItem, useOrder, useOrders, useRestaurantSummary, useServeOrder, type OrderRow } from '../../api/restaurant';
import { useCan } from '../../auth/session';
import { formatDate } from '../../lib/format';
import { useDocumentTitle } from '../../lib/use-title';
import { Button } from '../../ui/button';
import { Badge, DataTable, EmptyState, StateBadge } from '../../ui/data';
import { Field, Select } from '../../ui/form';
import { Drawer } from '../../ui/overlay';
import { DefinitionList, Panel } from '../../ui/page';
import { Pager } from '../../ui/pager';
import { AddItemsModal, CancelOrderModal, NewOrderModal, PayOrderModal, PostToRoomModal } from './order-modals';

type Dialog = null | 'new' | 'add' | 'pay' | 'room' | 'cancel';

export default function OrdersPage() {
  useDocumentTitle('Restaurant');
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'active';
  const page = Number(params.get('page') ?? 1) || 1;
  const openId = params.get('open');
  const list = useOrders({ status, page, pageSize: 25 });
  const summary = useRestaurantSummary();
  const detail = useOrder(openId);
  const serve = useServeOrder();
  const cancelItem = useCancelItem();
  const [dialog, setDialog] = useState<Dialog>(null);
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v === null || v === '' ? next.delete(k) : next.set(k, v));
    if (!('page' in patch) && !('open' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };
  const order = can('restaurant:order');
  const d = detail.data;
  const editable = d && ['open', 'served'].includes(d.status);
  const s = summary.data;

  return (
    <>
      <Panel
        title="Commandes"
        actions={order ? <Button variant="primary" onClick={() => setDialog('new')}><Plus aria-hidden className="size-4" />Nouvelle commande</Button> : undefined}
      >
        {s && (
          <dl className="grid gap-4 sm:grid-cols-3" aria-label="Chiffres du jour">
            <div className="flex flex-col gap-1 rounded-[14px] bg-silver-soft p-4"><dt className="text-[13px] text-ink-2">Ventes du jour</dt><dd className="num-display text-[22px] font-semibold text-ink">{formatMoney(s.sales.total, s.currency)}</dd><span className="text-[12.5px] text-ink-3">{s.sales.count} commande{s.sales.count > 1 ? 's' : ''} · dont {formatMoney(s.sales.postedToRooms, s.currency)} sur les chambres</span></div>
            <div className="flex flex-col gap-1 rounded-[14px] bg-silver-soft p-4"><dt className="text-[13px] text-ink-2">En cours</dt><dd className="num-display text-[22px] font-semibold text-ink">{s.active.count}</dd><span className="text-[12.5px] text-ink-3">{formatMoney(s.active.total, s.currency)} à encaisser</span></div>
            <div className="flex flex-col gap-1 rounded-[14px] bg-silver-soft p-4"><dt className="text-[13px] text-ink-2">Annulées aujourd'hui</dt><dd className="num-display text-[22px] font-semibold text-ink">{s.cancelled}</dd></div>
          </dl>
        )}
        <div className="max-w-xs"><Field label="Afficher">{(c) => <Select {...c} value={status} onValueChange={(v) => set({ status: v === 'active' ? null : v })} options={[{ value: 'active', label: 'En cours' }, { value: 'paid', label: 'Encaissées' }, { value: 'posted_to_room', label: 'Imputées à une chambre' }, { value: 'cancelled', label: 'Annulées' }]} />}</Field></div>
        {list.isError ? <p className="text-[14px] text-ink-2">Impossible de charger les commandes.</p> : (
          <>
            <DataTable<OrderRow>
              caption="Commandes"
              loading={list.isPending}
              rows={list.data?.items ?? []}
              rowKey={(r) => r.id}
              columns={[
                { key: 'n', header: 'Commande', cell: (r) => <button type="button" onClick={() => set({ open: r.id })} className="cursor-pointer font-medium text-accent-ink underline-offset-4 hover:underline" aria-label={`Ouvrir la commande ${r.number}`}>{r.number}</button> },
                { key: 't', header: 'Table', cell: (r) => r.tableLabel ?? <span className="text-ink-3">Comptoir</span> },
                { key: 'i', header: 'Plats', align: 'right', cell: (r) => r.itemsCount },
                { key: 'm', header: 'Total', align: 'right', cell: (r) => <span className="num-col">{formatMoney(r.total, r.currency)}</span> },
                { key: 's', header: 'État', cell: (r) => <StateBadge tone={ORDER_STATUS[r.status].tone}>{ORDER_STATUS[r.status].label}</StateBadge> },
                { key: 'd', header: 'Ouverte', cell: (r) => formatDate(r.openedAt, { time: true }) },
              ]}
              mobileCard={(r) => (
                <button type="button" onClick={() => set({ open: r.id })} className="flex w-full cursor-pointer flex-col gap-1 text-left" aria-label={`Ouvrir la commande ${r.number}`}>
                  <span className="flex items-center justify-between gap-3"><span className="font-medium text-ink">{r.number}</span><StateBadge tone={ORDER_STATUS[r.status].tone}>{ORDER_STATUS[r.status].label}</StateBadge></span>
                  <span className="text-[13px] text-ink-2">{r.tableLabel ?? 'Comptoir'} · {r.itemsCount} plat{r.itemsCount > 1 ? 's' : ''}</span>
                  <span className="num-col text-[14px] font-medium text-ink">{formatMoney(r.total, r.currency)}</span>
                </button>
              )}
              empty={<EmptyState kind="calendar" title={status === 'active' ? 'Aucune commande en cours' : 'Aucune commande'} description={status === 'active' ? 'Ouvrez une commande pour une table ou au comptoir.' : 'Rien à afficher pour ce filtre.'} action={order && status === 'active' ? <Button variant="primary" onClick={() => setDialog('new')}>Nouvelle commande</Button> : undefined} />}
            />
            <Pager page={page} pageSize={25} total={list.data?.total ?? 0} onPage={(p) => set({ page: String(p) })} />
          </>
        )}
      </Panel>

      <Drawer open={!!openId} onOpenChange={(o) => !o && set({ open: null })} title={d ? `Commande ${d.number}` : 'Commande'} description={d ? `${d.tableLabel ? `Table ${d.tableLabel}` : 'Comptoir'} · ${d.covers} couvert${d.covers > 1 ? 's' : ''}` : undefined}>
        {d && (
          <div className="flex flex-col gap-4">
            <span className="flex flex-wrap items-center gap-2"><StateBadge tone={ORDER_STATUS[d.status].tone}>{ORDER_STATUS[d.status].label}</StateBadge>{d.guestName && <Badge>{d.guestName} · {d.reservationReference}</Badge>}</span>
            <ul className="flex flex-col" aria-label="Plats de la commande">
              {d.items.map((i) => (
                <li key={i.id} className={`flex items-start justify-between gap-3 border-t border-hairline py-2.5 first:border-0 ${i.status === 'cancelled' ? 'text-ink-3 line-through' : ''}`}>
                  <span className="flex flex-col"><span className="text-[14px]">{i.quantity} × {i.name}</span>{i.notes && <span className="text-[12.5px] text-ink-2 no-underline">{i.notes}</span>}</span>
                  <span className="flex items-center gap-2"><span className="num-col text-[14px]">{formatMoney(i.quantity * i.unitPrice, d.currency)}</span>{order && editable && i.status !== 'cancelled' && <Button size="sm" variant="ghost" onClick={() => cancelItem.mutate({ id: d.id, itemId: i.id }, { onError: (e) => toast.error(isApiError(e) ? e.message : "L'action a échoué.") })} aria-label={`Annuler ${i.name}`}>Retirer</Button>}</span>
                </li>
              ))}
            </ul>
            <DefinitionList items={[{ label: 'Sous-total', value: formatMoney(d.subtotal, d.currency) }, { label: 'Taxes', value: formatMoney(d.tax, d.currency) }, { label: 'Total', value: <strong className="num-col">{formatMoney(d.total, d.currency)}</strong> }]} />
            {order && editable && (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setDialog('add')}>Ajouter des plats</Button>
                {d.status === 'open' && <Button variant="secondary" loading={serve.isPending} onClick={() => serve.mutate(d.id, { onSuccess: () => toast.success('Commande servie.'), onError: (e) => toast.error(isApiError(e) ? e.message : "L'action a échoué.") })}>Marquer servie</Button>}
                <Button variant="primary" onClick={() => setDialog('pay')}>Encaisser</Button>
                <Button variant="secondary" onClick={() => setDialog('room')}>Imputer à une chambre</Button>
                <Button variant="ghost" onClick={() => setDialog('cancel')}>Annuler</Button>
              </div>
            )}
          </div>
        )}
      </Drawer>

      {dialog === 'new' && <NewOrderModal onClose={() => setDialog(null)} onOpened={(id) => set({ open: id })} />}
      {dialog === 'add' && d && <AddItemsModal order={d} onClose={() => setDialog(null)} />}
      {dialog === 'pay' && d && <PayOrderModal order={d} onClose={() => setDialog(null)} />}
      {dialog === 'room' && d && <PostToRoomModal order={d} onClose={() => setDialog(null)} />}
      {dialog === 'cancel' && d && <CancelOrderModal order={d} onClose={() => setDialog(null)} />}
    </>
  );
}
