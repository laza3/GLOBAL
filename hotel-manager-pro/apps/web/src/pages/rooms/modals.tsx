import { currencyDigits } from '@hmp/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { useBulkRooms, useCategories, useSaveCategory, useSaveRate, useSaveRoom, type Category, type RatePeriod, type Room } from '../../api/rooms';
import { moneyInputValue, parseMoneyInput } from '../../lib/money-input';
import { useCurrency } from '../../lib/use-currency';
import { ActionModal } from '../../ui/action-modal';
import { Field, Input, Select, Switch, Textarea } from '../../ui/form';

const intOr = (s: string, fallback: number | null): number | null => (s.trim() === '' ? fallback : Number(s));
const isInt = (n: number | null, min: number, max: number) => n !== null && Number.isInteger(n) && n >= min && n <= max;
const amountHint = (currency: string) => (currencyDigits(currency) === 0 ? `En ${currency}, sans décimales.` : `En ${currency}, avec les centimes (ex. 12,50).`);

/* ------------------------------------------------------------------ Catégorie */
export function CategoryModal({ category, onClose }: { category: Category | null; onClose: () => void }) {
  const currency = useCurrency();
  const save = useSaveCategory();
  const [v, setV] = useState({ code: category?.code ?? '', name: category?.name ?? '', description: category?.description ?? '', rate: category ? moneyInputValue(category.baseRate, currency) : '', order: String(category?.sortOrder ?? 0) });
  const [active, setActive] = useState(category?.isActive ?? true);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  return (
    <ActionModal
      title={category ? `Modifier « ${category.name} »` : 'Nouvelle catégorie'}
      description="Une catégorie regroupe des chambres semblables (Standard, Deluxe, Suite…) et porte leur tarif de base."
      confirmLabel="Enregistrer"
      onClose={onClose}
      onSubmit={() => {
        if (!/^[A-Za-z0-9_-]{1,20}$/.test(v.code)) return 'Le code est obligatoire : 1 à 20 caractères (lettres, chiffres, - ou _), ex. STD.';
        if (v.name.trim().length < 2) return 'Donnez un nom à la catégorie.';
        const baseRate = parseMoneyInput(v.rate, currency);
        if (baseRate === null) return `Tarif de base invalide. ${amountHint(currency)}`;
        const order = intOr(v.order, 0);
        if (!isInt(order, 0, 1000)) return "L'ordre d'affichage est un nombre entier (0 à 1000).";
        return save.mutateAsync({ id: category?.id, body: { code: v.code.trim(), name: v.name.trim(), description: v.description.trim() || null, baseRate, sortOrder: order, isActive: active } }).then(() => void toast.success('Catégorie enregistrée.'));
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Code" hint="Court, ex. STD, DLX, SUITE." required>{(c) => <Input {...c} value={v.code} onChange={set('code')} maxLength={20} />}</Field>
        <Field label="Nom" required>{(c) => <Input {...c} value={v.name} onChange={set('name')} maxLength={80} />}</Field>
        <Field label="Tarif de base par nuit" hint={amountHint(currency)} required>{(c) => <Input {...c} inputMode="decimal" value={v.rate} onChange={set('rate')} autoComplete="off" />}</Field>
        <Field label="Ordre d'affichage" hint="Plus petit = affiché en premier.">{(c) => <Input {...c} inputMode="numeric" value={v.order} onChange={set('order')} />}</Field>
      </div>
      <Field label="Description">{(c) => <Textarea {...c} value={v.description} onChange={set('description')} rows={2} maxLength={500} />}</Field>
      <Switch label="Active" description="Une catégorie désactivée n'accepte plus de nouvelles chambres ni de nouvelles réservations." checked={active} onCheckedChange={setActive} />
    </ActionModal>
  );
}

/* ------------------------------------------------------------------ Chambre */
export function RoomModal({ room, defaultCategoryId, onClose }: { room: Room | null; defaultCategoryId?: string; onClose: () => void }) {
  const currency = useCurrency();
  const cats = useCategories();
  const save = useSaveRoom();
  const [v, setV] = useState({
    number: room?.number ?? '', name: room?.name ?? '', floor: room?.floor == null ? '' : String(room.floor), capacity: String(room?.capacity ?? 2), beds: String(room?.beds ?? 1),
    rate: room?.nightlyRate == null ? '' : moneyInputValue(room.nightlyRate, currency), description: room?.description ?? '', amenities: (room?.amenities ?? []).join(', '),
  });
  const [categoryId, setCategoryId] = useState(room?.categoryId ?? defaultCategoryId ?? '');
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const options = (cats.data ?? []).filter((c) => c.isActive || c.id === room?.categoryId).map((c) => ({ value: c.id, label: c.name }));

  return (
    <ActionModal
      title={room ? `Modifier la chambre ${room.number}` : 'Nouvelle chambre'}
      confirmLabel="Enregistrer"
      width="38rem"
      onClose={onClose}
      onSubmit={() => {
        if (!categoryId) return 'Choisissez une catégorie.';
        if (!v.number.trim()) return 'Le numéro est obligatoire.';
        const capacity = intOr(v.capacity, null);
        const beds = intOr(v.beds, null);
        const floor = intOr(v.floor, null);
        if (!isInt(capacity, 1, 30) || !isInt(beds, 1, 30)) return 'Capacité et nombre de lits : des entiers de 1 à 30.';
        if (floor !== null && !isInt(floor, -5, 200)) return "L'étage est un nombre entier.";
        const nightlyRate = v.rate.trim() ? parseMoneyInput(v.rate, currency) : null;
        if (v.rate.trim() && nightlyRate === null) return `Tarif invalide. ${amountHint(currency)}`;
        const amenities = v.amenities.split(',').map((a) => a.trim()).filter(Boolean);
        const body = { categoryId, number: v.number.trim(), name: v.name.trim() || null, floor, capacity, beds, nightlyRate, description: v.description.trim() || null, amenities };
        return save.mutateAsync({ id: room?.id, body: room ? { ...body, version: room.version } : body }).then(() => void toast.success(room ? 'Chambre modifiée.' : 'Chambre créée.'));
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Catégorie" required>{(c) => <Select {...c} value={categoryId} onValueChange={setCategoryId} placeholder="Choisir…" options={options} />}</Field>
        <Field label="Numéro" hint="Ex. 101, B2." required>{(c) => <Input {...c} value={v.number} onChange={set('number')} maxLength={20} />}</Field>
        <Field label="Nom (facultatif)" hint="Ex. Vue mer.">{(c) => <Input {...c} value={v.name} onChange={set('name')} maxLength={80} />}</Field>
        <Field label="Étage">{(c) => <Input {...c} inputMode="numeric" value={v.floor} onChange={set('floor')} />}</Field>
        <Field label="Capacité (personnes)" required>{(c) => <Input {...c} inputMode="numeric" value={v.capacity} onChange={set('capacity')} />}</Field>
        <Field label="Lits" required>{(c) => <Input {...c} inputMode="numeric" value={v.beds} onChange={set('beds')} />}</Field>
      </div>
      <Field label="Tarif propre à la chambre (facultatif)" hint={`Remplace TOUS les autres tarifs (catégorie et saisons). Vide = suit la catégorie. ${amountHint(currency)}`}>
        {(c) => <Input {...c} inputMode="decimal" value={v.rate} onChange={set('rate')} autoComplete="off" />}
      </Field>
      <Field label="Équipements" hint="Séparés par des virgules : wifi, climatisation, balcon…">{(c) => <Input {...c} value={v.amenities} onChange={set('amenities')} />}</Field>
      <Field label="Description">{(c) => <Textarea {...c} value={v.description} onChange={set('description')} rows={2} maxLength={1000} />}</Field>
    </ActionModal>
  );
}

/* ------------------------------------------------------------------ Création en série */
export function BulkModal({ onClose }: { onClose: () => void }) {
  const cats = useCategories();
  const bulk = useBulkRooms();
  const [categoryId, setCategoryId] = useState('');
  const [v, setV] = useState({ from: '101', to: '110', prefix: '', floor: '', capacity: '2', beds: '1' });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const from = Number(v.from);
  const to = Number(v.to);
  const preview = Number.isInteger(from) && Number.isInteger(to) && to >= from && to - from < 200 ? `${v.prefix}${from} à ${v.prefix}${to} — ${to - from + 1} chambre${to > from ? 's' : ''}` : null;
  return (
    <ActionModal
      title="Ajouter plusieurs chambres"
      description="Crée toute une plage d'un coup (ex. 101 à 110). Si un numéro existe déjà ou si la limite de votre formule est dépassée, aucune chambre n'est créée."
      confirmLabel="Créer les chambres"
      onClose={onClose}
      onSubmit={() => {
        if (!categoryId) return 'Choisissez une catégorie.';
        if (!preview) return 'Indiquez une plage valide (de … à …, 200 chambres au plus).';
        const capacity = intOr(v.capacity, 2);
        const beds = intOr(v.beds, 1);
        const floor = intOr(v.floor, null);
        if (!isInt(capacity, 1, 30) || !isInt(beds, 1, 30)) return 'Capacité et lits : des entiers de 1 à 30.';
        return bulk.mutateAsync({ categoryId, from, to, prefix: v.prefix.trim(), floor, capacity, beds }).then((r) => void toast.success(`${r.created} chambre${r.created > 1 ? 's' : ''} créée${r.created > 1 ? 's' : ''}.`));
      }}
    >
      <Field label="Catégorie" required>{(c) => <Select {...c} value={categoryId} onValueChange={setCategoryId} placeholder="Choisir…" options={(cats.data ?? []).filter((x) => x.isActive).map((x) => ({ value: x.id, label: x.name }))} />}</Field>
      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Préfixe" hint="Facultatif, ex. B">{(c) => <Input {...c} value={v.prefix} onChange={set('prefix')} maxLength={6} />}</Field>
        <Field label="De" required>{(c) => <Input {...c} inputMode="numeric" value={v.from} onChange={set('from')} />}</Field>
        <Field label="À" required>{(c) => <Input {...c} inputMode="numeric" value={v.to} onChange={set('to')} />}</Field>
        <Field label="Étage">{(c) => <Input {...c} inputMode="numeric" value={v.floor} onChange={set('floor')} />}</Field>
        <Field label="Capacité">{(c) => <Input {...c} inputMode="numeric" value={v.capacity} onChange={set('capacity')} />}</Field>
        <Field label="Lits">{(c) => <Input {...c} inputMode="numeric" value={v.beds} onChange={set('beds')} />}</Field>
      </div>
      <p className="text-[14px] text-ink-2" role="status">{preview ? `Seront créées : ${preview}.` : 'Plage à compléter.'}</p>
    </ActionModal>
  );
}

/* ------------------------------------------------------------------ Période tarifaire */
export function RateModal({ period, categories, defaultCategoryId, onClose }: { period: RatePeriod | null; categories: Category[]; defaultCategoryId?: string; onClose: () => void }) {
  const currency = useCurrency();
  const save = useSaveRate();
  const [categoryId, setCategoryId] = useState(period?.categoryId ?? defaultCategoryId ?? categories[0]?.id ?? '');
  const [v, setV] = useState({
    name: period?.name ?? '', startsOn: period?.startsOn ?? '', endsOn: period?.endsOn ?? '', rate: period ? moneyInputValue(period.nightlyRate, currency) : '',
    weekend: period?.weekendRate == null ? '' : moneyInputValue(period.weekendRate, currency), minStay: String(period?.minStay ?? 1), priority: String(period?.priority ?? 0),
  });
  const [active, setActive] = useState(period?.isActive ?? true);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  return (
    <ActionModal
      title={period ? `Modifier « ${period.name} »` : 'Nouvelle période tarifaire'}
      description="Un tarif pour une catégorie sur une période (haute saison, fêtes…). Les réservations déjà enregistrées ne sont jamais recalculées."
      confirmLabel="Enregistrer"
      width="38rem"
      onClose={onClose}
      onSubmit={() => {
        if (!period && !categoryId) return 'Choisissez une catégorie.';
        if (v.name.trim().length < 2) return 'Donnez un nom à la période (ex. Haute saison).';
        if (!v.startsOn || !v.endsOn) return 'Indiquez la première et la dernière nuit de la période.';
        if (v.endsOn < v.startsOn) return 'La dernière nuit doit être après la première.';
        const nightlyRate = parseMoneyInput(v.rate, currency);
        if (nightlyRate === null) return `Tarif invalide. ${amountHint(currency)}`;
        const weekendRate = v.weekend.trim() ? parseMoneyInput(v.weekend, currency) : null;
        if (v.weekend.trim() && weekendRate === null) return `Tarif week-end invalide. ${amountHint(currency)}`;
        const minStay = intOr(v.minStay, 1);
        const priority = intOr(v.priority, 0);
        if (!isInt(minStay, 1, 365)) return 'Le séjour minimal est un nombre de nuits (1 à 365).';
        if (!isInt(priority, -100, 100)) return 'La priorité est un entier entre -100 et 100.';
        const body = { name: v.name.trim(), startsOn: v.startsOn, endsOn: v.endsOn, nightlyRate, weekendRate, minStay, priority, isActive: active };
        return save.mutateAsync({ id: period?.id, body: period ? body : { ...body, categoryId } }).then(() => void toast.success('Période enregistrée.'));
      }}
    >
      {!period && <Field label="Catégorie" required>{(c) => <Select {...c} value={categoryId} onValueChange={setCategoryId} options={categories.map((x) => ({ value: x.id, label: x.name }))} />}</Field>}
      <Field label="Nom" required>{(c) => <Input {...c} value={v.name} onChange={set('name')} maxLength={80} />}</Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Première nuit" required>{(c) => <Input {...c} type="date" value={v.startsOn} onChange={set('startsOn')} />}</Field>
        <Field label="Dernière nuit (incluse)" required>{(c) => <Input {...c} type="date" value={v.endsOn} onChange={set('endsOn')} />}</Field>
        <Field label="Tarif par nuit" hint={amountHint(currency)} required>{(c) => <Input {...c} inputMode="decimal" value={v.rate} onChange={set('rate')} autoComplete="off" />}</Field>
        <Field label="Tarif week-end (facultatif)" hint="Nuits du vendredi et du samedi.">{(c) => <Input {...c} inputMode="decimal" value={v.weekend} onChange={set('weekend')} autoComplete="off" />}</Field>
        <Field label="Séjour minimal (nuits)">{(c) => <Input {...c} inputMode="numeric" value={v.minStay} onChange={set('minStay')} />}</Field>
        <Field label="Priorité" hint="Si deux périodes se chevauchent, la plus haute l'emporte.">{(c) => <Input {...c} inputMode="numeric" value={v.priority} onChange={set('priority')} />}</Field>
      </div>
      <Switch label="Active" checked={active} onCheckedChange={setActive} />
    </ActionModal>
  );
}
