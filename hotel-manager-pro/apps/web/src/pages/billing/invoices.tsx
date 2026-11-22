import { formatMoney } from '@hmp/shared';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { invoicePdfUrl, useInvoices, type InvoiceRow } from '../../api/billing';
import { formatDate } from '../../lib/format';
import { useDebounced } from '../../lib/use-debounced';
import { useDocumentTitle } from '../../lib/use-title';
import { Badge, DataTable, EmptyState, StateBadge } from '../../ui/data';
import { Field, Input, Select } from '../../ui/form';
import { Panel } from '../../ui/page';
import { Pager } from '../../ui/pager';

export default function InvoicesPage() {
  useDocumentTitle('Factures et avoirs');
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const q = useDebounced(text.trim());
  const kind = params.get('kind') ?? 'all';
  const page = Number(params.get('page') ?? 1) || 1;
  const list = useInvoices({ q: q || undefined, kind: kind === 'all' ? undefined : kind, page, pageSize: 25 });
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v === null || v === '' ? next.delete(k) : next.set(k, v));
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };
  return (
    <Panel>
      <div className="grid items-end gap-4 md:grid-cols-[1fr_14rem]">
        <Field label="Rechercher" hint="Numéro, client ou référence de réservation">{(c) => <Input {...c} type="search" leading={<Search className="size-4" />} value={text} onChange={(e) => { setText(e.target.value); set({ q: e.target.value.trim() || null }); }} autoComplete="off" />}</Field>
        <Field label="Type">{(c) => <Select {...c} value={kind} onValueChange={(v) => set({ kind: v === 'all' ? null : v })} options={[{ value: 'all', label: 'Factures et avoirs' }, { value: 'invoice', label: 'Factures' }, { value: 'credit_note', label: 'Avoirs' }]} />}</Field>
      </div>
      {list.isError ? <p className="text-[14px] text-ink-2">Impossible de charger les factures.</p> : (
        <>
          <DataTable<InvoiceRow>
            caption="Factures et avoirs"
            loading={list.isPending}
            rows={list.data?.items ?? []}
            rowKey={(r) => r.id}
            columns={[
              { key: 'n', header: 'Numéro', cell: (r) => <a href={invoicePdfUrl(r.id)} target="_blank" rel="noreferrer" className="font-medium text-accent-ink underline-offset-4 hover:underline" aria-label={`Ouvrir le PDF ${r.number}`}>{r.number}</a> },
              { key: 't', header: 'Type', cell: (r) => (r.kind === 'credit_note' ? <Badge tone="champagne">Avoir</Badge> : <Badge>Facture</Badge>) },
              { key: 'g', header: 'Client', cell: (r) => <span className="flex flex-col"><span>{r.guestName ?? '—'}</span>{r.reservationReference && <span className="text-[13px] text-ink-2">{r.folioId ? <Link to={`/billing/folios/${r.folioId}`} className="hover:underline">{r.reservationReference}</Link> : r.reservationReference}</span>}</span> },
              { key: 'd', header: 'Émise le', cell: (r) => formatDate(r.issuedAt) },
              { key: 'm', header: 'Total', align: 'right', cell: (r) => <span className="num-col">{formatMoney(r.total, r.currency)}</span> },
              { key: 'c', header: 'Crédité', align: 'right', cell: (r) => (r.kind === 'invoice' && r.credited > 0 ? <span className="num-col">{formatMoney(r.credited, r.currency)}</span> : '—') },
              { key: 's', header: 'État', cell: (r) => (r.status === 'void' ? <StateBadge tone="danger">Annulée</StateBadge> : <StateBadge tone="success">Émise</StateBadge>) },
            ]}
            mobileCard={(r) => (
              <a href={invoicePdfUrl(r.id)} target="_blank" rel="noreferrer" className="flex flex-col gap-1">
                <span className="flex items-center justify-between gap-3"><span className="font-medium text-ink">{r.number}</span>{r.status === 'void' ? <StateBadge tone="danger">Annulée</StateBadge> : r.kind === 'credit_note' ? <Badge tone="champagne">Avoir</Badge> : <StateBadge tone="success">Émise</StateBadge>}</span>
                <span className="text-[14px] text-ink">{r.guestName}</span>
                <span className="num-col text-[13px] text-ink-2">{formatDate(r.issuedAt)} · {formatMoney(r.total, r.currency)}</span>
              </a>
            )}
            empty={<EmptyState kind="key" title="Aucune facture pour le moment" description="Les factures s'émettent depuis la note d'un client, avec les charges non encore facturées." />}
          />
          <Pager page={page} pageSize={25} total={list.data?.total ?? 0} onPage={(p) => set({ page: String(p) })} />
        </>
      )}
    </Panel>
  );
}
