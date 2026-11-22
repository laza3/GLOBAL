import { formatMoney } from '@hmp/shared';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useExchangeRates, usePaymentMethods, useSaveTaxRule, useSetRate, useTaxRules, useToggleMethod, type TaxRule } from '../../api/billing';
import { isApiError } from '../../api/client';
import { useCan } from '../../auth/session';
import { CURRENCY_OPTIONS } from '../../lib/billing-labels';
import { formatDate } from '../../lib/format';
import { moneyInputValue, parseMoneyInput } from '../../lib/money-input';
import { useCurrency } from '../../lib/use-currency';
import { useDocumentTitle } from '../../lib/use-title';
import { ActionModal } from '../../ui/action-modal';
import { Button } from '../../ui/button';
import { Badge, DataTable, EmptyState, StateBadge } from '../../ui/data';
import { Field, Input, Select, Switch } from '../../ui/form';
import { Callout, Panel } from '../../ui/page';

const APPLIES = [{ value: 'room', label: 'Hébergement' }, { value: 'service', label: 'Services' }, { value: 'restaurant', label: 'Restaurant' }, { value: 'other', label: 'Autres' }];

function TaxModal({ rule, onClose }: { rule: TaxRule | null; onClose: () => void }) {
  const currency = useCurrency();
  const save = useSaveTaxRule();
  const [name, setName] = useState(rule?.name ?? '');
  const [kind, setKind] = useState<'percentage' | 'fixed_per_person_night'>(rule?.kind ?? 'percentage');
  const [rate, setRate] = useState(rule?.rateBps != null ? String(rule.rateBps / 100).replace('.', ',') : '');
  const [fixed, setFixed] = useState(rule?.fixedAmount != null ? moneyInputValue(rule.fixedAmount, currency) : '');
  const [inclusive, setInclusive] = useState(rule?.isInclusive ?? false);
  const [applies, setApplies] = useState(rule?.appliesTo[0] ?? 'room');
  const [active, setActive] = useState(rule?.isActive ?? true);
  return (
    <ActionModal
      title={rule ? `Modifier « ${rule.name} »` : 'Nouvelle taxe'}
      description="Une taxe ne s'applique qu'aux nouvelles réservations et charges : celles qui existent déjà, et les factures émises, ne sont jamais recalculées."
      confirmLabel="Enregistrer"
      onClose={onClose}
      onSubmit={() => {
        if (name.trim().length < 2) return 'Donnez un nom à la taxe.';
        const body: Record<string, unknown> = { name: name.trim(), isInclusive: kind === 'percentage' && inclusive, appliesTo: [applies], isActive: active };
        if (kind === 'percentage') {
          const pct = Number(rate.replace(',', '.'));
          if (!Number.isFinite(pct) || pct < 0 || pct > 100) return 'Taux invalide (0 à 100 %).';
          body.rateBps = Math.round(pct * 100); body.fixedAmount = null;
        } else {
          const amount = parseMoneyInput(fixed, currency);
          if (amount === null) return 'Montant invalide.';
          body.fixedAmount = amount; body.rateBps = null;
        }
        if (!rule) { body.kind = kind; body.validFrom = null; body.validTo = null; }
        return save.mutateAsync({ id: rule?.id, body }).then(() => void toast.success('Taxe enregistrée.'));
      }}
    >
      <Field label="Nom" required>{(c) => <Input {...c} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="TVA, taxe de séjour…" />}</Field>
      {!rule && <Field label="Calcul" required>{(c) => <Select {...c} value={kind} onValueChange={(v) => setKind(v as typeof kind)} options={[{ value: 'percentage', label: 'Pourcentage du prix' }, { value: 'fixed_per_person_night', label: 'Montant fixe par adulte et par nuit (taxe de séjour)' }]} />}</Field>}
      {kind === 'percentage'
        ? <Field label="Taux (%)" required>{(c) => <Input {...c} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} autoComplete="off" />}</Field>
        : <Field label={`Montant par adulte et par nuit (${currency})`} required>{(c) => <Input {...c} inputMode="decimal" value={fixed} onChange={(e) => setFixed(e.target.value)} autoComplete="off" />}</Field>}
      <Field label="S'applique à">{(c) => <Select {...c} value={applies} onValueChange={setApplies} options={APPLIES} />}</Field>
      {kind === 'percentage' && <Switch label="Incluse dans le prix" description="Activée : vos tarifs sont TTC et la taxe en est extraite. Désactivée : elle s'ajoute au tarif." checked={inclusive} onCheckedChange={setInclusive} />}
      <Switch label="Active" checked={active} onCheckedChange={setActive} />
    </ActionModal>
  );
}

function RateModal({ onClose, currency }: { onClose: () => void; currency: string }) {
  const set = useSetRate();
  const [base, setBase] = useState(CURRENCY_OPTIONS.find((c) => c.value !== currency)?.value ?? 'EUR');
  const [rate, setRate] = useState('');
  return (
    <ActionModal title="Taux de change du jour" description="Saisi par vous, aucun service externe. Il sert à convertir les paiements reçus en devise étrangère ; chaque paiement conserve le taux utilisé." confirmLabel="Enregistrer le taux" onClose={onClose}
      onSubmit={() => {
        const value = Number(rate.replace(',', '.'));
        if (!Number.isFinite(value) || value <= 0) return 'Taux invalide.';
        return set.mutateAsync({ baseCurrency: base, rate: value }).then(() => void toast.success('Taux enregistré.'));
      }}>
      <Field label="Devise étrangère">{(c) => <Select {...c} value={base} onValueChange={setBase} options={CURRENCY_OPTIONS.filter((x) => x.value !== currency)} />}</Field>
      <Field label={`1 ${base} = … ${currency}`} required>{(c) => <Input {...c} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} autoComplete="off" autoFocus />}</Field>
    </ActionModal>
  );
}

export default function BillingSettingsPage() {
  useDocumentTitle('Taxes et paiements');
  const can = useCan();
  const currency = useCurrency();
  const taxes = useTaxRules();
  const methods = usePaymentMethods();
  const rates = useExchangeRates();
  const toggle = useToggleMethod();
  const [editing, setEditing] = useState<TaxRule | 'new' | null>(null);
  const [rating, setRating] = useState(false);
  const settings = can('settings:manage');
  return (
    <>
      <Panel
        title="Taxes"
        description="TVA, taxe de séjour… appliquées aux nouvelles réservations (jamais aux réservations et factures existantes)."
        actions={settings ? <Button variant="primary" onClick={() => setEditing('new')}><Plus aria-hidden className="size-4" />Nouvelle taxe</Button> : undefined}
      >
        <DataTable<TaxRule>
          caption="Taxes"
          loading={taxes.isPending}
          rows={taxes.data ?? []}
          rowKey={(r) => r.id}
          columns={[
            { key: 'n', header: 'Taxe', cell: (r) => <span className="font-medium text-ink">{r.name}</span> },
            { key: 'c', header: 'Calcul', cell: (r) => (r.kind === 'percentage' ? `${((r.rateBps ?? 0) / 100).toLocaleString('fr-FR')} %${r.isInclusive ? ' (incluse dans le prix)' : ' (ajoutée au prix)'}` : `${formatMoney(r.fixedAmount ?? 0, currency)} par adulte et par nuit`) },
            { key: 'a', header: 'Appliquée à', cell: (r) => r.appliesTo.map((a) => APPLIES.find((x) => x.value === a)?.label ?? a).join(', ') },
            { key: 's', header: 'État', cell: (r) => (r.isActive ? <StateBadge tone="success">Active</StateBadge> : <Badge>Désactivée</Badge>) },
            { key: 'x', header: 'Actions', cell: (r) => (settings ? <Button size="sm" variant="secondary" onClick={() => setEditing(r)} aria-label={`Modifier la taxe ${r.name}`}>Modifier</Button> : null) },
          ]}
          mobileCard={(r) => <div className="flex items-center justify-between gap-3"><span className="font-medium text-ink">{r.name}</span>{r.isActive ? <StateBadge tone="success">Active</StateBadge> : <Badge>Désactivée</Badge>}</div>}
          empty={<EmptyState kind="key" title="Aucune taxe configurée" description="Sans taxe, les prix saisis sont facturés tels quels. Ajoutez la TVA ou la taxe de séjour si elles s'appliquent à votre établissement." />}
        />
      </Panel>

      <Panel title="Moyens d'encaissement" description="Ceux proposés à la réception. Aucun n'est branché à un prestataire : vous saisissez ce que vous recevez.">
        {methods.isError ? <p className="text-[14px] text-ink-2">Impossible de charger les moyens d'encaissement.</p> : (
          <ul className="grid gap-2 sm:grid-cols-2" aria-label="Moyens d'encaissement">
            {(methods.data ?? []).map((m) => (
              <li key={m.code} className="rounded-[14px] bg-silver-soft px-4 py-3">
                <Switch label={m.label} description={m.kind === 'cash' ? 'Espèces' : m.kind === 'mobile_money' ? 'Mobile Money — référence de transaction exigée' : m.kind === 'card' ? 'Carte — référence exigée' : 'Virement — référence exigée'} checked={m.isActive} disabled={!settings || toggle.isPending}
                  onCheckedChange={(v) => toggle.mutate({ code: m.code, isActive: v }, { onError: (e) => toast.error(isApiError(e) ? e.message : 'Modification impossible.') })} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Taux de change" description={`Pour les clients qui paient en euros ou en dollars. 1 unité de la devise étrangère = … ${currency}.`} actions={can('billing:manage') ? <Button variant="secondary" onClick={() => setRating(true)}>Saisir le taux du jour</Button> : undefined}>
        {(rates.data ?? []).length === 0 ? <Callout tone="info">Aucun taux enregistré : à chaque paiement en devise étrangère, la réception saisira le taux du jour.</Callout> : (
          <ul className="flex flex-col gap-2" aria-label="Taux de change">
            {rates.data!.map((r) => <li key={r.baseCurrency} className="flex flex-wrap items-baseline justify-between gap-3 rounded-[14px] bg-silver-soft px-4 py-3"><span className="text-[14px] font-medium text-ink">1 {r.baseCurrency} = <span className="num-col">{r.rate.toLocaleString('fr-FR')}</span> {r.quoteCurrency}</span><span className="text-[13px] text-ink-2">saisi le {formatDate(r.effectiveAt, { time: true })}</span></li>)}
          </ul>
        )}
      </Panel>
      {editing && <TaxModal rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {rating && <RateModal currency={currency} onClose={() => setRating(false)} />}
    </>
  );
}
