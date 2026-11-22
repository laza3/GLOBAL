import { useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useHotel, useUpdateHotel } from '../../api/hotel';
import type { HotelProfile } from '../../api/types';
import { useCan } from '../../auth/session';
import { emailProblem, feedbackFrom, requiredProblem, type FormFeedback } from '../../lib/forms';
import { LOCALES, setLocale, t, type Locale } from '../../i18n';
import { useDocumentTitle } from '../../lib/use-title';
import { Button } from '../../ui/button';
import { Skeleton } from '../../ui/data';
import { Field, Input, Select, Textarea } from '../../ui/form';
import { Callout, Panel } from '../../ui/page';

const COUNTRIES = [
  { value: 'MG', label: 'Madagascar' },
  { value: 'FR', label: 'France' },
  { value: 'RE', label: 'La Réunion' },
  { value: 'YT', label: 'Mayotte' },
  { value: 'MU', label: 'Maurice' },
  { value: 'KM', label: 'Comores' },
  { value: 'SC', label: 'Seychelles' },
];
const TIMEZONES = [
  { value: 'Indian/Antananarivo', label: 'Madagascar (Antananarivo, UTC+3)' },
  { value: 'Indian/Mayotte', label: 'Mayotte (UTC+3)' },
  { value: 'Indian/Comoro', label: 'Comores (UTC+3)' },
  { value: 'Indian/Reunion', label: 'La Réunion (UTC+4)' },
  { value: 'Indian/Mauritius', label: 'Maurice (UTC+4)' },
  { value: 'Indian/Mahe', label: 'Seychelles (UTC+4)' },
  { value: 'Europe/Paris', label: 'France métropolitaine' },
  { value: 'UTC', label: 'Temps universel (UTC)' },
];
const CURRENCIES = [
  { value: 'MGA', label: 'Ariary (Ar)' },
  { value: 'EUR', label: 'Euro (€)' },
  { value: 'USD', label: 'Dollar américain ($)' },
];

type Form = {
  name: string; legalName: string; taxId: string; address: string; city: string; country: string; phone: string; email: string; website: string;
  locale: Locale; defaultCurrency: string; timezone: string; checkInTime: string; checkOutTime: string; invoicePrefix: string; reservationPrefix: string; invoiceHeader: string; invoiceFooter: string;
};
const PROFILE_KEYS = ['name', 'legalName', 'taxId', 'address', 'city', 'country', 'phone', 'email', 'website'] as const;
const SETTINGS_KEYS = ['locale', 'defaultCurrency', 'timezone', 'checkInTime', 'checkOutTime', 'invoicePrefix', 'reservationPrefix', 'invoiceHeader', 'invoiceFooter'] as const;
const NULLABLE = new Set(['legalName', 'taxId', 'address', 'city', 'phone', 'email', 'website', 'invoiceHeader', 'invoiceFooter']);

const toForm = (h: HotelProfile): Form => ({
  name: h.name, legalName: h.legalName ?? '', taxId: h.taxId ?? '', address: h.address ?? '', city: h.city ?? '', country: h.country, phone: h.phone ?? '',
  email: h.email ?? '', website: h.website ?? '', locale: (h.locale as Locale) ?? 'fr', defaultCurrency: h.defaultCurrency, timezone: h.timezone, checkInTime: h.checkInTime, checkOutTime: h.checkOutTime,
  invoicePrefix: h.invoicePrefix, reservationPrefix: h.reservationPrefix, invoiceHeader: h.invoiceHeader ?? '', invoiceFooter: h.invoiceFooter ?? '',
});

function validate(f: Form): Record<string, string> {
  const e: Record<string, string> = {};
  const name = requiredProblem(f.name, "Le nom de l'établissement", 2);
  if (name) e.name = name;
  if (f.email.trim()) {
    const p = emailProblem(f.email);
    if (p) e.email = p;
  }
  if (f.website.trim() && !/^https?:\/\/\S+\.\S+/.test(f.website.trim())) e.website = 'Saisissez une adresse complète, ex. https://www.monhotel.mg';
  for (const k of ['checkInTime', 'checkOutTime'] as const) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(f[k])) e[k] = 'Saisissez une heure au format 24 h, ex. 14:00.';
  }
  for (const k of ['invoicePrefix', 'reservationPrefix'] as const) {
    if (!/^[A-Z0-9-]{1,10}$/.test(f[k])) e[k] = '1 à 10 caractères : majuscules, chiffres ou tiret.';
  }
  return e;
}

export default function HotelSettingsPage() {
  useDocumentTitle('Établissement');
  const hotel = useHotel();
  if (hotel.isPending) {
    return (
      <Panel>
        <div className="flex flex-col gap-4" role="status">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-2/3" />
          <span className="sr-only">Chargement</span>
        </div>
      </Panel>
    );
  }
  if (hotel.isError) return <Panel><p className="text-[14px] text-ink-2">Impossible de charger le profil de l&apos;établissement. Rechargez la page.</p></Panel>;
  return <HotelForm hotel={hotel.data} />;
}

function HotelForm({ hotel }: { hotel: HotelProfile }) {
  const can = useCan();
  const editable = can('settings:manage');
  const update = useUpdateHotel();
  const initial = useMemo(() => toForm(hotel), [hotel]);
  const [f, setF] = useState<Form>(initial);
  const [feedback, setFeedback] = useState<FormFeedback>({ fields: {} });
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: k.endsWith('Prefix') ? e.target.value.toUpperCase() : e.target.value }));
  const dirty = (Object.keys(f) as Array<keyof Form>).some((k) => f[k] !== initial[k]);
  const currencyLocked = hotel.status !== 'onboarding';
  const err = feedback.fields;

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const problems = validate(f);
    if (Object.keys(problems).length) return setFeedback({ fields: problems });
    setFeedback({ fields: {} });
    const pick = (keys: readonly (keyof Form)[]) =>
      Object.fromEntries(
        keys.filter((k) => f[k] !== initial[k]).map((k) => [k, NULLABLE.has(k) ? (f[k].trim() === '' ? null : f[k].trim()) : f[k].trim()]),
      );
    update.mutate(
      { profile: pick(PROFILE_KEYS), settings: pick(SETTINGS_KEYS) },
      {
        onSuccess: () => { if (f.locale !== initial.locale) setLocale(f.locale); toast.success('Modifications enregistrées.'); },
        onError: (e) => setFeedback(feedbackFrom(e, { currency_locked: 'defaultCurrency' })),
      },
    );
  };

  const ro = !editable;
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {ro && <Callout>Vous pouvez consulter ces informations ; seul le propriétaire ou un gestionnaire peut les modifier.</Callout>}
      {feedback.general && <Callout tone="danger">{feedback.general}</Callout>}

      <Panel title="Identité de l'établissement" description="Ces informations figurent sur vos factures.">
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Nom commercial" error={err.name} required>{(c) => <Input {...c} value={f.name} onChange={set('name')} disabled={ro} autoComplete="organization" />}</Field>
          <Field label="Raison sociale" error={err.legalName}>{(c) => <Input {...c} value={f.legalName} onChange={set('legalName')} disabled={ro} />}</Field>
          <Field label="NIF / STAT" hint="Numéro d'identification fiscale ou statistique." error={err.taxId}>{(c) => <Input {...c} value={f.taxId} onChange={set('taxId')} disabled={ro} />}</Field>
          <Field label="Pays" error={err.country}>{(c) => <Select {...c} value={f.country} onValueChange={(v) => setF((s) => ({ ...s, country: v }))} options={COUNTRIES} disabled={ro} />}</Field>
          <Field label="Adresse" error={err.address} className="md:col-span-2">{(c) => <Input {...c} value={f.address} onChange={set('address')} disabled={ro} autoComplete="street-address" />}</Field>
          <Field label="Ville" error={err.city}>{(c) => <Input {...c} value={f.city} onChange={set('city')} disabled={ro} autoComplete="address-level2" />}</Field>
        </div>
      </Panel>

      <Panel title="Contact">
        <div className="grid gap-5 md:grid-cols-3">
          <Field label="Téléphone" error={err.phone}>{(c) => <Input {...c} type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} disabled={ro} autoComplete="tel" />}</Field>
          <Field label="E-mail de l'établissement" error={err.email}>{(c) => <Input {...c} type="email" inputMode="email" value={f.email} onChange={set('email')} disabled={ro} />}</Field>
          <Field label="Site web" error={err.website}>{(c) => <Input {...c} type="url" inputMode="url" value={f.website} onChange={set('website')} disabled={ro} placeholder="https://" />}</Field>
        </div>
      </Panel>

      <Panel title="Devise, fuseau et horaires">
        <div className="grid gap-5 md:grid-cols-2">
          <Field
            label="Devise de facturation"
            hint={currencyLocked ? 'Verrouillée : des factures en dépendent. Contactez l\'assistance en cas d\'erreur.' : 'Modifiable jusqu\'à la fin de la configuration initiale.'}
            error={err.defaultCurrency}
          >
            {(c) => <Select {...c} value={f.defaultCurrency} onValueChange={(v) => setF((s) => ({ ...s, defaultCurrency: v }))} options={CURRENCIES} disabled={ro || currencyLocked} />}
          </Field>
          <Field label="Fuseau horaire" error={err.timezone}>{(c) => <Select {...c} value={f.timezone} onValueChange={(v) => setF((s) => ({ ...s, timezone: v }))} options={TIMEZONES} disabled={ro} />}</Field>
          <Field label="Heure d'arrivée (check-in)" hint="Format 24 h, ex. 14:00." error={err.checkInTime}>{(c) => <Input {...c} inputMode="numeric" placeholder="14:00" maxLength={5} value={f.checkInTime} onChange={set('checkInTime')} disabled={ro} />}</Field>
          <Field label="Heure de départ (check-out)" hint="Format 24 h, ex. 12:00." error={err.checkOutTime}>{(c) => <Input {...c} inputMode="numeric" placeholder="12:00" maxLength={5} value={f.checkOutTime} onChange={set('checkOutTime')} disabled={ro} />}</Field>
          <Field label={t('settings.language')} hint={t('settings.language.hint')}>
            {(c) => <Select {...c} value={f.locale} onValueChange={(v) => { setF((s) => ({ ...s, locale: v as typeof s.locale })); }} options={LOCALES} disabled={ro} />}
          </Field>
        </div>
      </Panel>

      <Panel title="Numérotation et documents">
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Préfixe des factures" hint="Ex. FAC → FAC-2026-000001." error={err.invoicePrefix}>{(c) => <Input {...c} value={f.invoicePrefix} onChange={set('invoicePrefix')} disabled={ro} maxLength={10} />}</Field>
          <Field label="Préfixe des réservations" hint="Ex. RES." error={err.reservationPrefix}>{(c) => <Input {...c} value={f.reservationPrefix} onChange={set('reservationPrefix')} disabled={ro} maxLength={10} />}</Field>
          <Field label="En-tête des factures" error={err.invoiceHeader}>{(c) => <Textarea {...c} value={f.invoiceHeader} onChange={set('invoiceHeader')} disabled={ro} rows={3} maxLength={500} />}</Field>
          <Field label="Pied de page des factures" hint="Mentions légales, coordonnées bancaires…" error={err.invoiceFooter}>{(c) => <Textarea {...c} value={f.invoiceFooter} onChange={set('invoiceFooter')} disabled={ro} rows={3} maxLength={500} />}</Field>
        </div>
      </Panel>

      {editable && dirty && (
        <div className="surface glass-2 sticky bottom-24 z-10 flex flex-wrap items-center gap-3 self-start px-4 py-3 [--surface-radius:var(--r-card-sm)] lg:bottom-4" role="group" aria-label="Enregistrer les modifications">
          <span className="text-[14px] text-ink-2">Modifications non enregistrées</span>
          <Button
            variant="ghost"
            onClick={() => {
              setF(initial);
              setFeedback({ fields: {} });
            }}
          >
            Annuler
          </Button>
          <Button type="submit" variant="primary" loading={update.isPending}>
            Enregistrer
          </Button>
        </div>
      )}
    </form>
  );
}
