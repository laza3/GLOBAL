import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { isApiError } from '../../api/client';
import { HK_LABEL, PRIORITY_LABEL, TASK_TYPE, useHkBoard, useHkStaff, useAssignTask, useTaskStep, useSetRoomHk, type BoardRoom, type HkStatus } from '../../api/housekeeping';
import { useCan } from '../../auth/session';
import { useDocumentTitle } from '../../lib/use-title';
import { ActionModal } from '../../ui/action-modal';
import { Button } from '../../ui/button';
import { Badge, EmptyState, Skeleton, StateBadge } from '../../ui/data';
import { Field, Select, Switch } from '../../ui/form';
import { Callout, Panel } from '../../ui/page';
import { ReportIssueModal } from './modals';

const COLUMNS: HkStatus[] = ['dirty', 'cleaning', 'clean', 'inspected'];
const TOKEN: Record<HkStatus, string> = { dirty: 'pending', cleaning: 'confirmed', clean: 'inhouse', inspected: 'departed' };

export default function HousekeepingBoardPage() {
  useDocumentTitle('Housekeeping');
  const can = useCan();
  const [mine, setMine] = useState(false);
  const board = useHkBoard(mine);
  const step = useTaskStep();
  const setHk = useSetRoomHk();
  const [assigning, setAssigning] = useState<BoardRoom | null>(null);
  const [issue, setIssue] = useState<BoardRoom | null>(null);
  const work = can('housekeeping:update_task');
  const manage = can('housekeeping:manage');
  const run = (room: BoardRoom, s: 'start' | 'complete' | 'inspect', done: string) =>
    room.taskId && step.mutate({ id: room.taskId, step: s }, { onSuccess: () => toast.success(done), onError: (e) => toast.error(isApiError(e) ? e.message : "L'action a échoué.") });

  if (board.isError) return <Callout tone="danger">Impossible de charger le tableau.</Callout>;
  if (!board.data) return <div className="flex flex-col gap-3" role="status" aria-label="Chargement"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>;
  const { rooms, counts } = board.data;
  if (rooms.length === 0 && !mine) return <EmptyState kind="calendar" title="Aucune chambre" description="Créez vos chambres dans le module Chambres : elles apparaîtront ici." />;

  return (
    <>
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <dl className="flex flex-wrap gap-x-8 gap-y-2" aria-label="Chambres par état">
            {COLUMNS.map((c) => <div key={c} className="flex items-baseline gap-2"><dt className="text-[13px] text-ink-2">{HK_LABEL[c]}</dt><dd className="num-display text-[22px] font-semibold text-ink">{counts[c] ?? 0}</dd></div>)}
          </dl>
          <Switch label="Mes tâches seulement" checked={mine} onCheckedChange={setMine} />
        </div>
        <div className="grid gap-5 lg:grid-cols-4">
          {COLUMNS.map((col) => {
            const list = rooms.filter((r) => r.housekeepingStatus === col);
            return (
              <section key={col} aria-label={`${HK_LABEL[col]} : ${list.length} chambre${list.length > 1 ? 's' : ''}`} className="flex min-w-0 flex-col gap-3">
                <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ink"><span aria-hidden className="size-2.5 rounded-full" style={{ background: `var(--st-${TOKEN[col]})` }} />{HK_LABEL[col]}<span className="text-ink-3">({list.length})</span></h2>
                {list.length === 0 && <p className="rounded-[14px] border border-dashed border-hairline px-3 py-6 text-center text-[13px] text-ink-3">Aucune chambre</p>}
                <ul className="flex flex-col gap-2">
                  {list.map((r) => (
                    <li key={r.id} className="flex flex-col gap-2 rounded-[14px] border border-hairline bg-[var(--glass-data)] p-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="flex flex-col"><span className="num-col text-[17px] font-semibold text-ink">{r.number}</span><span className="text-[12.5px] text-ink-2">{r.categoryName}{r.floor != null ? ` · étage ${r.floor}` : ''}</span></span>
                        <span className="flex flex-wrap justify-end gap-1">
                          {r.displayStatus === 'occupied' && <Badge>Occupée</Badge>}
                          {r.arrivesToday && <StateBadge tone="warning">Arrivée aujourd'hui</StateBadge>}
                          {r.departsToday && <Badge>Départ aujourd'hui</Badge>}
                          {r.openIssues > 0 && <StateBadge tone="danger">{r.openIssues} panne{r.openIssues > 1 ? 's' : ''}</StateBadge>}
                        </span>
                      </div>
                      {r.taskId && <span className="text-[12.5px] text-ink-2">{TASK_TYPE[r.taskType ?? ''] ?? 'Tâche'}{r.taskPriority && r.taskPriority !== 'normal' ? ` · ${PRIORITY_LABEL[r.taskPriority].toLowerCase()}` : ''}{r.assignedName ? ` · ${r.assignedName}` : ' · non attribuée'}</span>}
                      <div className="flex flex-wrap gap-1.5">
                        {work && r.taskStatus === 'to_clean' && <Button size="sm" variant="primary" onClick={() => run(r, 'start', `Chambre ${r.number} : ménage commencé.`)} aria-label={`Commencer le ménage de la chambre ${r.number}`}>Commencer</Button>}
                        {work && (r.taskStatus === 'in_progress') && <Button size="sm" variant="primary" onClick={() => run(r, 'complete', `Chambre ${r.number} propre.`)} aria-label={`Terminer le ménage de la chambre ${r.number}`}>Terminer</Button>}
                        {manage && r.taskStatus === 'cleaned' && <Button size="sm" variant="primary" onClick={() => run(r, 'inspect', `Chambre ${r.number} contrôlée.`)} aria-label={`Contrôler la chambre ${r.number}`}><Sparkles aria-hidden className="size-3.5" />Contrôler</Button>}
                        {manage && r.taskId && r.taskStatus !== 'cleaned' && <Button size="sm" variant="ghost" onClick={() => setAssigning(r)} aria-label={`Attribuer la chambre ${r.number}`}>Attribuer</Button>}
                        {work && r.taskId && <Button size="sm" variant="ghost" onClick={() => setIssue(r)} aria-label={`Signaler un problème dans la chambre ${r.number}`}>Signaler</Button>}
                        {manage && col === 'dirty' && !r.taskId && r.displayStatus !== 'occupied' && <Button size="sm" variant="secondary" onClick={() => setHk.mutate({ roomId: r.id, status: 'clean' }, { onSuccess: () => toast.success(`Chambre ${r.number} marquée propre.`) })} aria-label={`Marquer la chambre ${r.number} propre`}>Marquer propre</Button>}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </Panel>
      {assigning && <AssignModal room={assigning} onClose={() => setAssigning(null)} />}
      {issue && issue.taskId && <ReportIssueModal taskId={issue.taskId} roomNumber={issue.number} onClose={() => setIssue(null)} />}
    </>
  );
}

function AssignModal({ room, onClose }: { room: BoardRoom; onClose: () => void }) {
  const staff = useHkStaff();
  const assign = useAssignTask();
  const [id, setId] = useState(room.assignedId ?? 'none');
  return (
    <ActionModal title={`Attribuer la chambre ${room.number}`} description="La personne verra la tâche dans « Mes tâches »." confirmLabel="Enregistrer" onClose={onClose}
      onSubmit={() => assign.mutateAsync({ id: room.taskId!, assignedId: id === 'none' ? null : id }).then(() => void toast.success('Tâche attribuée.'))}>
      <Field label="Personne">{(c) => <Select {...c} value={id} onValueChange={setId} options={[{ value: 'none', label: 'Personne (tâche libre)' }, ...(staff.data ?? []).map((s) => ({ value: s.id, label: `${s.name} — ${s.role}` }))]} />}</Field>
    </ActionModal>
  );
}
