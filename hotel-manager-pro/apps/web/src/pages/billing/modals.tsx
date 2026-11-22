import { formatMoney } from '@hmp/shared';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  useAddCharge, useCreditNote, useExchangeRates, useIssueInvoice, usePaymentMethods, useRecordPayment, useRefund, useTaxRules, useVoidCharge, useVoidInvoice,
  type Charge, type FolioDetail, type FolioInvoice, type Payment,
} from '../../api/billing';
import { CURRENCY_OPTIONS } from '../../lib/billing-labels';
import { moneyInputValue, parseMoneyInput } from '../../lib/money-input';
import { ActionModal } from '../../ui/action-modal';
import { Field, Input, Select, Textarea } from '../../ui/form';
import { Callout } from '../../ui/page';

/* ------------------------------------------------------------------ Encaisser */
export function PaymentModal({ folio, onClose }: { folio: FolioDetail; onClose: () => void }) {
  const methods = usePaymentMethods();
  const rates = useExchangeRates();
  const record = useRecordPayment();
  const key = useRef(crypto.randomUUID());
  const active = (methods.data ?? []).filter((m) => m.isActive);
  const [methodCode, setMethodCode] = useState('');
  const [currency, setCurrency] = useState(folio.currency);
  const [amount, setAmount] = useState(moneyInputValue(Math.max(folio.balanceDue, 0), folio.currency));
  const [rate, setRate] = useState('');
  const [reference, setReference] = useState('');
  const [kind, setKind] = useState<'payment' | 'deposit'>('payment');
  const method = active.find((m) => m.code === (methodCode || active[0]?.code));
  const foreign = currency !== folio.currency;
  const stored = rates.data?.find((r) => r.baseCurrency === currency)?.rate;
  const rateValue = rate.trim() ? Number(rate.replace(',', '.')) : stored;
  const minor = parseMoneyInput(amount, currency);
  const preview = foreign && minor && rateValue ? Math.round((minor / 10 ** (currency === 'MGA' ? 0 : 2)) * rateValue * 10 ** (folio.currency === 'MGA' ? 0 : 2)) : null;

  return (
    <ActionModal
      title="Enregistrer un encaissement"
      description="Saisissez ce que vous avez réellement reçu. Rien n'est prélevé automatiquement : pour Mobile Money, carte ou virement, notez la référence de la transaction."
      confirmLabel="Enregistrer l'encaissement"
      width="38rem"
      onClose={onClose}
      onSubmit={() => {
        if (!method) return "Aucun moyen d'encaissement actif.";
        if (minor === null || minor < 1) return 'Montant invalide.';
        if (method.kind !== 'cash' && !reference.trim()) return 'Indiquez la référence de la transaction.';
        if (foreign && !rateValue) return 'Indiquez le taux de change (aucun taux enregistré).';
        if (foreign && (!Number.isFinite(rateValue!) || rateValue! <= 0)) return 'Taux de change invalide.';
        return record
          .mutateAsync({ folioId: folio.id, idempotencyKey: key.current, body: { kind, methodCode: method.code, amount: minor, currency, exchangeRate: foreign && rate.trim() ? rateValue : undefined, reference: reference.trim() || null } })
          .then((r) => void toast.success(`Encaissement enregistré — reste ${formatMoney(Math.max(r.balanceDue, 0), folio.currency)}.`));
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Moyen d'encaissement" required>{(c) => <Select {...c} value={method?.code ?? ''} onValueChange={setMethodCode} options={active.map((m) => ({ value: m.code, label: m.label }))} />}</Field>
        <Field label="Nature">{(c) => <Select {...c} value={kind} onValueChange={(v) => setKind(v as 'payment' | 'deposit')} options={[{ value: 'payment', label: 'Paiement' }, { value: 'deposit', label: 'Acompte' }]} />}</Field>
        <Field label="Devise reçue">{(c) => <Select {...c} value={currency} onValueChange={(v) => { setCurrency(v); setAmount(''); }} options={CURRENCY_OPTIONS} />}</Field>
        <Field label="Montant reçu" required hint={foreign ? undefined : `Reste à payer : ${formatMoney(Math.max(folio.balanceDue, 0), folio.currency)}`}>{(c) => <Input {...c} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoComplete="off" autoFocus />}</Field>
        {foreign && (
          <Field label={`Taux : 1 ${currency} = … ${folio.currency}`} required={!stored} hint={stored ? `Dernier taux enregistré : ${stored}. Laissez vide pour l'utiliser.` : "Aucun taux enregistré : saisissez celui du jour."}>
            {(c) => <Input {...c} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} autoComplete="off" />}
          </Field>
        )}
        {method && method.kind !== 'cash' && <Field label="Référence de la transaction" required>{(c) => <Input {...c} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} autoComplete="off" />}</Field>}
      </div>
      {preview !== null && <Callout tone="info">Contre-valeur portée sur la note : {formatMoney(preview, folio.currency)}.</Callout>}
    </ActionModal>
  );
}

/* ------------------------------------------------------------------ Charge */
export function ChargeModal({ folio, onClose }: { folio: FolioDetail; onClose: () => void }) {
  const add = useAddCharge();
  const taxes = useTaxRules();
  const [kind, setKind] = useState('service');
  const [v, setV] = useState({ description: '', quantity: '1', unit: '' });
  const [taxRuleId, setTaxRuleId] = useState('none');
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const usable = (taxes.data ?? []).filter((t) => t.isActive && t.kind === 'percentage');
  return (
    <ActionModal
      title="Ajouter une charge"
      description="Un service, des frais, une remise ou un ajustement. La charge d'hébergement, elle, suit la réservation."
      confirmLabel="Ajouter à la note"
      onClose={onClose}
      onSubmit={() => {
        if (v.description.trim().length < 2) return 'Décrivez la charge.';
        const unit = parseMoneyInput(v.unit.replace(/^-/, ''), folio.currency);
        if (unit === null) return 'Montant invalide.';
        const quantity = Number(v.quantity.replace(',', '.'));
        if (!Number.isFinite(quantity) || quantity <= 0) return 'Quantité invalide.';
        const sign = kind === 'adjustment' && v.unit.trim().startsWith('-') ? -1 : 1;
        return add.mutateAsync({ folioId: folio.id, body: { kind, description: v.description.trim(), quantity, unitAmount: sign * unit, taxRuleId: taxRuleId === 'none' || kind === 'discount' ? null : taxRuleId } }).then(() => void toast.success('Charge ajoutée.'));
      }}
    >
      <Field label="Nature" required>{(c) => <Select {...c} value={kind} onValueChange={setKind} options={[{ value: 'service', label: 'Service (blanchisserie, navette…)' }, { value: 'fee', label: 'Frais' }, { value: 'discount', label: 'Remise' }, { value: 'adjustment', label: 'Ajustement (peut être négatif)' }]} />}</Field>
      <Field label="Description" required>{(c) => <Input {...c} value={v.description} onChange={set('description')} maxLength={200} autoFocus />}</Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Quantité">{(c) => <Input {...c} inputMode="decimal" value={v.quantity} onChange={set('quantity')} />}</Field>
        <Field label={`Prix unitaire (${folio.currency})`} required>{(c) => <Input {...c} inputMode="decimal" value={v.unit} onChange={set('unit')} autoComplete="off" />}</Field>
      </div>
      {kind !== 'discount' && usable.length > 0 && <Field label="Taxe">{(c) => <Select {...c} value={taxRuleId} onValueChange={setTaxRuleId} options={[{ value: 'none', label: 'Sans taxe' }, ...usable.map((t) => ({ value: t.id, label: `${t.name} (${((t.rateBps ?? 0) / 100).toLocaleString('fr-FR')} %${t.isInclusive ? ', incluse' : ''})` }))]} />}</Field>}
    </ActionModal>
  );
}

export function VoidChargeModal({ folioId, charge, onClose }: { folioId: string; charge: Charge; onClose: () => void }) {
  const voidIt = useVoidCharge();
  const [reason, setReason] = useState('');
  return (
    <ActionModal title="Annuler cette charge" description={`« ${charge.description} » ne sera plus comptée sur la note. L'annulation est tracée.`} confirmLabel="Annuler la charge" onClose={onClose}
      onSubmit={() => (reason.trim().length < 3 ? 'Indiquez le motif (3 caractères au moins).' : voidIt.mutateAsync({ folioId, chargeId: charge.id, reason: reason.trim() }).then(() => void toast.success('Charge annulée.')))}>
      <Field label="Motif" required>{(c) => <Textarea {...c} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}</Field>
    </ActionModal>
  );
}

/* ------------------------------------------------------------------ Remboursement */
export function RefundModal({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const refund = useRefund();
  const remaining = payment.amount - payment.refundedAmount;
  const [amount, setAmount] = useState(moneyInputValue(remaining, payment.currency));
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  return (
    <ActionModal
      title="Rembourser un paiement"
      description={`Paiement de ${formatMoney(payment.amount, payment.currency)} (${payment.methodLabel ?? payment.methodCode}). Un paiement ne se modifie ni ne se supprime : une erreur se corrige par un remboursement.`}
      confirmLabel="Enregistrer le remboursement"
      onClose={onClose}
      onSubmit={() => {
        const minor = parseMoneyInput(amount, payment.currency);
        if (minor === null || minor < 1) return 'Montant invalide.';
        if (minor > remaining) return `Au plus ${formatMoney(remaining, payment.currency)} peuvent encore être remboursés.`;
        if (reason.trim().length < 3) return 'Indiquez le motif (3 caractères au moins).';
        return refund.mutateAsync({ paymentId: payment.id, body: { amount: minor, reason: reason.trim(), reference: reference.trim() || null } }).then(() => void toast.success('Remboursement enregistré.'));
      }}
    >
      <Field label={`Montant à rembourser (${payment.currency})`} required hint={`Reste remboursable : ${formatMoney(remaining, payment.currency)}`}>{(c) => <Input {...c} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />}</Field>
      <Field label="Motif" required>{(c) => <Textarea {...c} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}</Field>
      <Field label="Référence (facultatif)" hint="Numéro de transfert ou de reçu du remboursement.">{(c) => <Input {...c} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />}</Field>
    </ActionModal>
  );
}

/* ------------------------------------------------------------------ Facturer */
export function InvoiceModal({ folio, uninvoiced, onClose }: { folio: FolioDetail; uninvoiced: number; onClose: () => void }) {
  const issue = useIssueInvoice();
  const [dueDays, setDueDays] = useState('0');
  return (
    <ActionModal
      title="Émettre la facture"
      description={`Toutes les charges non facturées (${formatMoney(uninvoiced, folio.currency)}) seront reprises. Une facture émise ne peut plus être modifiée : on la corrige par un avoir.`}
      confirmLabel="Émettre la facture"
      onClose={onClose}
      onSubmit={() => {
        const days = Number(dueDays);
        if (!Number.isInteger(days) || days < 0 || days > 120) return "Le délai de paiement est un nombre de jours (0 à 120).";
        return issue.mutateAsync({ folioId: folio.id, body: { dueDays: days } }).then((r) => void toast.success(`Facture ${r.number} émise.`));
      }}
    >
      <Field label="Délai de paiement (jours)" hint="0 : payable immédiatement.">{(c) => <Input {...c} inputMode="numeric" value={dueDays} onChange={(e) => setDueDays(e.target.value)} />}</Field>
    </ActionModal>
  );
}

export function CreditNoteModal({ invoice, currency, onClose }: { invoice: FolioInvoice; currency: string; onClose: () => void }) {
  const credit = useCreditNote();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  return (
    <ActionModal
      title={`Avoir sur la facture ${invoice.number}`}
      description="L'avoir réduit ce que le client doit. Laissez le montant vide pour annuler toute la facture ; le plafond est le montant non encore crédité."
      confirmLabel="Émettre l'avoir"
      onClose={onClose}
      onSubmit={() => {
        if (reason.trim().length < 3) return 'Indiquez le motif (3 caractères au moins).';
        const minor = amount.trim() ? parseMoneyInput(amount, currency) : undefined;
        if (minor === null) return 'Montant invalide.';
        return credit.mutateAsync({ id: invoice.id, body: { reason: reason.trim(), amount: minor } }).then((r) => void toast.success(`Avoir ${r.number} émis.`));
      }}
    >
      <Field label={`Montant TTC de l'avoir (${currency})`} hint={`Facture : ${formatMoney(invoice.total, currency)}. Vide = avoir total.`}>{(c) => <Input {...c} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoComplete="off" />}</Field>
      <Field label="Motif" required>{(c) => <Textarea {...c} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}</Field>
    </ActionModal>
  );
}

export function VoidInvoiceModal({ invoice, onClose }: { invoice: FolioInvoice; onClose: () => void }) {
  const voidIt = useVoidInvoice();
  const [reason, setReason] = useState('');
  return (
    <ActionModal title={`Annuler la facture ${invoice.number}`} description="La facture reste dans vos archives, marquée annulée (son numéro n'est jamais réutilisé). Ses charges redeviennent facturables." confirmLabel="Annuler la facture" onClose={onClose}
      onSubmit={() => (reason.trim().length < 3 ? 'Indiquez le motif (3 caractères au moins).' : voidIt.mutateAsync({ id: invoice.id, reason: reason.trim() }).then(() => void toast.success('Facture annulée.')))}>
      <Field label="Motif" required>{(c) => <Textarea {...c} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}</Field>
    </ActionModal>
  );
}
