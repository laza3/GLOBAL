import { CURRENCIES, formatMoney } from '@hmp/shared';
import { History, Pencil, Plus, Tag } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { isApiError } from '../../api/client';
import { useCreatePlan, usePlatformPlans, useSetPrice, useUpdatePlan, type PlatformPlan } from '../../api/platform';
import type { Interval } from '../../api/types';
import { formatDate } from '../../lib/format';
import { FEATURE_LABEL, INTERVAL_UNIT } from '../../lib/labels';
import { parseMoneyInput } from '../../lib/money-input';
import { useDocumentTitle } from '../../lib/use-title';
import { Button } from '../../ui/button';
import { Badge, Skeleton } from '../../ui/data';
import { Checkbox, Field, Input, Select, Switch, Textarea } from '../../ui/form';
import { Modal } from '../../ui/overlay';
import { Callout, PageHeader, Panel } from '../../ui/page';

function PlanModal({ plan, onClose }: { plan: PlatformPlan | null; onClose: () => void }) {
  const create = useCreatePlan();
  const update = useUpdatePlan();
  const [v, setV] = useState({
    code: '', name: plan?.name ?? '', description: plan?.description ?? '', tier: String(plan?.tier ?? 5), trialDays: plan?.trialDays == null ? '' : String(plan.trialDays),
    maxRooms: plan?.maxRooms == null ? '' : String(plan.maxRooms), maxUsers: plan?.maxUsers == null ? '' : String(plan.maxUsers),
  });
  const [isPublic, setIsPublic] = useState(plan?.isPublic ?? true);
  const [isActive, setIsActive] = useState(plan?.isActive ?? true);
  const [custom, setCustom] = useState(plan?.isCustomPriced ?? false);
  const [features, setFeatures] = useState<Record<string, boolean>>(plan?.features ?? { reservations: true });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  const submit = async () => {
    const optInt = (s: string) => (s.trim() === '' ? null : Number(s));
    const [trialDays, maxRooms, maxUsers, tier] = [optInt(v.trialDays), optInt(v.maxRooms), optInt(v.maxUsers), Number(v.tier)];
    if (v.name.trim().length < 2) return setError('Donnez un nom au forfait.');
    if (!plan && !/^[a-z0-9_-]{2,40}$/.test(v.code)) return setError('Le code est obligatoire : 2 à 40 caractères, minuscules, chiffres, - ou _ (il ne pourra plus changer).');
    if (!Number.isInteger(tier) || tier < 0) return setError('Le rang doit être un entier positif.');
    for (const n of [trialDays, maxRooms, maxUsers]) if (n !== null && (!Number.isInteger(n) || n < 0)) return setError('Les limites doivent être des entiers positifs (vide = illimité).');
    if ((maxRooms === 0) || (maxUsers === 0)) return setError('Une limite de 0 n\'a pas de sens : laissez vide pour « illimité ».');
    const body = { name: v.name.trim(), description: v.description.trim() || null, tier, trialDays, maxRooms, maxUsers, isPublic, isActive, isCustomPriced: custom, features };
    setError(null);
    setBusy(true);
    try {
      if (plan) await update.mutateAsync({ id: plan.id, patch: body });
      else await create.mutateAsync({ ...body, code: v.code });
      toast.success(plan ? 'Forfait modifié.' : 'Forfait créé. Définissez maintenant ses tarifs.');
      onClose();
    } catch (e) {
      setError(isApiError(e) ? e.message : "L'enregistrement a échoué.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={plan ? `Modifier ${plan.name}` : 'Créer un forfait'} width="40rem"
      description={plan ? 'Les abonnements en cours gardent leurs conditions : seuls les nouveaux abonnements voient ces changements de tarif.' : undefined}
      footer={<><Button variant="secondary" onClick={onClose}>Annuler</Button><Button variant="primary" loading={busy} onClick={() => void submit()}>Enregistrer</Button></>}>
      <div className="flex flex-col gap-5">
        <div className="grid gap-5 sm:grid-cols-2">
          {!plan && <Field label="Code" hint="Identifiant technique, définitif." required>{(c) => <Input {...c} value={v.code} onChange={set('code')} />}</Field>}
          <Field label="Nom" required>{(c) => <Input {...c} value={v.name} onChange={set('name')} />}</Field>
          <Field label="Rang d'affichage" hint="Plus petit = affiché en premier.">{(c) => <Input {...c} inputMode="numeric" value={v.tier} onChange={set('tier')} />}</Field>
          <Field label="Jours d'essai" hint="Vide = réglage général.">{(c) => <Input {...c} inputMode="numeric" value={v.trialDays} onChange={set('trialDays')} />}</Field>
          <Field label="Chambres maximum" hint="Vide = illimité.">{(c) => <Input {...c} inputMode="numeric" value={v.maxRooms} onChange={set('maxRooms')} />}</Field>
          <Field label="Utilisateurs maximum" hint="Vide = illimité.">{(c) => <Input {...c} inputMode="numeric" value={v.maxUsers} onChange={set('maxUsers')} />}</Field>
        </div>
        <Field label="Description">{(c) => <Textarea {...c} value={v.description} onChange={set('description')} rows={2} maxLength={500} />}</Field>
        <Switch label="Visible au catalogue public" checked={isPublic} onCheckedChange={setIsPublic} />
        <Switch label="Actif" description="Un forfait inactif ne peut plus être souscrit." checked={isActive} onCheckedChange={setIsActive} />
        <Switch label="Sur devis" description="Pas de tarif catalogue : le prix est fixé pour chaque abonnement." checked={custom} onCheckedChange={setCustom} />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-medium text-ink">Fonctions incluses</legend>
          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {Object.entries(FEATURE_LABEL).map(([k, label]) => <Checkbox key={k} label={label} checked={!!features[k]} onCheckedChange={(c) => setFeatures((f) => ({ ...f, [k]: c === true }))} />)}
          </div>
        </fieldset>
        {error && <Callout tone="danger">{error}</Callout>}
      </div>
    </Modal>
  );
}

function PriceModal({ plan, onClose }: { plan: PlatformPlan; onClose: () => void }) {
  const setPrice = useSetPrice();
  const [interval, setInterval] = useState<Interval>('month');
  const [currency, setCurrency] = useState('MGA');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = plan.prices.find((p) => p.isActive && p.interval === interval && p.currency === currency);
  const submit = async () => {
    const minor = parseMoneyInput(amount, currency);
    if (minor === null) return setError('Montant invalide pour cette devise.');
    setError(null);
    setBusy(true);
    try {
      await setPrice.mutateAsync({ id: plan.id, interval, currency, amount: minor });
      toast.success('Tarif enregistré. L\'ancien tarif reste dans l\'historique.');
      onClose();
    } catch (e) {
      setError(isApiError(e) ? e.message : "L'enregistrement a échoué.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Tarif de ${plan.name}`} description="Le nouveau tarif s'applique aux NOUVEAUX abonnements. Les abonnements en cours gardent leur prix."
      footer={<><Button variant="secondary" onClick={onClose}>Annuler</Button><Button variant="primary" loading={busy} onClick={() => void submit()}>Enregistrer le tarif</Button></>}>
      <div className="flex flex-col gap-5">
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Périodicité">{(c) => <Select {...c} value={interval} onValueChange={(x) => setInterval(x as Interval)} options={[{ value: 'month', label: 'Mensuelle' }, { value: 'year', label: 'Annuelle' }]} />}</Field>
          <Field label="Devise">{(c) => <Select {...c} value={currency} onValueChange={setCurrency} options={Object.keys(CURRENCIES).map((value) => ({ value, label: value }))} />}</Field>
          <Field label="Nouveau montant" required>{(c) => <Input {...c} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoComplete="off" />}</Field>
        </div>
        <p className="text-[14px] text-ink-2">Tarif actuel : {current ? formatMoney(current.amount, currency) : 'aucun'}</p>
        {error && <Callout tone="danger">{error}</Callout>}
      </div>
    </Modal>
  );
}

export default function PlansPage() {
  useDocumentTitle('Forfaits et tarifs — Console');
  const plans = usePlatformPlans();
  const [editing, setEditing] = useState<PlatformPlan | 'new' | null>(null);
  const [pricing, setPricing] = useState<PlatformPlan | null>(null);

  return (
    <>
      <PageHeader title="Forfaits et tarifs" description="Les formules proposées aux établissements. Modifier un tarif n'altère jamais les abonnements existants : l'ancien tarif est conservé dans l'historique." actions={<Button variant="primary" onClick={() => setEditing('new')}><Plus aria-hidden className="size-4" />Créer un forfait</Button>} />
      {plans.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" role="status">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-72 rounded-[22px]" />)}<span className="sr-only">Chargement</span></div>
      ) : plans.isError ? (
        <Panel><p className="text-[14px] text-ink-2">Impossible de charger les forfaits.</p></Panel>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plans.data.map((p) => {
            const active = p.prices.filter((x) => x.isActive);
            const history = p.prices.length - active.length;
            return (
              <li key={p.id} className="surface glass-1 flex flex-col gap-4 p-6 [--surface-radius:var(--r-card)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-0.5"><h2 className="text-[19px] font-semibold tracking-[-0.01em] text-ink">{p.name}</h2><span className="text-[13px] text-ink-2">code « {p.code} » · rang {p.tier}</span></div>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {!p.isActive && <Badge>Inactif</Badge>}
                    <Badge tone={p.isPublic ? 'accent' : 'neutral'}>{p.isPublic ? 'Public' : 'Privé'}</Badge>
                    {p.isCustomPriced && <Badge tone="champagne">Sur devis</Badge>}
                  </div>
                </div>
                <p className="text-[14px] text-ink-2">{p.maxRooms ?? 'Chambres illimitées'}{p.maxRooms ? ' chambres' : ''} · {p.maxUsers ?? 'utilisateurs illimités'}{p.maxUsers ? ' utilisateurs' : ''}{p.trialDays != null ? ` · essai ${p.trialDays} j` : ''}</p>
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-[13px] font-medium text-ink-2">Tarifs en vigueur</h3>
                  {active.length === 0 ? <p className="text-[14px] text-ink-2">{p.isCustomPriced ? 'Prix fixé par abonnement.' : 'Aucun tarif défini.'}</p> : (
                    <ul className="flex flex-col gap-1">{active.map((x) => <li key={x.id} className="flex items-baseline justify-between text-[14px]"><span className="text-ink-2">{INTERVAL_UNIT[x.interval] === 'mois' ? 'Mensuel' : 'Annuel'} · {x.currency}</span><span className="num-col font-medium text-ink">{formatMoney(x.amount, x.currency)}</span></li>)}</ul>
                  )}
                  {history > 0 && <p className="flex items-center gap-1.5 text-[13px] text-ink-2"><History aria-hidden className="size-3.5" />{history} ancien{history > 1 ? 's' : ''} tarif{history > 1 ? 's' : ''} conservé{history > 1 ? 's' : ''} (dernier le {formatDate(p.prices.filter((x) => !x.isActive)[0]?.validFrom)})</p>}
                </div>
                <p className="text-[13px] text-ink-2">{p.liveSubscriptions} abonnement{p.liveSubscriptions > 1 ? 's' : ''} en cours</p>
                <div className="mt-auto flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setEditing(p)}><Pencil aria-hidden className="size-4" />Modifier</Button>
                  <Button variant="secondary" size="sm" onClick={() => setPricing(p)}><Tag aria-hidden className="size-4" />Modifier un tarif</Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {editing && <PlanModal plan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {pricing && <PriceModal plan={pricing} onClose={() => setPricing(null)} />}
    </>
  );
}
