import { Search } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { useState } from 'react';
import { useDirectory, usePlatformPlans, type DirectoryHotel } from '../../api/platform';
import { formatDate } from '../../lib/format';
import { SUBSCRIPTION_STATUS } from '../../lib/labels';
import { useDocumentTitle } from '../../lib/use-title';
import { DataTable, EmptyState, StateBadge } from '../../ui/data';
import { Field, Input, Select } from '../../ui/form';
import { PageHeader, Panel } from '../../ui/page';
import { HotelLink, Pager, useDebounced } from './parts';

export const HOTEL_STATUS_BADGE: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }> = {
  onboarding: { label: 'En configuration', tone: 'info' },
  active: { label: 'Actif', tone: 'success' },
  suspended: { label: 'Suspendu', tone: 'danger' },
  closed: { label: 'Fermé', tone: 'neutral' },
};

const STATUSES = [
  { value: 'all', label: 'Tous les états' },
  { value: 'onboarding', label: 'En configuration' },
  { value: 'active', label: 'Actifs' },
  { value: 'suspended', label: 'Suspendus' },
  { value: 'closed', label: 'Fermés' },
];

export function planCell(h: DirectoryHotel) {
  if (h.entitlementSource === 'license') return <span className="flex flex-col"><span className="font-medium">{h.planCode}</span><span className="text-[13px] text-ink-2">Licence définitive</span></span>;
  if (h.entitlementSource === 'none' || !h.planCode) return <span className="text-ink-2">Aucune formule</span>;
  const st = SUBSCRIPTION_STATUS[h.subscriptionStatus ?? ''] ?? { label: h.subscriptionStatus ?? '', tone: 'neutral' as const };
  return (
    <span className="flex flex-col items-start gap-1">
      <span className="font-medium">{h.planCode}</span>
      <StateBadge tone={st.tone}>{st.label}</StateBadge>
    </span>
  );
}

export default function HotelsPage() {
  useDocumentTitle('Établissements — Console');
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const q = useDebounced(text.trim());
  const status = params.get('status') ?? 'all';
  const plan = params.get('plan') ?? 'all';
  const page = Number(params.get('page') ?? 1) || 1;
  const plans = usePlatformPlans();
  const list = useDirectory({ q: q || undefined, status: status === 'all' ? undefined : status, plan: plan === 'all' ? undefined : plan, page, pageSize: 25 });
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v === null || v === 'all' || v === '' ? next.delete(k) : next.set(k, v));
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader title="Établissements" description="Tous les établissements inscrits : leur formule, leur état, leur taille. Aucune donnée client ou de réservation n'est visible ici." />
      <Panel>
        <div className="grid gap-4 md:grid-cols-[1fr_14rem_14rem]">
          <Field label="Rechercher" hint="Nom, identifiant ou e-mail du propriétaire">
            {(c) => <Input {...c} type="search" leading={<Search className="size-4" />} value={text} onChange={(e) => { setText(e.target.value); set({ q: e.target.value.trim() || null }); }} />}
          </Field>
          <Field label="État">{(c) => <Select {...c} value={status} onValueChange={(v) => set({ status: v })} options={STATUSES} />}</Field>
          <Field label="Formule">
            {(c) => <Select {...c} value={plan} onValueChange={(v) => set({ plan: v })} options={[{ value: 'all', label: 'Toutes' }, ...(plans.data ?? []).map((p) => ({ value: p.code, label: p.name }))]} />}
          </Field>
        </div>
        {list.isError ? (
          <p className="text-[14px] text-ink-2">Impossible de charger les établissements.</p>
        ) : (
          <>
            <DataTable<DirectoryHotel>
              caption="Établissements inscrits"
              loading={list.isPending}
              rows={list.data?.items ?? []}
              rowKey={(r) => r.id}
              columns={[
                { key: 'name', header: 'Établissement', cell: (r) => <span className="flex flex-col"><HotelLink id={r.id} name={r.name} /><span className="text-[13px] text-ink-2">{r.city ?? '—'}</span></span>, sortValue: (r) => r.name },
                { key: 'owner', header: 'Propriétaire', cell: (r) => <span className="flex flex-col"><span>{r.ownerName ?? '—'}</span><span className="text-[13px] text-ink-2">{r.ownerEmail}</span></span> },
                { key: 'status', header: 'État', cell: (r) => <StateBadge tone={HOTEL_STATUS_BADGE[r.status]?.tone ?? 'neutral'}>{HOTEL_STATUS_BADGE[r.status]?.label ?? r.status}</StateBadge> },
                { key: 'plan', header: 'Formule', cell: planCell },
                { key: 'valid', header: 'Valide jusqu\'au', cell: (r) => (r.entitlementSource === 'license' ? 'Sans échéance' : formatDate(r.validUntil)) },
                { key: 'size', header: 'Chambres / utilisateurs', align: 'right', cell: (r) => `${r.roomsCount} / ${r.usersCount}` },
                { key: 'created', header: 'Inscrit le', cell: (r) => formatDate(r.createdAt), sortValue: (r) => r.createdAt },
              ]}
              mobileCard={(r) => (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3"><HotelLink id={r.id} name={r.name} /><StateBadge tone={HOTEL_STATUS_BADGE[r.status]?.tone ?? 'neutral'}>{HOTEL_STATUS_BADGE[r.status]?.label ?? r.status}</StateBadge></div>
                  <span className="text-[13px] text-ink-2">{r.ownerEmail} · {r.city ?? '—'}</span>
                  <span className="text-[13px] text-ink-2">{r.planCode ?? 'Aucune formule'} · inscrit le {formatDate(r.createdAt)}</span>
                </div>
              )}
              empty={<EmptyState kind="search" title="Aucun établissement" description={q || status !== 'all' || plan !== 'all' ? 'Aucun résultat pour ces filtres.' : 'Les établissements inscrits apparaîtront ici.'} />}
            />
            <Pager page={page} pageSize={25} total={list.data?.total ?? 0} onPage={(p) => set({ page: String(p) })} />
          </>
        )}
      </Panel>
    </>
  );
}
