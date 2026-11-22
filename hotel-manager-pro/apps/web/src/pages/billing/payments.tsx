import { formatMoney } from '@hmp/shared';
import { Link, useSearchParams } from 'react-router';
import { usePaymentMethods, usePayments, type JournalRow } from '../../api/billing';
import { PAYMENT_KIND } from '../../lib/billing-labels';
import { formatDate } from '../../lib/format';
import { useDocumentTitle } from '../../lib/use-title';
import { Badge, DataTable, EmptyState } from '../../ui/data';
import { Field, Input, Select } from '../../ui/form';
import { Panel } from '../../ui/page';
import { Pager } from '../../ui/pager';

export default function PaymentsPage() {
  useDocumentTitle('Encaissements');
  const [params, setParams] = useSearchParams();
  const methods = usePaymentMethods();
  const method = params.get('method') ?? 'all';
  const kind = params.get('kind') ?? 'all';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const page = Number(params.get('page') ?? 1) || 1;
  const list = usePayments({ method: method === 'all' ? undefined : method, kind: kind === 'all' ? undefined : kind, from: from || undefined, to: to || undefined, page, pageSize: 25 });
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v === null || v === '' ? next.delete(k) : next.set(k, v));
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };
  return (
    <Panel title="Journal des encaissements" description="Tout ce qui a été encaissé ou remboursé. Un encaissement ne se supprime jamais : une erreur se corrige par un remboursement.">
      <div className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Du">{(c) => <Input {...c} type="date" value={from} onChange={(e) => set({ from: e.target.value || null })} />}</Field>
        <Field label="Au">{(c) => <Input {...c} type="date" value={to} onChange={(e) => set({ to: e.target.value || null })} />}</Field>
        <Field label="Moyen">{(c) => <Select {...c} value={method} onValueChange={(v) => set({ method: v === 'all' ? null : v })} options={[{ value: 'all', label: 'Tous les moyens' }, ...(methods.data ?? []).map((m) => ({ value: m.code, label: m.label }))]} />}</Field>
        <Field label="Nature">{(c) => <Select {...c} value={kind} onValueChange={(v) => set({ kind: v === 'all' ? null : v })} options={[{ value: 'all', label: 'Toutes' }, { value: 'payment', label: 'Paiements' }, { value: 'deposit', label: 'Acomptes' }, { value: 'refund', label: 'Remboursements' }]} />}</Field>
      </div>
      {list.data && <p className="text-[14px] text-ink-2">Net encaissé sur la sélection : <strong className="num-col text-ink">{formatMoney(list.data.netCollected, list.data.currency)}</strong> (remboursements déduits)</p>}
      {list.isError ? <p className="text-[14px] text-ink-2">Impossible de charger le journal.</p> : (
        <>
          <DataTable<JournalRow>
            caption="Encaissements"
            loading={list.isPending}
            rows={list.data?.items ?? []}
            rowKey={(r) => r.id}
            columns={[
              { key: 'd', header: 'Date', cell: (r) => formatDate(r.receivedAt, { time: true }) },
              { key: 'k', header: 'Nature', cell: (r) => <Badge tone={r.kind === 'refund' ? 'champagne' : 'neutral'}>{PAYMENT_KIND[r.kind]}</Badge> },
              { key: 'g', header: 'Client', cell: (r) => <span className="flex flex-col"><span>{r.guestName ?? '—'}</span>{r.reservationReference && r.folioId && <Link to={`/billing/folios/${r.folioId}`} className="text-[13px] text-accent-ink hover:underline">{r.reservationReference}</Link>}</span> },
              { key: 'm', header: 'Moyen', cell: (r) => <span className="flex flex-col"><span>{r.methodLabel ?? r.methodCode}</span>{r.reference && <span className="text-[13px] text-ink-2">{r.reference}</span>}</span> },
              { key: 'a', header: 'Montant', align: 'right', cell: (r) => <span className="flex flex-col items-end"><span className="num-col">{r.kind === 'refund' ? '− ' : ''}{formatMoney(r.amount, r.currency)}</span>{r.folioCurrency && r.currency !== r.folioCurrency && <span className="text-[12.5px] text-ink-2">= {formatMoney(r.baseAmount, r.folioCurrency)}</span>}</span> },
            ]}
            mobileCard={(r) => (
              <div className="flex flex-col gap-1">
                <span className="flex items-center justify-between gap-3"><span className="font-medium text-ink">{r.guestName ?? '—'}</span><Badge tone={r.kind === 'refund' ? 'champagne' : 'neutral'}>{PAYMENT_KIND[r.kind]}</Badge></span>
                <span className="num-col text-[14px] text-ink">{r.kind === 'refund' ? '− ' : ''}{formatMoney(r.amount, r.currency)} · {r.methodLabel ?? r.methodCode}</span>
                <span className="text-[13px] text-ink-2">{formatDate(r.receivedAt, { time: true })}</span>
              </div>
            )}
            empty={<EmptyState kind="search" title="Aucun encaissement" description="Aucun encaissement ne correspond à cette sélection." />}
          />
          <Pager page={page} pageSize={25} total={list.data?.total ?? 0} onPage={(p) => set({ page: String(p) })} />
        </>
      )}
    </Panel>
  );
}
