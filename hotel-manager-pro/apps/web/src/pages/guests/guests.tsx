import { Download, Plus, Search, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useGuests, type GuestRow } from '../../api/guests';
import { useCan } from '../../auth/session';
import { useDebounced } from '../../lib/use-debounced';
import { useDocumentTitle } from '../../lib/use-title';
import { Button } from '../../ui/button';
import { Badge, DataTable, EmptyState, VipBadge } from '../../ui/data';
import { Field, Input, SegmentedControl } from '../../ui/form';
import { PageHeader, Panel } from '../../ui/page';
import { Pager } from '../../ui/pager';
import { GuestModal } from './modals';

export default function GuestsPage() {
  useDocumentTitle('Clients');
  const can = useCan();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const q = useDebounced(text.trim());
  const vip = params.get('vip') === 'true';
  const sort = (params.get('sort') as 'name' | 'recent') ?? 'name';
  const page = Number(params.get('page') ?? 1) || 1;
  const [creating, setCreating] = useState(false);
  const list = useGuests({ q: q || undefined, vip: vip ? 'true' : undefined, sort, page, pageSize: 25 });
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v === null || v === '' ? next.delete(k) : next.set(k, v));
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };
  const filtered = !!q || vip;

  return (
    <>
      <PageHeader
        title="Clients"
        description="Votre fichier clients : coordonnées, préférences, historique des séjours. Une fiche par personne."
        actions={
          <>
            {can('guests:export') && (
              <a href="/api/v1/guests/export.csv" download className="btn inline-flex h-10 items-center gap-2 rounded-control bg-[var(--glass-data)] px-4 text-[14px] font-medium text-ink shadow-[0_0_0_1px_var(--hairline)] hover:shadow-[0_0_0_1px_var(--field-border)]">
                <Download aria-hidden className="size-4" />
                Exporter (CSV)
              </a>
            )}
            {can('guests:manage') && <Button variant="primary" onClick={() => setCreating(true)}><Plus aria-hidden className="size-4" />Nouveau client</Button>}
          </>
        }
      />
      <Panel>
        <div className="grid items-end gap-4 md:grid-cols-[1fr_auto_auto]">
          <Field label="Rechercher" hint="Nom, e-mail ou téléphone (sous n'importe quelle forme)">
            {(c) => <Input {...c} type="search" leading={<Search className="size-4" />} value={text} onChange={(e) => { setText(e.target.value); set({ q: e.target.value.trim() || null }); }} autoComplete="off" />}
          </Field>
          <SegmentedControl label="Clients à afficher" value={vip ? 'vip' : 'all'} onValueChange={(v) => set({ vip: v === 'vip' ? 'true' : null })} options={[{ value: 'all', label: 'Tous' }, { value: 'vip', label: 'VIP' }]} />
          <SegmentedControl label="Tri" value={sort} onValueChange={(v) => set({ sort: v === 'name' ? null : v })} options={[{ value: 'name', label: 'Nom' }, { value: 'recent', label: 'Récents' }]} />
        </div>
        {list.isError ? (
          <p className="text-[14px] text-ink-2">Impossible de charger les clients.</p>
        ) : (
          <>
            <DataTable<GuestRow>
              caption="Clients"
              loading={list.isPending}
              rows={list.data?.items ?? []}
              rowKey={(r) => r.id}
              columns={[
                { key: 'n', header: 'Client', cell: (r) => <span className="flex flex-wrap items-center gap-2"><Link to={`/guests/${r.id}`} className="font-medium text-accent-ink underline-offset-4 hover:underline">{r.firstName} {r.lastName}</Link>{r.isVip && <VipBadge />}</span> },
                { key: 'c', header: 'Contact', cell: (r) => <span className="flex flex-col"><span>{r.email ?? '—'}</span><span className="text-[13px] text-ink-2">{r.phone ?? ''}</span></span> },
                { key: 'v', header: 'Ville', cell: (r) => [r.city, r.country].filter(Boolean).join(', ') || '—' },
                { key: 't', header: 'Étiquettes', cell: (r) => <span className="flex flex-wrap gap-1">{r.tags.map((t) => <Badge key={t}>{t}</Badge>)}</span> },
                { key: 's', header: 'Séjours', align: 'right', cell: (r) => r.staysCount },
              ]}
              mobileCard={(r) => (
                <Link to={`/guests/${r.id}`} className="flex flex-col gap-1">
                  <span className="flex items-center justify-between gap-3"><span className="font-medium text-ink">{r.firstName} {r.lastName}</span>{r.isVip && <VipBadge />}</span>
                  <span className="text-[13px] text-ink-2">{[r.email, r.phone].filter(Boolean).join(' · ') || 'Aucune coordonnée'}</span>
                  <span className="text-[13px] text-ink-2">{r.staysCount} séjour{r.staysCount > 1 ? 's' : ''}{r.city ? ` · ${r.city}` : ''}</span>
                </Link>
              )}
              empty={<EmptyState kind={filtered ? 'search' : 'key'} title={filtered ? 'Aucun client ne correspond' : 'Aucun client pour le moment'} description={filtered ? 'Essayez un autre nom, ou retirez le filtre.' : 'Les clients se créent ici, ou directement au moment d\'une réservation.'} action={!filtered && can('guests:manage') ? <Button variant="primary" onClick={() => setCreating(true)}><Users aria-hidden className="size-4" />Créer le premier client</Button> : undefined} />}
            />
            <Pager page={page} pageSize={25} total={list.data?.total ?? 0} onPage={(p) => set({ page: String(p) })} />
          </>
        )}
      </Panel>
      {creating && <GuestModal guest={null} onClose={() => setCreating(false)} onSaved={(id) => id && navigate(`/guests/${id}`)} />}
    </>
  );
}
