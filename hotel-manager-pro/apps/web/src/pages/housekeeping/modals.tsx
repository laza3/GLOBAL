import { useState } from 'react';
import { toast } from 'sonner';
import { useCalendarRooms } from './use-rooms';
import { PRIORITY_LABEL, TASK_TYPE, useCreateMaintenance, useCreateTask, useHkStaff, usePatchMaintenance, useReportIssue, type MaintenanceItem, type Priority } from '../../api/housekeeping';
import { moneyInputValue, parseMoneyInput } from '../../lib/money-input';
import { useCurrency } from '../../lib/use-currency';
import { ActionModal } from '../../ui/action-modal';
import { Field, Input, Select, Switch, Textarea } from '../../ui/form';

const PRIORITIES = (Object.keys(PRIORITY_LABEL) as Priority[]).map((value) => ({ value, label: PRIORITY_LABEL[value] }));

export function ReportIssueModal({ taskId, roomNumber, onClose }: { taskId: string; roomNumber: string; onClose: () => void }) {
  const report = useReportIssue();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  return (
    <ActionModal title={`Signaler un problème — chambre ${roomNumber}`} description="Une demande de maintenance est créée, liée à la chambre." confirmLabel="Signaler" onClose={onClose}
      onSubmit={() => (title.trim().length < 3 ? 'Décrivez le problème en quelques mots.' : report.mutateAsync({ taskId, body: { title: title.trim(), description: description.trim() || null, priority } }).then(() => void toast.success('Problème signalé à la maintenance.')))}>
      <Field label="Problème" required>{(c) => <Input {...c} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Robinet qui fuit, ampoule grillée…" autoFocus />}</Field>
      <Field label="Priorité">{(c) => <Select {...c} value={priority} onValueChange={(v) => setPriority(v as Priority)} options={PRIORITIES} />}</Field>
      <Field label="Détails (facultatif)">{(c) => <Textarea {...c} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />}</Field>
    </ActionModal>
  );
}

export function TaskModal({ onClose }: { onClose: () => void }) {
  const rooms = useCalendarRooms();
  const staff = useHkStaff();
  const create = useCreateTask();
  const [roomId, setRoomId] = useState('');
  const [taskType, setTaskType] = useState('deep_clean');
  const [priority, setPriority] = useState<Priority>('normal');
  const [assignedId, setAssignedId] = useState('none');
  const [notes, setNotes] = useState('');
  return (
    <ActionModal title="Nouvelle tâche de ménage" confirmLabel="Créer la tâche" onClose={onClose}
      onSubmit={() => (!roomId ? 'Choisissez la chambre.' : create.mutateAsync({ roomId, taskType, priority, assignedId: assignedId === 'none' ? null : assignedId, notes: notes.trim() || null }).then(() => void toast.success('Tâche créée.')))}>
      <Field label="Chambre" required>{(c) => <Select {...c} value={roomId} onValueChange={setRoomId} options={(rooms.data ?? []).map((r) => ({ value: r.id, label: `Chambre ${r.number}` }))} placeholder="Choisir une chambre" />}</Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Type">{(c) => <Select {...c} value={taskType} onValueChange={setTaskType} options={Object.entries(TASK_TYPE).map(([value, label]) => ({ value, label }))} />}</Field>
        <Field label="Priorité">{(c) => <Select {...c} value={priority} onValueChange={(v) => setPriority(v as Priority)} options={PRIORITIES} />}</Field>
      </div>
      <Field label="Attribuer à">{(c) => <Select {...c} value={assignedId} onValueChange={setAssignedId} options={[{ value: 'none', label: 'Personne (tâche libre)' }, ...(staff.data ?? []).map((s) => ({ value: s.id, label: s.name }))]} />}</Field>
      <Field label="Consignes (facultatif)">{(c) => <Textarea {...c} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />}</Field>
    </ActionModal>
  );
}

export function MaintenanceModal({ today, onClose }: { today: string; onClose: () => void }) {
  const rooms = useCalendarRooms();
  const create = useCreateMaintenance();
  const [roomId, setRoomId] = useState('none');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [block, setBlock] = useState(false);
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState('');
  return (
    <ActionModal title="Signaler une panne ou des travaux" confirmLabel="Enregistrer" onClose={onClose}
      onSubmit={() => {
        if (title.trim().length < 3) return 'Décrivez le problème en quelques mots.';
        if (block && roomId === 'none') return 'Choisissez la chambre à bloquer.';
        if (block && endsOn && endsOn <= startsOn) return 'La fin doit être après le début.';
        return create.mutateAsync({ roomId: roomId === 'none' ? null : roomId, title: title.trim(), description: description.trim() || null, priority, block: block ? { startsOn, endsOn: endsOn || null } : null }).then(() => void toast.success('Demande enregistrée.'));
      }}>
      <Field label="Problème" required>{(c) => <Input {...c} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Climatisation en panne" autoFocus />}</Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Chambre">{(c) => <Select {...c} value={roomId} onValueChange={setRoomId} options={[{ value: 'none', label: 'Aucune (parties communes)' }, ...(rooms.data ?? []).map((r) => ({ value: r.id, label: `Chambre ${r.number}` }))]} />}</Field>
        <Field label="Priorité">{(c) => <Select {...c} value={priority} onValueChange={(v) => setPriority(v as Priority)} options={PRIORITIES} />}</Field>
      </div>
      <Field label="Détails (facultatif)">{(c) => <Textarea {...c} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />}</Field>
      <Switch label="Bloquer la chambre à la vente" description="Elle n'est plus proposée tant que la demande n'est pas résolue. Impossible si un séjour y est déjà prévu." checked={block} onCheckedChange={setBlock} />
      {block && (
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Du">{(c) => <Input {...c} type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />}</Field>
          <Field label="Au (exclu, facultatif)" hint="Vide : jusqu'à la résolution.">{(c) => <Input {...c} type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />}</Field>
        </div>
      )}
    </ActionModal>
  );
}

export function ResolveModal({ item, currency, onClose }: { item: MaintenanceItem; currency: string; onClose: () => void }) {
  const patch = usePatchMaintenance();
  const [cost, setCost] = useState(item.costAmount != null ? moneyInputValue(item.costAmount, currency) : '');
  return (
    <ActionModal title={`Résoudre « ${item.title} »`} description={item.allocationId ? 'Le blocage de la chambre est levé : elle redevient disponible à la vente.' : undefined} confirmLabel="Marquer comme résolue" onClose={onClose}
      onSubmit={() => {
        const costAmount = cost.trim() ? parseMoneyInput(cost, currency) : null;
        if (cost.trim() && costAmount === null) return 'Coût invalide.';
        return patch.mutateAsync({ id: item.id, body: { status: 'resolved', costAmount } }).then(() => void toast.success('Demande résolue.'));
      }}>
      <Field label={`Coût des travaux (${currency}, facultatif)`}>{(c) => <Input {...c} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} autoComplete="off" />}</Field>
    </ActionModal>
  );
}
