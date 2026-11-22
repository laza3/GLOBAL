import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { isApiError } from '../../api/client';
import { PRIORITY_LABEL, TASK_TYPE, useHkTasks, useTaskStep, type HkTask } from '../../api/housekeeping';
import { useCan } from '../../auth/session';
import { formatDate } from '../../lib/format';
import { useDocumentTitle } from '../../lib/use-title';
import { Button } from '../../ui/button';
import { Badge, DataTable, EmptyState, StateBadge } from '../../ui/data';
import { Field, Select, Switch } from '../../ui/form';
import { Panel } from '../../ui/page';
import { Pager } from '../../ui/pager';
import { TaskModal } from './modals';

const STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'info' | 'neutral' }> = {
  to_clean: { label: 'À faire', tone: 'warning' }, in_progress: { label: 'En cours', tone: 'info' }, cleaned: { label: 'Terminée', tone: 'success' }, inspected: { label: 'Contrôlée', tone: 'neutral' }, maintenance: { label: 'Maintenance', tone: 'warning' },
};

export default function HkTasksPage() {
  useDocumentTitle('Tâches de ménage');
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'open';
  const mine = params.get('mine') === 'true';
  const page = Number(params.get('page') ?? 1) || 1;
  const list = useHkTasks({ status, mine: mine ? 'true' : undefined, page, pageSize: 25 });
  const step = useTaskStep();
  const [creating, setCreating] = useState(false);
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v === null || v === '' ? next.delete(k) : next.set(k, v));
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };
  const run = (t: HkTask, s: 'start' | 'complete' | 'inspect', done: string) => step.mutate({ id: t.id, step: s }, { onSuccess: () => toast.success(done), onError: (e) => toast.error(isApiError(e) ? e.message : "L'action a échoué.") });
  return (
    <Panel title="Tâches de ménage" actions={can('housekeeping:manage') ? <Button variant="primary" onClick={() => setCreating(true)}><Plus aria-hidden className="size-4" />Nouvelle tâche</Button> : undefined}>
      <div className="grid items-end gap-4 sm:grid-cols-[14rem_auto]">
        <Field label="État">{(c) => <Select {...c} value={status} onValueChange={(v) => set({ status: v === 'open' ? null : v })} options={[{ value: 'open', label: 'À traiter' }, { value: 'to_clean', label: 'À faire' }, { value: 'in_progress', label: 'En cours' }, { value: 'cleaned', label: 'Terminées (à contrôler)' }, { value: 'inspected', label: 'Contrôlées' }]} />}</Field>
        <Switch label="Mes tâches seulement" checked={mine} onCheckedChange={(v) => set({ mine: v ? 'true' : null })} />
      </div>
      {list.isError ? <p className="text-[14px] text-ink-2">Impossible de charger les tâches.</p> : (
        <>
          <DataTable<HkTask>
            caption="Tâches de ménage"
            loading={list.isPending}
            rows={list.data?.items ?? []}
            rowKey={(r) => r.id}
            columns={[
              { key: 'r', header: 'Chambre', cell: (r) => <span className="flex flex-col"><span className="num-col font-medium text-ink">{r.roomNumber}</span><span className="text-[13px] text-ink-2">{r.categoryName}</span></span> },
              { key: 't', header: 'Tâche', cell: (r) => <span className="flex flex-col"><span>{TASK_TYPE[r.taskType] ?? r.taskType}</span>{r.notes && <span className="text-[13px] text-ink-2">{r.notes}</span>}</span> },
              { key: 'p', header: 'Priorité', cell: (r) => (r.priority === 'normal' || r.priority === 'low' ? <Badge>{PRIORITY_LABEL[r.priority]}</Badge> : <StateBadge tone={r.priority === 'urgent' ? 'danger' : 'warning'}>{PRIORITY_LABEL[r.priority]}</StateBadge>) },
              { key: 'a', header: 'Attribuée à', cell: (r) => r.assignedName ?? <span className="text-ink-3">—</span> },
              { key: 's', header: 'État', cell: (r) => <StateBadge tone={STATUS[r.status]?.tone ?? 'neutral'}>{STATUS[r.status]?.label ?? r.status}</StateBadge> },
              { key: 'd', header: 'Créée le', cell: (r) => formatDate(r.createdAt, { time: true }) },
              { key: 'x', header: 'Actions', cell: (r) => (
                <span className="flex gap-2">
                  {can('housekeeping:update_task') && r.status === 'to_clean' && <Button size="sm" variant="primary" onClick={() => run(r, 'start', 'Ménage commencé.')} aria-label={`Commencer la chambre ${r.roomNumber}`}>Commencer</Button>}
                  {can('housekeeping:update_task') && r.status === 'in_progress' && <Button size="sm" variant="primary" onClick={() => run(r, 'complete', 'Ménage terminé.')} aria-label={`Terminer la chambre ${r.roomNumber}`}>Terminer</Button>}
                  {can('housekeeping:manage') && r.status === 'cleaned' && <Button size="sm" variant="primary" onClick={() => run(r, 'inspect', 'Chambre contrôlée.')} aria-label={`Contrôler la chambre ${r.roomNumber}`}>Contrôler</Button>}
                </span>
              ) },
            ]}
            mobileCard={(r) => <div className="flex flex-col gap-1"><span className="flex items-center justify-between gap-3"><span className="num-col font-medium text-ink">Chambre {r.roomNumber}</span><StateBadge tone={STATUS[r.status]?.tone ?? 'neutral'}>{STATUS[r.status]?.label ?? r.status}</StateBadge></span><span className="text-[13px] text-ink-2">{TASK_TYPE[r.taskType]} · {PRIORITY_LABEL[r.priority].toLowerCase()}{r.assignedName ? ` · ${r.assignedName}` : ''}</span></div>}
            empty={<EmptyState kind="calendar" title="Aucune tâche" description="Les tâches se créent toutes seules au départ d'un client ; vous pouvez aussi en ajouter une." />}
          />
          <Pager page={page} pageSize={25} total={list.data?.total ?? 0} onPage={(p) => set({ page: String(p) })} />
        </>
      )}
      {creating && <TaskModal onClose={() => setCreating(false)} />}
    </Panel>
  );
}
