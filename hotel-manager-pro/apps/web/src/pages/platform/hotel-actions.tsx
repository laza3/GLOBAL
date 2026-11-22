import { CURRENCIES } from '@hmp/shared';
import { Copy, KeyRound } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { isApiError } from '../../api/client';
import {
  useActivateSubscription, useCancelSubscription, useCreateInvoice, useExtendTrial, useGrantTrial, useIssueLicense, usePlatformPlans, type PlatformPlan,
} from '../../api/platform';
import type { Interval } from '../../api/types';
import { INTERVAL_LABEL } from '../../lib/labels';
import { parseMoneyInput } from '../../lib/money-input';
import { Button } from '../../ui/button';
import { Field, Input, Select, Switch, Textarea } from '../../ui/form';
import { ActionModal, KEEP_OPEN } from '../../ui/action-modal';
import { Modal } from '../../ui/overlay';
import { Callout } from '../../ui/page';
import { ReasonModal } from './parts';

const CURRENCY_OPTIONS = Object.entries(CURRENCIES).map(([value, c]) => ({ value, label: `${c.name} (${c.symbol})` }));
const planOptions = (plans: PlatformPlan[] | undefined) => (plans ?? []).filter((p) => p.isActive).map((p) => ({ value: p.code, label: p.name }));

const ReasonField = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <Field label="Motif" hint="Conservé dans le journal d'audit." required>
    {(c) => <Textarea {...c} value={value} onChange={(e) => onChange(e.target.value)} rows={2} maxLength={300} />}
  </Field>
);

const needReason = (r: string) => (r.trim().length < 3 ? 'Indiquez un motif d\'au moins 3 caractères.' : null);

/* ------------------------------------------------------------------ Activer une formule à la main */
export function ActivateModal({ hotelId, onClose }: { hotelId: string; onClose: () => void }) {
  const plans = usePlatformPlans();
  const activate = useActivateSubscription();
  const [planCode, setPlanCode] = useState('');
  const [interval, setInterval] = useState<Interval>('month');
  const [currency, setCurrency] = useState('MGA');
  const [price, setPrice] = useState('');
  const [discount, setDiscount] = useState('');
  const [reason, setReason] = useState('');
  const plan = plans.data?.find((p) => p.code === planCode);

  return (
    <ActionModal
      title="Activer une formule"
      description="Remplace l'abonnement en cours. Aucune facture n'est émise : à réserver aux contrats signés, gestes commerciaux et régularisations."
      confirmLabel="Activer la formule"
      onClose={onClose}
      onSubmit={() => {
        if (!planCode) return 'Choisissez une formule.';
        const priceAmount = price.trim() ? parseMoneyInput(price, currency) : undefined;
        const discountAmount = discount.trim() ? parseMoneyInput(discount, currency) : 0;
        if (priceAmount === null || discountAmount === null) return 'Montant invalide pour cette devise.';
        if (plan?.isCustomPriced && priceAmount === undefined) return 'Cette formule est sur devis : saisissez le prix convenu.';
        return needReason(reason) ?? activate.mutateAsync({ hotelId, planCode, interval, currency, priceAmount, discountAmount, reason: reason.trim() }).then(() => void toast.success('Formule activée.'));
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Formule" required>{(c) => <Select {...c} value={planCode} onValueChange={setPlanCode} placeholder="Choisir…" options={planOptions(plans.data)} />}</Field>
        <Field label="Périodicité">{(c) => <Select {...c} value={interval} onValueChange={(v) => setInterval(v as Interval)} options={[{ value: 'month', label: 'Mensuelle' }, { value: 'year', label: 'Annuelle' }]} />}</Field>
        <Field label="Devise">{(c) => <Select {...c} value={currency} onValueChange={setCurrency} options={CURRENCY_OPTIONS} />}</Field>
        <Field label={plan?.isCustomPriced ? 'Prix convenu' : 'Prix (facultatif)'} hint={plan?.isCustomPriced ? undefined : 'Vide = tarif catalogue.'} required={!!plan?.isCustomPriced}>
          {(c) => <Input {...c} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} autoComplete="off" />}
        </Field>
        <Field label="Remise (facultatif)">{(c) => <Input {...c} inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} autoComplete="off" />}</Field>
      </div>
      <ReasonField value={reason} onChange={setReason} />
    </ActionModal>
  );
}

/* ------------------------------------------------------------------ Offrir / prolonger un essai */
export function GrantTrialModal({ hotelId, onClose }: { hotelId: string; onClose: () => void }) {
  const plans = usePlatformPlans();
  const grant = useGrantTrial();
  const [days, setDays] = useState('14');
  const [planCode, setPlanCode] = useState('business');
  const [reason, setReason] = useState('');
  return (
    <ActionModal
      title="Offrir un essai gratuit"
      description="Possible uniquement pour un établissement sans abonnement en cours."
      confirmLabel="Offrir l'essai"
      onClose={onClose}
      onSubmit={() => {
        const n = Number(days);
        if (!Number.isInteger(n) || n < 1 || n > 365) return 'Saisissez un nombre de jours entre 1 et 365.';
        return needReason(reason) ?? grant.mutateAsync({ hotelId, days: n, planCode, reason: reason.trim() }).then(() => void toast.success('Essai offert.'));
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Durée (jours)" required>{(c) => <Input {...c} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />}</Field>
        <Field label="Formule essayée">{(c) => <Select {...c} value={planCode} onValueChange={setPlanCode} options={planOptions(plans.data)} />}</Field>
      </div>
      <ReasonField value={reason} onChange={setReason} />
    </ActionModal>
  );
}

export function ExtendTrialModal({ subscriptionId, onClose }: { subscriptionId: string; onClose: () => void }) {
  const extend = useExtendTrial();
  const [days, setDays] = useState('7');
  const [reason, setReason] = useState('');
  return (
    <ActionModal
      title="Prolonger l'essai"
      confirmLabel="Prolonger"
      onClose={onClose}
      onSubmit={() => {
        const n = Number(days);
        if (!Number.isInteger(n) || n < 1 || n > 365) return 'Saisissez un nombre de jours entre 1 et 365.';
        return needReason(reason) ?? extend.mutateAsync({ subscriptionId, days: n, reason: reason.trim() }).then(() => void toast.success(`Essai prolongé de ${n} jour${n > 1 ? 's' : ''}.`));
      }}
    >
      <Field label="Jours supplémentaires" required>{(c) => <Input {...c} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />}</Field>
      <ReasonField value={reason} onChange={setReason} />
    </ActionModal>
  );
}

export function CancelSubscriptionModal({ subscriptionId, onClose }: { subscriptionId: string; onClose: () => void }) {
  const cancel = useCancelSubscription();
  const [atEnd, setAtEnd] = useState(true);
  return (
    <ReasonModal
      title="Résilier l'abonnement"
      confirmLabel={atEnd ? 'Programmer la résiliation' : 'Résilier immédiatement'}
      destructive
      extra={
        <Switch
          label="Résilier à l'échéance"
          description={atEnd ? "L'accès continue jusqu'à la fin de la période payée." : "L'accès passe tout de suite en lecture seule."}
          checked={atEnd}
          onCheckedChange={setAtEnd}
        />
      }
      onSubmit={(reason) => cancel.mutateAsync({ subscriptionId, reason, atPeriodEnd: atEnd }).then(() => void toast.success(atEnd ? 'Résiliation programmée.' : 'Abonnement résilié.'))}
      onClose={onClose}
    />
  );
}

/* ------------------------------------------------------------------ Licence : la clé n'est montrée qu'UNE fois */
export function IssueLicenseModal({ hotelId, onClose }: { hotelId: string; onClose: () => void }) {
  const plans = usePlatformPlans();
  const issue = useIssueLicense();
  const [v, setV] = useState({ edition: '', base: 'business', maxRooms: '', maxUsers: '', maintenance: '', terms: '', price: '' });
  const [currency, setCurrency] = useState('MGA');
  const [hosting, setHosting] = useState(true);
  const [invoice, setInvoice] = useState(false);
  const [issued, setIssued] = useState<{ key: string; status: string; invoice: string | null } | null>(null);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  if (issued) {
    return (
      <Modal
        open
        onOpenChange={(o) => !o && onClose()}
        title="Licence émise"
        description={issued.status === 'pending' ? `En attente du règlement de la facture ${issued.invoice}.` : 'La licence est active.'}
        footer={<Button variant="primary" onClick={onClose}>J&apos;ai conservé la clé</Button>}
      >
        <div className="flex flex-col gap-4">
          <Callout tone="warning"><strong>Copiez cette clé maintenant : elle ne sera plus jamais affichée.</strong> Seule son empreinte est conservée.</Callout>
          <div className="flex items-center gap-2 rounded-[14px] border border-hairline bg-[var(--glass-data)] p-3">
            <KeyRound aria-hidden className="size-5 shrink-0 text-champagne-ink" />
            <code className="num-col min-w-0 flex-1 text-[16px] font-medium tracking-wide break-all text-ink" data-testid="license-key">{issued.key}</code>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(issued.key).then(() => toast.success('Clé copiée.'), () => toast.error('Copie impossible : sélectionnez la clé et copiez-la.'));
              }}
            >
              <Copy aria-hidden className="size-4" />
              Copier
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <ActionModal
      title="Émettre une licence définitive"
      description="Droit d'usage perpétuel pour UN établissement, avec ses propres limites. La maintenance (mises à jour, support) est une échéance distincte."
      confirmLabel="Émettre la licence"
      width="38rem"
      onClose={onClose}
      onSubmit={() => {
        if (v.edition.trim().length < 2) return "Donnez un nom à l'édition (ex. perpetuelle-pro).";
        const optInt = (s: string) => (s.trim() === '' ? undefined : Number(s));
        const rooms = optInt(v.maxRooms);
        const users = optInt(v.maxUsers);
        for (const n of [rooms, users]) if (n !== undefined && (!Number.isInteger(n) || n < 1)) return 'Les limites doivent être des nombres entiers positifs (vide = reprendre la formule de base).';
        const price = v.price.trim() ? parseMoneyInput(v.price, currency) : undefined;
        if (price === null) return 'Prix invalide pour cette devise.';
        if (invoice && !price) return 'Pour facturer la licence, saisissez son prix.';
        const maintenanceUntil = v.maintenance ? new Date(`${v.maintenance}T23:59:59Z`).toISOString() : null;
        return issue
          .mutateAsync({ hotelId, editionCode: v.edition.trim(), basedOnPlanCode: v.base, maxRooms: rooms, maxUsers: users, maintenanceUntil, hostingIncluded: hosting, terms: v.terms.trim() || undefined, priceAmount: price, currency, invoice })
          .then((r) => { setIssued({ key: r.licenseKey, status: r.status, invoice: r.invoice?.number ?? null }); return KEEP_OPEN; });
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Édition" hint="Ex. perpetuelle-pro" required>{(c) => <Input {...c} value={v.edition} onChange={set('edition')} />}</Field>
        <Field label="Basée sur la formule" hint="Reprend ses limites et ses fonctions.">{(c) => <Select {...c} value={v.base} onValueChange={(x) => setV((s) => ({ ...s, base: x }))} options={planOptions(plans.data)} />}</Field>
        <Field label="Chambres maximum" hint="Vide = comme la formule.">{(c) => <Input {...c} inputMode="numeric" value={v.maxRooms} onChange={set('maxRooms')} />}</Field>
        <Field label="Utilisateurs maximum" hint="Vide = comme la formule.">{(c) => <Input {...c} inputMode="numeric" value={v.maxUsers} onChange={set('maxUsers')} />}</Field>
        <Field label="Maintenance jusqu'au" hint="Vide = sans date de fin.">{(c) => <Input {...c} type="date" value={v.maintenance} onChange={set('maintenance')} />}</Field>
        <Field label="Prix de la licence (facultatif)">{(c) => <Input {...c} inputMode="decimal" value={v.price} onChange={set('price')} autoComplete="off" />}</Field>
        <Field label="Devise du prix">{(c) => <Select {...c} value={currency} onValueChange={setCurrency} options={CURRENCY_OPTIONS} />}</Field>
      </div>
      <Switch label="Hébergement inclus" checked={hosting} onCheckedChange={setHosting} />
      <Switch label="Émettre une facture" description="La licence reste « en attente » jusqu'au règlement validé." checked={invoice} onCheckedChange={setInvoice} />
      <Field label="Conditions particulières (facultatif)">{(c) => <Textarea {...c} value={v.terms} onChange={set('terms')} rows={3} maxLength={4000} />}</Field>
    </ActionModal>
  );
}

/* ------------------------------------------------------------------ Facture manuelle (prestation, formation…) */
export function CreateInvoiceModal({ hotelId, hotelName, onClose, onCreated }: { hotelId: string; hotelName: string; onClose: () => void; onCreated?: (id: string) => void }) {
  const create = useCreateInvoice();
  const [currency, setCurrency] = useState('MGA');
  const [lines, setLines] = useState([{ description: '', quantity: '1', amount: '' }]);
  const [notes, setNotes] = useState('');
  const [issue, setIssue] = useState(true);
  const setLine = (i: number, k: 'description' | 'quantity' | 'amount', value: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: value } : l)));

  return (
    <ActionModal
      title="Créer une facture"
      description={`Pour ${hotelName} — prestation hors abonnement (formation, paramétrage, déplacement…).`}
      confirmLabel={issue ? 'Créer et émettre' : 'Enregistrer le brouillon'}
      width="42rem"
      onClose={onClose}
      onSubmit={() => {
        const parsed = [];
        for (const [i, l] of lines.entries()) {
          const amount = parseMoneyInput(l.amount, currency);
          const quantity = Number(l.quantity.replace(',', '.'));
          if (!l.description.trim()) return `Ligne ${i + 1} : indiquez la désignation.`;
          if (amount === null || amount <= 0) return `Ligne ${i + 1} : montant unitaire invalide.`;
          if (!Number.isFinite(quantity) || quantity <= 0) return `Ligne ${i + 1} : quantité invalide.`;
          parsed.push({ description: l.description.trim(), quantity, unitAmount: amount });
        }
        return create.mutateAsync({ hotelId, currency, lines: parsed, notes: notes.trim() || undefined, issue }).then((r) => {
          toast.success(r.number ? `Facture ${r.number} émise.` : 'Brouillon enregistré.');
          onCreated?.(r.invoiceId);
        });
      }}
    >
      <Field label="Devise">{(c) => <Select {...c} value={currency} onValueChange={setCurrency} options={CURRENCY_OPTIONS} />}</Field>
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-[13px] font-medium text-ink">Lignes de la facture</legend>
        {lines.map((l, i) => (
          <div key={i} className="grid gap-3 sm:grid-cols-[1fr_5rem_8rem_auto] sm:items-end">
            <Field label={`Désignation ${i + 1}`}>{(c) => <Input {...c} value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} maxLength={300} />}</Field>
            <Field label="Qté">{(c) => <Input {...c} inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} />}</Field>
            <Field label="Prix unitaire">{(c) => <Input {...c} inputMode="decimal" value={l.amount} onChange={(e) => setLine(i, 'amount', e.target.value)} autoComplete="off" />}</Field>
            {lines.length > 1 && <Button variant="ghost" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Supprimer la ligne ${i + 1}`}>Retirer</Button>}
          </div>
        ))}
        {lines.length < 10 && <Button variant="secondary" size="sm" className="self-start" onClick={() => setLines((ls) => [...ls, { description: '', quantity: '1', amount: '' }])}>Ajouter une ligne</Button>}
      </fieldset>
      <Field label="Notes (facultatif)">{(c) => <Textarea {...c} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} />}</Field>
      <Switch label="Émettre immédiatement" description={issue ? 'Un numéro est attribué ; la facture devient visible par l\'établissement.' : 'Brouillon : invisible de l\'établissement, modifiable avant émission.'} checked={issue} onCheckedChange={setIssue} />
    </ActionModal>
  );
}

export { INTERVAL_LABEL };
