import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { isApiError } from '../../api/client';
import { useAddDocument, useAddNote, useAnonymizeGuest, useMergeGuest, useSaveGuest, type DuplicateCandidate, type GuestFull } from '../../api/guests';
import { ActionModal, KEEP_OPEN } from '../../ui/action-modal';
import { Button } from '../../ui/button';
import { Field, Input, Select, Switch, Textarea } from '../../ui/form';
import { ConfirmDialog, Modal } from '../../ui/overlay';
import { Callout } from '../../ui/page';
import { GuestPicker } from './guest-picker';

const COUNTRIES = [
  { value: 'none', label: '—' }, { value: 'MG', label: 'Madagascar' }, { value: 'FR', label: 'France' }, { value: 'RE', label: 'La Réunion' }, { value: 'YT', label: 'Mayotte' },
  { value: 'MU', label: 'Maurice' }, { value: 'KM', label: 'Comores' }, { value: 'SC', label: 'Seychelles' }, { value: 'DE', label: 'Allemagne' }, { value: 'IT', label: 'Italie' },
  { value: 'CH', label: 'Suisse' }, { value: 'BE', label: 'Belgique' }, { value: 'GB', label: 'Royaume-Uni' }, { value: 'US', label: 'États-Unis' }, { value: 'CN', label: 'Chine' },
  { value: 'IN', label: 'Inde' }, { value: 'ZA', label: 'Afrique du Sud' },
];

const orNull = (s: string) => (s.trim() === '' ? null : s.trim());

/* ------------------------------------------------------------------ Fiche client (création / modification, avec doublons) */
export function GuestModal({ guest, onClose, onSaved }: { guest: GuestFull | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const save = useSaveGuest();
  const [v, setV] = useState({
    firstName: guest?.firstName ?? '', lastName: guest?.lastName ?? '', email: guest?.email ?? '', phone: guest?.phone ?? '', birthDate: guest?.birthDate ?? '',
    address: guest?.address ?? '', city: guest?.city ?? '', tags: (guest?.tags ?? []).join(', '),
    prefs: Object.entries(guest?.preferences ?? {}).map(([k, val]) => `${k} : ${val}`).join('\n'),
  });
  const [country, setCountry] = useState(guest?.country ?? 'none');
  const [nationality, setNationality] = useState(guest?.nationality ?? 'none');
  const [vip, setVip] = useState(guest?.isVip ?? false);
  const [consent, setConsent] = useState(guest?.marketingConsent ?? false);
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[] | null>(null);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  const body = (confirmDuplicate?: boolean) => {
    const preferences: Record<string, string> = {};
    for (const line of v.prefs.split('\n')) {
      const i = line.indexOf(':');
      if (i > 0 && line.slice(i + 1).trim()) preferences[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    return {
      firstName: v.firstName.trim(), lastName: v.lastName.trim(), email: orNull(v.email), phone: orNull(v.phone), birthDate: orNull(v.birthDate), address: orNull(v.address), city: orNull(v.city),
      country: country === 'none' ? null : country, nationality: nationality === 'none' ? null : nationality, isVip: vip, marketingConsent: consent,
      tags: v.tags.split(',').map((t) => t.trim()).filter(Boolean), preferences, ...(confirmDuplicate ? { confirmDuplicate: true } : {}),
    };
  };
  const run = async (confirmDuplicate?: boolean) => {
    const b = body(confirmDuplicate);
    try {
      const r = await save.mutateAsync({ id: guest?.id, body: guest ? { ...b, version: guest.version } : b });
      toast.success(guest ? 'Fiche modifiée.' : 'Client créé.');
      onSaved?.(guest?.id ?? r.id ?? '');
      return undefined;
    } catch (e) {
      if (isApiError(e) && e.code === 'possible_duplicate') {
        setDuplicates(e.details as unknown as DuplicateCandidate[]);
        throw new Error('__duplicate__');
      }
      throw e;
    }
  };

  if (duplicates) {
    return (
      <Modal
        open
        onOpenChange={(o) => !o && onClose()}
        title="Ce client existe peut-être déjà"
        description="Vérifiez avant de créer un doublon : un seul fichier par personne garde l'historique complet."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDuplicates(null)}>Revenir à la saisie</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => void run(true).then(onClose).catch(() => undefined)}>Créer quand même</Button>
          </>
        }
      >
        <ul className="flex flex-col gap-2">
          {duplicates.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 rounded-[14px] border border-hairline bg-[var(--glass-data)] p-3.5">
              <span className="flex flex-col">
                <span className="text-[14px] font-medium text-ink">{d.firstName} {d.lastName}</span>
                <span className="text-[13px] text-ink-2">{[d.email, d.phone].filter(Boolean).join(' · ') || '—'} — {d.reason === 'email' ? 'même e-mail' : d.reason === 'phone' ? 'même téléphone' : 'même nom'}</span>
              </span>
              <Link to={`/guests/${d.id}`} onClick={onClose} className="text-[14px] font-medium text-accent-ink underline underline-offset-4">Ouvrir la fiche</Link>
            </li>
          ))}
        </ul>
      </Modal>
    );
  }

  return (
    <ActionModal
      title={guest ? `Modifier ${guest.firstName} ${guest.lastName}` : 'Nouveau client'}
      confirmLabel="Enregistrer"
      width="42rem"
      onClose={onClose}
      onSubmit={() => {
        if (!v.firstName.trim() || !v.lastName.trim()) return 'Le prénom et le nom sont obligatoires.';
        if (v.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email.trim())) return 'Adresse e-mail invalide.';
        return run().catch((e) => {
          if (e instanceof Error && e.message === '__duplicate__') return KEEP_OPEN;
          throw e;
        });
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Prénom" required>{(c) => <Input {...c} value={v.firstName} onChange={set('firstName')} maxLength={80} autoComplete="off" />}</Field>
        <Field label="Nom" required>{(c) => <Input {...c} value={v.lastName} onChange={set('lastName')} maxLength={80} autoComplete="off" />}</Field>
        <Field label="E-mail">{(c) => <Input {...c} type="email" inputMode="email" value={v.email} onChange={set('email')} autoComplete="off" />}</Field>
        <Field label="Téléphone" hint="Avec ou sans indicatif.">{(c) => <Input {...c} type="tel" inputMode="tel" value={v.phone} onChange={set('phone')} autoComplete="off" />}</Field>
        <Field label="Date de naissance">{(c) => <Input {...c} type="date" value={v.birthDate} onChange={set('birthDate')} />}</Field>
        <Field label="Ville">{(c) => <Input {...c} value={v.city} onChange={set('city')} />}</Field>
        <Field label="Pays">{(c) => <Select {...c} value={country} onValueChange={setCountry} options={COUNTRIES} />}</Field>
        <Field label="Nationalité">{(c) => <Select {...c} value={nationality} onValueChange={setNationality} options={COUNTRIES} />}</Field>
      </div>
      <Field label="Adresse">{(c) => <Input {...c} value={v.address} onChange={set('address')} />}</Field>
      <Field label="Étiquettes" hint="Séparées par des virgules : famille, agence, habitué…">{(c) => <Input {...c} value={v.tags} onChange={set('tags')} />}</Field>
      <Field label="Préférences" hint="Une par ligne, sous la forme « sujet : préférence » (ex. oreiller : ferme).">{(c) => <Textarea {...c} value={v.prefs} onChange={set('prefs')} rows={3} />}</Field>
      <Switch label="Client VIP" checked={vip} onCheckedChange={setVip} />
      <Switch label="Accepte de recevoir des communications" description="À ne cocher que si le client y a consenti." checked={consent} onCheckedChange={setConsent} />
    </ActionModal>
  );
}

/* ------------------------------------------------------------------ Note, pièce, fusion, anonymisation */
export function NoteModal({ guestId, onClose }: { guestId: string; onClose: () => void }) {
  const add = useAddNote();
  const [body, setBody] = useState('');
  return (
    <ActionModal title="Ajouter une note" description="Une note ne peut plus être modifiée ni supprimée : elle fait partie de l'historique du client." confirmLabel="Ajouter la note" onClose={onClose}
      onSubmit={() => (body.trim() ? add.mutateAsync({ id: guestId, body: body.trim() }).then(() => void toast.success('Note ajoutée.')) : 'Écrivez la note.')}>
      <Field label="Note" required>{(c) => <Textarea {...c} value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={2000} />}</Field>
    </ActionModal>
  );
}

const DOC_TYPES = [{ value: 'national_id', label: "Carte d'identité (CIN)" }, { value: 'passport', label: 'Passeport' }, { value: 'driver_license', label: 'Permis de conduire' }, { value: 'residence_permit', label: 'Titre de séjour' }, { value: 'other', label: 'Autre' }];
export const DOC_LABEL = Object.fromEntries(DOC_TYPES.map((d) => [d.value, d.label]));

export function DocumentModal({ guestId, onClose }: { guestId: string; onClose: () => void }) {
  const add = useAddDocument();
  const [docType, setDocType] = useState('national_id');
  const [number, setNumber] = useState('');
  const [issuing, setIssuing] = useState('none');
  const [expires, setExpires] = useState('');
  return (
    <ActionModal title="Ajouter une pièce d'identité" description="Le numéro est chiffré : il n'est jamais affiché en clair dans la fiche, et chaque consultation est journalisée." confirmLabel="Enregistrer la pièce" onClose={onClose}
      onSubmit={() => (number.trim().length < 3 ? 'Saisissez le numéro de la pièce.' : add.mutateAsync({ id: guestId, body: { docType, number: number.trim(), issuingCountry: issuing === 'none' ? null : issuing, expiresOn: expires || null } }).then(() => void toast.success('Pièce enregistrée.')))}>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Type">{(c) => <Select {...c} value={docType} onValueChange={setDocType} options={DOC_TYPES} />}</Field>
        <Field label="Numéro" required>{(c) => <Input {...c} value={number} onChange={(e) => setNumber(e.target.value)} autoComplete="off" maxLength={40} />}</Field>
        <Field label="Pays émetteur">{(c) => <Select {...c} value={issuing} onValueChange={setIssuing} options={COUNTRIES} />}</Field>
        <Field label="Date d'expiration">{(c) => <Input {...c} type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />}</Field>
      </div>
    </ActionModal>
  );
}

export function MergeModal({ guest, onClose, onMerged }: { guest: GuestFull; onClose: () => void; onMerged: (intoId: string) => void }) {
  const merge = useMergeGuest();
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null);
  return (
    <ActionModal title={`Fusionner ${guest.firstName} ${guest.lastName} dans une autre fiche`} description="Pour réunir deux fiches du même client. Rien n'est supprimé : l'historique, les notes et les pièces des deux fiches sont réunis dans celle que vous gardez." confirmLabel="Fusionner" onClose={onClose}
      onSubmit={() => (target ? merge.mutateAsync({ id: guest.id, intoId: target.id }).then(() => { toast.success('Fiches fusionnées.'); onMerged(target.id); }) : 'Choisissez la fiche à conserver.')}>
      <GuestPicker label="Fiche à conserver" value={target} onChange={setTarget} excludeId={guest.id} autoFocus />
      <Callout tone="warning">Cette opération ne peut pas être annulée.</Callout>
    </ActionModal>
  );
}

export function AnonymizeDialog({ guest, onClose, onDone }: { guest: GuestFull; onClose: () => void; onDone: () => void }) {
  const anon = useAnonymizeGuest();
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Anonymiser ce client ?"
      description={`Les données personnelles de ${guest.firstName} ${guest.lastName} (coordonnées, pièces, notes) sont effacées définitivement. Les séjours et les factures restent, sans nom. Impossible tant qu'un séjour est en cours ou à venir.`}
      confirmLabel="Anonymiser définitivement"
      loading={anon.isPending}
      onConfirm={() => anon.mutate(guest.id, { onSuccess: () => { toast.success('Client anonymisé.'); onDone(); }, onError: (e) => { toast.error(isApiError(e) ? e.message : "L'anonymisation a échoué."); onClose(); } })}
    />
  );
}
