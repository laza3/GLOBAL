import { formatMoney } from '@hmp/shared';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { isApiError } from '../../api/client';
import { MAINT_STATUS, PRIORITY_LABEL, useMaintenance, usePatchMaintenance, type MaintenanceItem } from '../../api/housekeeping';
import { useCan } from '../../auth/session';
import { formatDate, formatDay } from '../../lib/format';
import { useCurrency } from '../../lib/use-currency';
import { useDocumentTitle } from '../../lib/use-title';
import { Button } from '../../ui/button';
import { Badge, DataTable, EmptyState, StateBadge } from '../../ui/data';
import { Field, Select } from '../../ui/form';
import { Panel } from '../../ui/page';
import { Pager } from '../../ui/pager';
import { MaintenanceModal, ResolveModal } from './modals';

export default function MaintenancePage() {
  useDocumentTitle('Maintenance');
  const can = useCan();
  const currency = useCurrency();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'active';
  const page = Number(params.get('page') ?? 1) || 1;
  const list = useMaintenance({ status, page, pageSize: 25 });
  const patch = usePatchMaintenance();
  const [creating, setCreating] = useState(false);
  const [resolving, setResolving] = useState<MaintenanceItem | null>(null);
  const set = (p: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(p)) (v === null || v === '' ? next.delete(k) : next.set(k, v));
    if (!('page' in p)) next.delete('page');
    setParams(next, { replace: true });
  };
  const today = new Date().toISOString().slice(0, 10);
  const act = (i: MaintenanceItem, body: Record<string, unknown>, done: string) => patch.mutate({ id: i.id, body }, { onSuccess: () => toast.success(done), onError: (e) => toast.error(isApiError(e) ? e.message : "L'action a échoué.") });
  return (
    <Panel title="Pannes et travaux" description="Une demande peut bloquer sa chambre à la vente : la résoudre la libère." actions={can('housekeeping:update_task') ? <Button variant="primary" onClick={() => setCreating(true)}><Plus aria-hidden className="size-4" />Signaler</Button> : undefined}>
      <div className="max-w-xs"><Field label="Afficher">{(c) => <Select {...c} value={status} onValueChange={(v) => set({ status: v === 'active' ? null : v })} options={[{ value: 'active', label: 'À traiter' }, { value: 'open', label: 'Ouvertes' }, { value: 'in_progress', label: 'En cours' }, { value: 'resolved', label: 'Résolues' }, { value: 'cancelled', label: 'Annulées' }]} />}</Field></div>
      {list.isError ? <p className="text-[14px] text-ink-2">Impossible de charger les demandes.</p> : (
        <>
          <DataTable<MaintenanceItem>
            caption="Demandes de maintenance"
            loading={list.isPending}
            rows={list.data?.items ?? []}
            rowKey={(r) => r.id}
            columns={[
              { key: 't', header: 'Demande', cell: (r) => <span className="flex flex-col"><span className="font-medium text-ink">{r.title}</span><span className="text-[13px] text-ink-2">{r.roomNumber ? `Chambre ${r.roomNumber}` : 'Parties communes'}{r.description ? ` — ${r.description}` : ''}</span></span> },
              { key: 'p', header: 'Priorité', cell: (r) => (r.priority === 'normal' || r.priority === 'low' ? <Badge>{PRIORITY_LABEL[r.priority]}</Badge> : <StateBadge tone={r.priority === 'urgent' ? 'danger' : 'warning'}>{PRIORITY_LABEL[r.priority]}</StateBadge>) },
              { key: 's', header: 'État', cell: (r) => <span className="flex flex-col items-start gap-1"><StateBadge tone={r.status === 'resolved' ? 'success' : r.status === 'cancelled' ? 'neutral' : r.status === 'in_progress' ? 'info' : 'warning'}>{MAINT_STATUS[r.status]}</StateBadge>{r.allocationId && r.blockStartsOn && <span className="text-[12.5px] text-ink-2">Chambre bloquée{r.blockEndsOn ? ` jusqu'au ${formatDay(r.blockEndsOn)}` : ''}</span>}</span> },
              { key: 'a', header: 'Responsable', cell: (r) => r.assignedName ?? '—' },
              { key: 'd', header: 'Signalée', cell: (r) => <span className="flex flex-col"><span>{formatDate(r.reportedAt)}</span>{r.reportedByName && <span className="text-[12.5px] text-ink-2">{r.reportedByName}</span>}</span> },
              { key: 'c', header: 'Coût', align: 'right', cell: (r) => (r.costAmount != null ? <span className="num-col">{formatMoney(r.costAmount, currency)}</span> : '—') },
              { key: 'x', header: 'Actions', cell: (r) => (can('housekeeping:manage') && ['open', 'in_progress'].includes(r.status) ? (
                <span className="flex flex-wrap gap-1.5">
                  {r.status === 'open' && <Button size="sm" variant="secondary" onClick={() => act(r, { status: 'in_progress' }, 'Demande prise en charge.')} aria-label={`Prendre en charge ${r.title}`}>Prendre en charge</Button>}
                  <Button size="sm" variant="primary" onClick={() => setResolving(r)} aria-label={`Résoudre ${r.title}`}>Résoudre</Button>
                  <Button size="sm" variant="ghost" onClick={() => act(r, { status: 'cancelled' }, 'Demande annulée.')} aria-label={`Annuler ${r.title}`}>Annuler</Button>
                </span>
              ) : null) },
            ]}
            mobileCard={(r) => <div className="flex flex-col gap-1"><span className="flex items-center justify-between gap-3"><span className="font-medium text-ink">{r.title}</span><StateBadge tone={r.status === 'resolved' ? 'success' : 'warning'}>{MAINT_STATUS[r.status]}</StateBadge></span><span className="text-[13px] text-ink-2">{r.roomNumber ? `Chambre ${r.roomNumber}` : 'Parties communes'} · {PRIORITY_LABEL[r.priority].toLowerCase()}</span></div>}
            empty={<EmptyState kind="key" title="Aucune demande" description="Quand une panne est signalée, elle apparaît ici avec sa priorité et, si besoin, la chambre bloquée." />}
          />
          <Pager page={page} pageSize={25} total={list.data?.total ?? 0} onPage={(p) => set({ page: String(p) })} />
        </>
      )}
      {creating && <MaintenanceModal today={today} onClose={() => setCreating(false)} />}
      {resolving && <ResolveModal item={resolving} currency={currency} onClose={() => setResolving(null)} />}
    </Panel>
  );
}
