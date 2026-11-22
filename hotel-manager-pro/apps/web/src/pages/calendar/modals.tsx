import { useState } from 'react';
import { toast } from 'sonner';
import { addDays, type DateString } from '@hmp/shared';
import { BLOCK_REASON_LABEL, useCreateBlock, useDeleteBlock, useMoveStay, usePatchBlock, type BlockItem, type BlockReason, type CalendarRoom, type StayItem } from '../../api/calendar';
import { useAvailability } from '../../api/reservations';
import { ActionModal } from '../../ui/action-modal';
import { Field, Input, Select, Switch, Textarea } from '../../ui/form';
import { ConfirmDialog } from '../../ui/overlay';
import { Callout } from '../../ui/page';

const REASONS = (Object.keys(BLOCK_REASON_LABEL) as BlockReason[]).map((value) => ({ value, label: BLOCK_REASON_LABEL[value] }));

export function BlockModal({ rooms, today, onClose }: { rooms: CalendarRoom[]; today: DateString; onClose: () => void }) {
  const create = useCreateBlock();
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? '');
  const [startsOn, setStartsOn] = useState<DateString>(today);
  const [endsOn, setEndsOn] = useState<DateString>(addDays(today, 1));
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<BlockReason>('maintenance');
  const [notes, setNotes] = useState('');
  return (
    <ActionModal
      title="Bloquer une chambre"
      description="Une chambre bloquée n'est plus proposée à la vente sur la période. Impossible si un séjour y est déjà prévu."
      confirmLabel="Bloquer la chambre"
      onClose={onClose}
      onSubmit={() => {
        if (!roomId) return 'Choisissez la chambre.';
        if (!startsOn) return 'Indiquez le début du blocage.';
        if (!open && (!endsOn || endsOn <= startsOn)) return 'La fin doit être après le début.';
        return create.mutateAsync({ roomId, startsOn, endsOn: open ? null : endsOn, reason, notes: notes.trim() || null }).then(() => void toast.success('Chambre bloquée.'));
      }}
    >
      <Field label="Chambre" required>{(c) => <Select {...c} value={roomId} onValueChange={setRoomId} options={rooms.map((r) => ({ value: r.id, label: `Chambre ${r.number} — ${r.categoryName}` }))} />}</Field>
      <Field label="Motif" required>{(c) => <Select {...c} value={reason} onValueChange={(v) => setReason(v as BlockReason)} options={REASONS} />}</Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Du" required>{(c) => <Input {...c} type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />}</Field>
        <Field label="Au (exclu)" required={!open} hint="Premier jour où la chambre est de nouveau vendable.">{(c) => <Input {...c} type="date" value={endsOn} disabled={open} onChange={(e) => setEndsOn(e.target.value)} />}</Field>
      </div>
      <Switch label="Jusqu'à nouvel ordre" description="Pas de date de fin : vous lèverez le blocage vous-même." checked={open} onCheckedChange={setOpen} />
      <Field label="Note (facultatif)">{(c) => <Textarea {...c} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />}</Field>
    </ActionModal>
  );
}

export function EndBlockModal({ block, onClose }: { block: BlockItem; onClose: () => void }) {
  const patch = usePatchBlock();
  const [open, setOpen] = useState(block.endsOn === null);
  const [endsOn, setEndsOn] = useState<DateString>(block.endsOn ?? addDays(block.startsOn, 1));
  return (
    <ActionModal
      title="Modifier la fin du blocage"
      description="Par exemple quand la maintenance se termine plus tôt, ou plus tard, que prévu."
      confirmLabel="Enregistrer"
      onClose={onClose}
      onSubmit={() => {
        if (!open && endsOn <= block.startsOn) return 'La fin doit être après le début du blocage.';
        return patch.mutateAsync({ id: block.id, body: { endsOn: open ? null : endsOn } }).then(() => void toast.success('Blocage modifié.'));
      }}
    >
      <Field label="Au (exclu)" hint="Premier jour où la chambre est de nouveau vendable.">{(c) => <Input {...c} type="date" value={endsOn} disabled={open} onChange={(e) => setEndsOn(e.target.value)} />}</Field>
      <Switch label="Jusqu'à nouvel ordre" checked={open} onCheckedChange={setOpen} />
    </ActionModal>
  );
}

export function UnblockDialog({ block, onClose }: { block: BlockItem; onClose: () => void }) {
  const del = useDeleteBlock();
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Lever ce blocage ?"
      description="La chambre redevient immédiatement disponible à la vente sur toute la période."
      confirmLabel="Lever le blocage"
      destructive={false}
      loading={del.isPending}
      onConfirm={() => del.mutate(block.id, { onSuccess: () => { onClose(); toast.success('Blocage levé.'); }, onError: () => { onClose(); toast.error('Impossible de lever le blocage.'); } })}
    />
  );
}

/** Déplacement d'un séjour : autre chambre (parmi les chambres libres sur ces dates) et/ou autres dates. Les nuits conservées gardent leur prix. */
export function MoveStayModal({ stay, rooms, onClose }: { stay: StayItem; rooms: CalendarRoom[]; onClose: () => void }) {
  const move = useMoveStay();
  const [roomId, setRoomId] = useState(stay.roomId);
  const [checkIn, setCheckIn] = useState(stay.startsOn);
  const [checkOut, setCheckOut] = useState(stay.endsOn);
  const inHouse = stay.status === 'checked_in';
  const valid = !!checkIn && !!checkOut && checkOut > checkIn;
  const avail = useAvailability({ checkIn, checkOut, adults: stay.adults, children: stay.children, excludeLineId: stay.id }, valid && !inHouse);
  const free = (avail.data?.categories ?? []).flatMap((c) => c.rooms.map((r) => ({ value: r.id, label: `Chambre ${r.number} — ${c.name}` })));
  const current = rooms.find((r) => r.id === stay.roomId);
  const options = free.some((o) => o.value === stay.roomId) || !current ? free : [{ value: stay.roomId, label: `Chambre ${current.number} (actuelle — indisponible sur ces dates)` }, ...free];
  return (
    <ActionModal
      title={`Déplacer le séjour de ${stay.guestName}`}
      description={inHouse ? "Le client est en séjour : seule la date de départ peut changer ici." : 'Les nuits conservées gardent leur prix ; seules les nuits ajoutées sont chiffrées au tarif actuel.'}
      confirmLabel="Déplacer"
      width="38rem"
      onClose={onClose}
      onSubmit={() => {
        if (!valid) return "Le départ doit être après l'arrivée.";
        const body: { roomId?: string; checkIn?: DateString; checkOut?: DateString } = {};
        if (roomId !== stay.roomId) body.roomId = roomId;
        if (checkIn !== stay.startsOn) body.checkIn = checkIn;
        if (checkOut !== stay.endsOn) body.checkOut = checkOut;
        if (Object.keys(body).length === 0) return 'Aucune modification.';
        return move.mutateAsync({ lineId: stay.id, body }).then(() => void toast.success('Séjour déplacé.'));
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Arrivée">{(c) => <Input {...c} type="date" value={checkIn} disabled={inHouse} onChange={(e) => setCheckIn(e.target.value)} />}</Field>
        <Field label="Départ">{(c) => <Input {...c} type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />}</Field>
      </div>
      {!inHouse && <Field label="Chambre" hint="Seules les chambres libres sur ces dates et assez grandes sont proposées.">{(c) => <Select {...c} value={roomId} onValueChange={setRoomId} options={options} placeholder={avail.isPending ? 'Recherche…' : 'Choisir une chambre'} />}</Field>}
      {avail.isError && <Callout tone="warning">Impossible de vérifier la disponibilité de ces dates.</Callout>}
    </ActionModal>
  );
}
