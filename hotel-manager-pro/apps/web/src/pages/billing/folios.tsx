import { formatMoney } from '@hmp/shared';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useFolios, type FolioRow } from '../../api/billing';
import { PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE } from '../../lib/billing-labels';
import { useDebounced } from '../../lib/use-debounced';
import { useDocumentTitle } from '../../lib/use-title';
import { DataTable, EmptyState, StateBadge } from '../../ui/data';
import { Field, Input, Select } from '../../ui/form';
import { Panel } from '../../ui/page';
import { Pager } from '../../ui/pager';

export default function FoliosPage() {
  useDocumentTitle('Facturation');
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const q = useDebounced(text.trim());
  const payment = params.get('payment') ?? 'all';
  const page = Number(params.get('page') ?? 1) || 1;
  const list = useFolios({ q: q || undefined, payment: payment === 'all' ? undefined : payment, due: payment === 'due' ? 'true' : undefined, page, pageSize: 25 });
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v === null || v === '' ? next.delete(k) : next.set(k, v));
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };
  const filtered = !!q || payment !== 'all';
  return (
    <Panel>
      <div className="grid items-end gap-4 md:grid-cols-[1fr_16rem]">
        <Field label="Rechercher" hint="Référence de réservation ou nom du client">
          {(c) => <Input {...c} type="search" leading={<Search className="size-4" />} value={text} onChange={(e) => { setText(e.target.value); set({ q: e.target.value.trim() || null }); }} autoComplete="off" />}
        </Field>
        <Field label="Paiement">{(c) => <Select {...c} value={payment} onValueChange={(v) => set({ payment: v === 'all' ? null : v })} options={[{ value: 'all', label: 'Toutes les notes' }, { value: 'due', label: 'Reste à payer' }, { value: 'unpaid', label: 'Impayées' }, { value: 'partially_paid', label: 'Partiellement payées' }, { value: 'paid', label: 'Soldées' }]} />}</Field>
      </div>
      {list.isError ? <p className="text-[14px] text-ink-2">Impossible de charger les notes.</p> : (
        <>
          <DataTable<FolioRow>
            caption="Notes des clients"
            loading={list.isPending}
            rows={list.data?.items ?? []}
            rowKey={(r) => r.id}
            columns={[
              { key: 'r', header: 'Réservation', cell: (r) => <Link to={`/billing/folios/${r.id}`} className="font-medium text-accent-ink underline-offset-4 hover:underline">{r.reference ?? 'Note libre'}</Link> },
              { key: 'g', header: 'Client', cell: (r) => r.guestName ?? '—' },
              { key: 'c', header: 'Charges', align: 'right', cell: (r) => <span className="num-col">{formatMoney(r.chargesTotal, r.currency)}</span> },
              { key: 'p', header: 'Payé', align: 'right', cell: (r) => <span className="num-col">{formatMoney(r.paymentsTotal, r.currency)}</span> },
              { key: 'b', header: 'Reste à payer', align: 'right', cell: (r) => <span className="num-col font-medium">{formatMoney(Math.max(r.balanceDue, 0), r.currency)}</span> },
              { key: 's', header: 'État', cell: (r) => <StateBadge tone={PAYMENT_STATUS_TONE[r.paymentStatus]}>{r.reservationStatus === 'cancelled' && r.chargesTotal === 0 ? 'Annulée' : PAYMENT_STATUS_LABEL[r.paymentStatus]}</StateBadge> },
            ]}
            mobileCard={(r) => (
              <Link to={`/billing/folios/${r.id}`} className="flex flex-col gap-1.5">
                <span className="flex items-center justify-between gap-3"><span className="font-medium text-ink">{r.reference ?? 'Note libre'}</span><StateBadge tone={PAYMENT_STATUS_TONE[r.paymentStatus]}>{PAYMENT_STATUS_LABEL[r.paymentStatus]}</StateBadge></span>
                <span className="text-[14px] text-ink">{r.guestName}</span>
                <span className="num-col text-[13px] text-ink-2">Reste {formatMoney(Math.max(r.balanceDue, 0), r.currency)} sur {formatMoney(r.chargesTotal, r.currency)}</span>
              </Link>
            )}
            empty={<EmptyState kind={filtered ? 'search' : 'key'} title={filtered ? 'Aucune note ne correspond' : 'Aucune note pour le moment'} description={filtered ? 'Retirez un filtre ou essayez un autre nom.' : "Chaque réservation ouvre automatiquement la note de son client : les charges, les encaissements et les factures s'y trouvent."} />}
          />
          <Pager page={page} pageSize={25} total={list.data?.total ?? 0} onPage={(p) => set({ page: String(p) })} />
        </>
      )}
    </Panel>
  );
}
