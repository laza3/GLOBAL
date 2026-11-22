import { formatMoney, nightsBetween } from '@hmp/shared';
import { ArrowLeft, Trash2, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { isApiError } from '../../api/client';
import { useCreateReservation } from '../../api/reservations';
import { formatDay, plural } from '../../lib/format';
import { parseMoneyInput } from '../../lib/money-input';
import { SOURCE_OPTIONS } from '../../lib/reservation-status';
import { useMe } from '../../auth/session';
import { useCurrency } from '../../lib/use-currency';
import { useDraft } from '../../lib/use-draft';
import { useDocumentTitle } from '../../lib/use-title';
import { Button } from '../../ui/button';
import { Field, Input, SegmentedControl, Select, Textarea } from '../../ui/form';
import { Callout, PageHeader, Panel } from '../../ui/page';
import { GuestModal } from '../guests/modals';
import { GuestPicker } from '../guests/guest-picker';
import { StayFinder, type PickedLine } from './stay-finder';

type Status = 'confirmed' | 'pending' | 'tentative';
const STATUS_HELP: Record<Status, string> = {
  confirmed: 'La réservation est ferme : la chambre est bloquée.',
  pending: "En attente d'un acompte ou d'une confirmation du client : la chambre est bloquée.",
  tentative: "Option : la chambre est bloquée jusqu'à l'échéance, puis libérée automatiquement si vous ne confirmez pas.",
};

/** Valeur initiale d'une échéance d'option : demain, même heure, au format du champ date-heure. */
const tomorrowLocal = () => {
  const d = new Date(Date.now() + 24 * 3600_000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

export default function NewReservationPage() {
  useDocumentTitle('Nouvelle réservation');
  const currency = useCurrency();
  const navigate = useNavigate();
  const create = useCreateReservation();
  const [lines, setLines] = useState<Array<PickedLine & { key: string }>>([]);
  const [guest, setGuest] = useState<{ id: string; name: string } | null>(null);
  const [creatingGuest, setCreatingGuest] = useState(false);
  const [status, setStatus] = useState<Status>('confirmed');
  const [expires, setExpires] = useState(tomorrowLocal());
  const [source, setSource] = useState('direct');
  const [v, setV] = useState({ deposit: '', discount: '', group: '', requests: '', notes: '' });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  // Brouillon : la saisie survit à un rechargement ou à une coupure de connexion (jamais envoyée au serveur)
  const me = useMe();
  const draftValue = useMemo(() => ({ lines, guest, status, expires, source, v }), [lines, guest, status, expires, source, v]);
  const draft = useDraft(`hmp_draft_reservation_${me.user.id}`, draftValue, (d) => {
    setLines(d.lines); setGuest(d.guest); setStatus(d.status); setExpires(d.expires); setSource(d.source); setV(d.v);
  }, (d) => d.lines.length === 0 && !d.guest && !d.v.deposit && !d.v.discount && !d.v.group && !d.v.requests && !d.v.notes);

  // Même clé tant que le contenu est identique (double-clic, nouvelle tentative) ; nouvelle clé dès que le contenu change
  const key = useRef(crypto.randomUUID());
  useEffect(() => { key.current = crypto.randomUUID(); }, [lines, guest, status, expires, source, v]);

  const subtotal = lines.reduce((s, l) => s + l.subtotal, 0);
  const discount = parseMoneyInput(v.discount || '0', currency);

  const submit = async () => {
    setError(null);
    if (lines.length === 0) return setError('Ajoutez au moins une chambre.');
    if (!guest) return setError('Choisissez le client.');
    const deposit = v.deposit.trim() ? parseMoneyInput(v.deposit, currency) : 0;
    if (deposit === null) return setError('Acompte invalide.');
    if (discount === null) return setError('Remise invalide.');
    let tentativeExpiresAt: string | undefined;
    if (status === 'tentative') {
      const at = new Date(expires);
      if (!expires || Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) return setError("L'échéance de l'option doit être dans le futur.");
      tentativeExpiresAt = at.toISOString();
    }
    try {
      const res = await create.mutateAsync({
        idempotencyKey: key.current,
        body: {
          guestId: guest.id, source, status, tentativeExpiresAt, depositRequired: deposit, discount,
          groupName: v.group.trim() || null, specialRequests: v.requests.trim() || null, internalNotes: v.notes.trim() || null,
          rooms: lines.map((l) => ({ categoryId: l.categoryId, roomId: l.roomId ?? null, checkIn: l.checkIn, checkOut: l.checkOut, adults: l.adults, children: l.children })),
        },
      });
      draft.clear();
      toast.success(`Réservation ${res.reference} créée.`);
      navigate(`/reservations/${res.id}`, { replace: true });
    } catch (e) {
      setError(isApiError(e) ? e.message : "L'enregistrement a échoué. Réessayez.");
    }
  };

  return (
    <>
      <PageHeader
        title="Nouvelle réservation"
        description="Cherchez les chambres libres, ajoutez-en une ou plusieurs, puis indiquez le client. Le prix de chaque nuit est figé à l'enregistrement."
        actions={<Link to="/reservations" className="inline-flex min-h-10 items-center gap-2 text-[14px] font-medium text-accent-ink hover:underline"><ArrowLeft aria-hidden className="size-4" />Retour aux réservations</Link>}
      />

      {draft.restored && (
        <Callout tone="info">
          Votre saisie précédente a été retrouvée sur cet appareil.{' '}
          <button type="button" className="font-medium underline underline-offset-4" onClick={() => { draft.clear(); setLines([]); setGuest(null); setStatus('confirmed'); setSource('direct'); setV({ deposit: '', discount: '', group: '', requests: '', notes: '' }); }}>Tout effacer et recommencer</button>
        </Callout>
      )}

      <Panel title="1. Dates et chambres" description="Chaque chambre ajoutée garde ses dates : vous pouvez réserver plusieurs chambres, y compris sur des dates différentes.">
        <StayFinder currency={currency} onPick={(l) => setLines((s) => [...s, { ...l, key: crypto.randomUUID() }])} />
        {lines.length > 0 && (
          <div className="flex flex-col gap-3">
            <h3 className="text-[15px] font-semibold text-ink">Chambres choisies</h3>
            <ul className="flex flex-col gap-2" aria-label="Chambres choisies">
              {lines.map((l) => {
                const n = nightsBetween(l.checkIn, l.checkOut);
                return (
                  <li key={l.key} className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] bg-silver-soft px-4 py-3">
                    <span className="flex min-w-0 flex-col">
                      <span className="text-[14px] font-medium text-ink">{l.categoryName} · {l.roomNumber ? `chambre ${l.roomNumber}` : 'attribution automatique'}</span>
                      <span className="text-[13px] text-ink-2">{formatDay(l.checkIn)} → {formatDay(l.checkOut)} · {n} {plural(n, 'nuit', 'nuits')} · {l.adults} {plural(l.adults, 'adulte', 'adultes')}{l.children > 0 ? `, ${l.children} ${plural(l.children, 'enfant', 'enfants')}` : ''}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="num-col text-[14px] font-medium text-ink">{formatMoney(l.subtotal, currency)}</span>
                      <Button size="sm" variant="ghost" onClick={() => setLines((s) => s.filter((x) => x.key !== l.key))} aria-label={`Retirer ${l.categoryName}${l.roomNumber ? ` chambre ${l.roomNumber}` : ''}`}><Trash2 aria-hidden className="size-4" /></Button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Panel>

      <Panel title="2. Client">
        <div className="grid items-start gap-4 md:grid-cols-[1fr_auto]">
          <GuestPicker value={guest} onChange={setGuest} label="Client" />
          <div className="md:pt-[1.625rem]"><Button variant="secondary" onClick={() => setCreatingGuest(true)}><UserPlus aria-hidden className="size-4" />Nouveau client</Button></div>
        </div>
      </Panel>

      <Panel title="3. Détails">
        <div className="flex flex-col gap-2">
          <SegmentedControl label="État de la réservation" value={status} onValueChange={setStatus} options={[{ value: 'confirmed', label: 'Confirmée' }, { value: 'pending', label: 'En attente' }, { value: 'tentative', label: 'Option' }]} className="self-start" />
          <p className="text-[13px] text-ink-2">{STATUS_HELP[status]}</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          {status === 'tentative' && <Field label="Échéance de l'option" required hint="Heure de votre appareil.">{(c) => <Input {...c} type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} />}</Field>}
          <Field label="Origine">{(c) => <Select {...c} value={source} onValueChange={setSource} options={SOURCE_OPTIONS} />}</Field>
          <Field label="Acompte demandé" hint="Facultatif. Le suivi des paiements se fait depuis la note du client.">{(c) => <Input {...c} inputMode="decimal" value={v.deposit} onChange={set('deposit')} autoComplete="off" />}</Field>
          <Field label="Remise" hint="Sur le prix des nuits ; répartie sur le séjour.">{(c) => <Input {...c} inputMode="decimal" value={v.discount} onChange={set('discount')} autoComplete="off" />}</Field>
          <Field label="Groupe (facultatif)" hint="Mariage, séminaire, famille…">{(c) => <Input {...c} value={v.group} onChange={set('group')} maxLength={120} />}</Field>
        </div>
        <Field label="Demandes particulières" hint="Visibles de toute l'équipe (lit bébé, arrivée tardive…).">{(c) => <Textarea {...c} value={v.requests} onChange={set('requests')} maxLength={2000} />}</Field>
        <Field label="Notes internes" hint="Jamais montrées au client.">{(c) => <Textarea {...c} value={v.notes} onChange={set('notes')} maxLength={2000} />}</Field>
      </Panel>

      <Panel>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-[13px] text-ink-2">Prix des nuits ({lines.length} {plural(lines.length, 'chambre', 'chambres')})</span>
            <span className="num-display text-[26px] font-semibold text-ink">{formatMoney(Math.max(subtotal - (discount ?? 0), 0), currency)}</span>
            <span className="text-[13px] text-ink-2">Les taxes éventuelles sont ajoutées à l'enregistrement, selon la configuration de l'établissement.</span>
          </div>
          <Button variant="primary" size="lg" loading={create.isPending} onClick={() => void submit()}>Enregistrer la réservation</Button>
        </div>
        {error && <Callout tone="danger">{error}</Callout>}
      </Panel>
      {creatingGuest && <GuestModal guest={null} onClose={() => setCreatingGuest(false)} onSaved={(id, name) => id && setGuest({ id, name })} />}
    </>
  );
}
