import { formatMoney } from '@hmp/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { isApiError } from '../../api/client';
import {
  useAddRoom, useAvailability, useCancelReservation, usePatchReservation, usePatchRoom,
  type ReservationDetail, type ReservationLine,
} from '../../api/reservations';
import { moneyInputValue, parseMoneyInput } from '../../lib/money-input';
import { SOURCE_OPTIONS } from '../../lib/reservation-status';
import { ActionModal } from '../../ui/action-modal';
import { Button } from '../../ui/button';
import { Field, Input, Select, Textarea } from '../../ui/form';
import { Modal } from '../../ui/overlay';
import { Callout } from '../../ui/page';
import { StayFinder } from './stay-finder';

const intIn = (s: string, min: number, max: number) => {
  const n = Number(s);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/** Valeur d'un champ date-heure (heure locale de l'appareil) depuis un instant ISO. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

/* ------------------------------------------------------------------ Informations de la réservation */
export function EditReservationModal({ d, onClose }: { d: ReservationDetail; onClose: () => void }) {
  const patch = usePatchReservation();
  const [source, setSource] = useState<string>(d.source);
  const [v, setV] = useState({
    group: d.groupName ?? '', requests: d.specialRequests ?? '', notes: d.internalNotes ?? '',
    deposit: moneyInputValue(d.depositRequired, d.currency), discount: moneyInputValue(d.discountRequested, d.currency), expires: toLocalInput(d.tentativeExpiresAt),
  });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  return (
    <ActionModal
      title={`Modifier ${d.reference}`}
      description="Les dates et les chambres se modifient depuis chaque chambre. Le prix des nuits déjà enregistrées ne change pas."
      confirmLabel="Enregistrer"
      width="38rem"
      onClose={onClose}
      onSubmit={() => {
        const deposit = v.deposit.trim() ? parseMoneyInput(v.deposit, d.currency) : 0;
        const discount = v.discount.trim() ? parseMoneyInput(v.discount, d.currency) : 0;
        if (deposit === null) return 'Acompte invalide.';
        if (discount === null) return 'Remise invalide.';
        const body: Record<string, unknown> = { version: d.version };
        if (source !== d.source) body.source = source;
        if (v.group.trim() !== (d.groupName ?? '')) body.groupName = v.group.trim() || null;
        if (v.requests.trim() !== (d.specialRequests ?? '')) body.specialRequests = v.requests.trim() || null;
        if (v.notes.trim() !== (d.internalNotes ?? '')) body.internalNotes = v.notes.trim() || null;
        if (deposit !== d.depositRequired) body.depositRequired = deposit;
        if (discount !== d.discountRequested) body.discount = discount;
        if (d.status === 'tentative' && v.expires && v.expires !== toLocalInput(d.tentativeExpiresAt)) {
          const at = new Date(v.expires);
          if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) return "L'échéance de l'option doit être dans le futur.";
          body.tentativeExpiresAt = at.toISOString();
        }
        if (Object.keys(body).length === 1) return 'Aucune modification.';
        return patch.mutateAsync({ id: d.id, body }).then(() => void toast.success('Réservation modifiée.'));
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Origine">{(c) => <Select {...c} value={source} onValueChange={setSource} options={SOURCE_OPTIONS} />}</Field>
        <Field label="Groupe">{(c) => <Input {...c} value={v.group} onChange={set('group')} maxLength={120} />}</Field>
        <Field label="Acompte demandé">{(c) => <Input {...c} inputMode="decimal" value={v.deposit} onChange={set('deposit')} autoComplete="off" />}</Field>
        <Field label="Remise" hint="Sur le prix des nuits.">{(c) => <Input {...c} inputMode="decimal" value={v.discount} onChange={set('discount')} autoComplete="off" />}</Field>
        {d.status === 'tentative' && <Field label="Échéance de l'option" hint="Heure de votre appareil.">{(c) => <Input {...c} type="datetime-local" value={v.expires} onChange={set('expires')} />}</Field>}
      </div>
      <Field label="Demandes particulières">{(c) => <Textarea {...c} value={v.requests} onChange={set('requests')} maxLength={2000} />}</Field>
      <Field label="Notes internes">{(c) => <Textarea {...c} value={v.notes} onChange={set('notes')} maxLength={2000} />}</Field>
    </ActionModal>
  );
}

/* ------------------------------------------------------------------ Modifier une chambre */
export function EditLineModal({ d, line, onClose }: { d: ReservationDetail; line: ReservationLine; onClose: () => void }) {
  const patch = usePatchRoom();
  const inHouse = line.status === 'checked_in';
  const [checkIn, setCheckIn] = useState(line.checkIn);
  const [checkOut, setCheckOut] = useState(line.checkOut);
  const [adults, setAdults] = useState(String(line.adults));
  const [children, setChildren] = useState(String(line.children));
  const [roomId, setRoomId] = useState(line.roomId ?? '');
  const a = intIn(adults, 1, 30) ?? 1;
  const c = intIn(children, 0, 30) ?? 0;
  const dates = !!checkIn && !!checkOut && checkOut > checkIn;
  // La chambre occupée par cette ligne est libre « pour elle-même » : on l'exclut du calcul
  const avail = useAvailability({ checkIn, checkOut, adults: a, children: c, excludeLineId: line.id }, dates && !inHouse);
  const rooms = (avail.data?.categories ?? []).flatMap((cat) => cat.rooms.map((r) => ({ value: r.id, label: `Chambre ${r.number} — ${cat.name}${r.id === line.roomId ? ' (actuelle)' : ''}` })));
  const current = line.roomId && !rooms.some((r) => r.value === line.roomId) ? [{ value: line.roomId, label: `Chambre ${line.roomNumber} (actuelle — indisponible sur ces dates)` }] : [];

  return (
    <ActionModal
      title={`Modifier la chambre ${line.roomNumber ?? ''}`}
      description={inHouse ? 'Le client est en séjour : seule la date de départ peut être modifiée ici.' : "Les nuits conservées gardent leur prix ; seules les nuits ajoutées sont facturées au tarif actuel."}
      confirmLabel="Enregistrer"
      width="38rem"
      onClose={onClose}
      onSubmit={() => {
        if (!dates) return "Le départ doit être après l'arrivée.";
        if (intIn(adults, 1, 30) === null || intIn(children, 0, 30) === null) return 'Nombre de personnes invalide.';
        const body: Record<string, unknown> = { version: d.version };
        if (checkIn !== line.checkIn) body.checkIn = checkIn;
        if (checkOut !== line.checkOut) body.checkOut = checkOut;
        if (a !== line.adults) body.adults = a;
        if (c !== line.children) body.children = c;
        if (roomId && roomId !== line.roomId) body.roomId = roomId;
        if (Object.keys(body).length === 1) return 'Aucune modification.';
        return patch.mutateAsync({ id: d.id, lineId: line.id, body }).then(() => void toast.success('Chambre modifiée.'));
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Arrivée">{(f) => <Input {...f} type="date" value={checkIn} disabled={inHouse} onChange={(e) => setCheckIn(e.target.value)} />}</Field>
        <Field label="Départ">{(f) => <Input {...f} type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />}</Field>
        <Field label="Adultes">{(f) => <Input {...f} inputMode="numeric" value={adults} disabled={inHouse} onChange={(e) => setAdults(e.target.value)} />}</Field>
        <Field label="Enfants">{(f) => <Input {...f} inputMode="numeric" value={children} disabled={inHouse} onChange={(e) => setChildren(e.target.value)} />}</Field>
      </div>
      {!inHouse && (
        <Field label="Chambre" hint="Seules les chambres libres sur ces dates et assez grandes sont proposées. Changer de catégorie recalcule tout le séjour au tarif actuel.">
          {(f) => <Select {...f} value={roomId} onValueChange={setRoomId} options={[...current, ...rooms]} placeholder={avail.isPending ? 'Recherche…' : 'Choisir une chambre'} />}
        </Field>
      )}
      {avail.isError && <Callout tone="warning">Impossible de vérifier la disponibilité de ces dates.</Callout>}
    </ActionModal>
  );
}

/* ------------------------------------------------------------------ Ajouter une chambre */
export function AddRoomModal({ d, onClose }: { d: ReservationDetail; onClose: () => void }) {
  const add = useAddRoom();
  const [error, setError] = useState<string | null>(null);
  const first = d.rooms.find((l) => !['cancelled', 'no_show'].includes(l.status));
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Ajouter une chambre" description="Choisissez les dates et la chambre : elle est ajoutée à cette réservation et le total est recalculé." width="46rem" footer={<Button variant="secondary" onClick={onClose}>Fermer</Button>}>
      <div className="flex flex-col gap-5">
        <StayFinder
          currency={d.currency}
          defaults={first ? { checkIn: first.checkIn, checkOut: first.checkOut, adults: first.adults } : undefined}
          onPick={(l) => {
            setError(null);
            add.mutate(
              { id: d.id, body: { categoryId: l.categoryId, roomId: l.roomId ?? null, checkIn: l.checkIn, checkOut: l.checkOut, adults: l.adults, children: l.children, version: d.version } },
              { onSuccess: () => { toast.success(`Chambre ${l.categoryName} ajoutée (${formatMoney(l.subtotal, d.currency)} hors taxes).`); onClose(); }, onError: (e) => setError(isApiError(e) ? e.message : "L'ajout a échoué.") },
            );
          }}
        />
        {error && <Callout tone="danger">{error}</Callout>}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ Annuler la réservation */
export function CancelReservationModal({ d, onClose }: { d: ReservationDetail; onClose: () => void }) {
  const cancel = useCancelReservation();
  const [reason, setReason] = useState('');
  return (
    <ActionModal
      title={`Annuler ${d.reference}`}
      description="Les chambres sont libérées immédiatement. L'annulation ne peut pas être défaite."
      confirmLabel="Annuler la réservation"
      onClose={onClose}
      onSubmit={() => {
        if (reason.trim().length < 3) return 'Indiquez le motif (3 caractères au moins).';
        return cancel.mutateAsync({ id: d.id, reason: reason.trim(), version: d.version }).then(() => void toast.success('Réservation annulée.'));
      }}
    >
      {d.amountPaid > 0 && <Callout tone="warning">{formatMoney(d.amountPaid, d.currency)} ont déjà été encaissés. Ils restent sur la note du client : remboursez-les, ou conservez-les selon vos conditions d'annulation.</Callout>}
      <Field label="Motif de l'annulation" required hint="Conservé dans l'historique.">{(c) => <Textarea {...c} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}</Field>
    </ActionModal>
  );
}
