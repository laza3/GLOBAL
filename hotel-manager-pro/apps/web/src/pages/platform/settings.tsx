import { CURRENCIES } from '@hmp/shared';
import { CircleHelp, PlugZap } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { isApiError } from '../../api/client';
import { useConnectors, usePlatformPlans, usePlatformSettings, useUpdateConnector, useUpdateSetting, type Connector } from '../../api/platform';
import { PAYMENT_METHOD } from '../../lib/labels';
import { useDocumentTitle } from '../../lib/use-title';
import { Button } from '../../ui/button';
import { Badge, Skeleton, StateBadge } from '../../ui/data';
import { Field, Input, Select, Switch, Textarea } from '../../ui/form';
import { Tabs } from '../../ui/tabs';
import { Callout, PageHeader, Panel } from '../../ui/page';
import { usePlatformMeQuery, useTotpDisable, useTotpEnable, useTotpSetup } from '../../api/platform';
import { PasswordInput } from '../../ui/form';

type Kind = 'bool' | 'int' | 'percent' | 'plan' | 'currency' | 'json';
const SETTINGS: Record<string, { label: string; hint?: string; kind: Kind }> = {
  'trial.enabled': { label: "Essai gratuit à l'inscription", hint: 'Désactivé : les nouveaux établissements doivent choisir une formule payante.', kind: 'bool' },
  'trial.default_days': { label: "Durée de l'essai (jours)", hint: "Un forfait peut avoir sa propre durée (page « Forfaits »).", kind: 'int' },
  'trial.default_plan_code': { label: 'Formule offerte pendant l\'essai', kind: 'plan' },
  'billing.grace_days': { label: 'Tolérance après échéance (jours)', hint: "L'accès reste complet pendant ce délai pour un abonnement payant échu.", kind: 'int' },
  'billing.invoice_due_days': { label: 'Délai de paiement des factures (jours)', kind: 'int' },
  'billing.renewal_invoice_days': { label: 'Facture de renouvellement émise N jours avant l\'échéance', kind: 'int' },
  'billing.tax_rate_bps': { label: 'Taxe sur les factures (%)', hint: 'À valider avec un comptable. 0 = aucune taxe.', kind: 'percent' },
  'billing.default_currency': { label: 'Devise par défaut des factures', kind: 'currency' },
  'billing.auto_approve_plan_changes': { label: 'Approuver automatiquement les changements de formule au tarif catalogue', kind: 'bool' },
  'auth.max_failed_attempts': { label: 'Échecs de connexion avant verrouillage', kind: 'int' },
  'auth.lock_minutes': { label: 'Durée du verrouillage (minutes)', kind: 'int' },
  'company.profile': { label: 'Coordonnées de la société (JSON)', hint: 'Ex. {"name": "…", "address": "…"} — reprises sur les factures.', kind: 'json' },
};

function SettingRow({ k, value }: { k: string; value: unknown }) {
  const def = SETTINGS[k]!;
  const plans = usePlatformPlans();
  const update = useUpdateSetting();
  const initial = def.kind === 'percent' ? String(Number(value) / 100) : def.kind === 'json' ? JSON.stringify(value ?? {}, null, 2) : String(value ?? '');
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const save = (v: unknown) =>
    update.mutate({ key: k, value: v }, {
      onSuccess: () => { setError(null); toast.success('Réglage enregistré.'); },
      onError: (e) => setError(isApiError(e) ? e.message : "L'enregistrement a échoué."),
    });
  const commit = () => {
    if (def.kind === 'int') {
      const n = Number(text);
      if (!Number.isInteger(n) || n < 0) return setError('Saisissez un nombre entier positif.');
      return save(n);
    }
    if (def.kind === 'percent') {
      const n = Number(text.replace(',', '.'));
      if (!Number.isFinite(n) || n < 0 || n > 100) return setError('Saisissez un pourcentage entre 0 et 100.');
      return save(Math.round(n * 100));
    }
    if (def.kind === 'json') {
      try {
        const parsed = JSON.parse(text);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('objet attendu');
        return save(parsed);
      } catch {
        return setError('JSON invalide : un objet de la forme {"clé": "valeur"} est attendu.');
      }
    }
  };

  if (def.kind === 'bool') {
    return (
      <div className="flex flex-col gap-1">
        <Switch label={def.label} description={def.hint} checked={value === true} onCheckedChange={(c) => save(c)} />
        {error && <p role="alert" className="text-[13px] text-danger-ink">{error}</p>}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <Field label={def.label} hint={def.hint} error={error ?? undefined} className="flex-1">
        {(c) =>
          def.kind === 'plan' ? <Select {...c} value={String(value)} onValueChange={(v) => save(v)} options={(plans.data ?? []).map((p) => ({ value: p.code, label: p.name }))} />
          : def.kind === 'currency' ? <Select {...c} value={String(value)} onValueChange={(v) => save(v)} options={Object.keys(CURRENCIES).map((x) => ({ value: x, label: x }))} />
          : def.kind === 'json' ? <Textarea {...c} value={text} onChange={(e) => setText(e.target.value)} rows={4} className="font-mono text-[13px]" />
          : <Input {...c} inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} />
        }
      </Field>
      {(def.kind === 'int' || def.kind === 'percent' || def.kind === 'json') && <Button variant="secondary" loading={update.isPending} onClick={commit} disabled={text === initial}>Enregistrer</Button>}
    </div>
  );
}

function GeneralSettings() {
  const q = usePlatformSettings();
  if (q.isPending) return <Panel><div role="status" className="flex flex-col gap-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><span className="sr-only">Chargement</span></div></Panel>;
  if (q.isError) return <Panel><p className="text-[14px] text-ink-2">Impossible de charger les réglages.</p></Panel>;
  const byKey = Object.fromEntries(q.data.settings.map((s) => [s.key, s.value]));
  const groups: Array<[string, string[]]> = [
    ['Essai gratuit', ['trial.enabled', 'trial.default_days', 'trial.default_plan_code']],
    ['Facturation', ['billing.default_currency', 'billing.tax_rate_bps', 'billing.invoice_due_days', 'billing.renewal_invoice_days', 'billing.grace_days', 'billing.auto_approve_plan_changes']],
    ['Sécurité des connexions', ['auth.max_failed_attempts', 'auth.lock_minutes']],
    ['Société', ['company.profile']],
  ];
  return (
    <div className="flex flex-col gap-4">
      {groups.map(([title, keys]) => (
        <Panel key={title} title={title}>
          <div className="flex flex-col gap-5">
            {keys.filter((k) => k in SETTINGS && q.data.editableKeys.includes(k) && k in byKey).map((k) => <SettingRow key={`${k}:${JSON.stringify(byKey[k])}`} k={k} value={byKey[k]} />)}
          </div>
        </Panel>
      ))}
    </div>
  );
}

function ConnectorCard({ c }: { c: Connector }) {
  const update = useUpdateConnector();
  const [instructions, setInstructions] = useState(c.instructions ?? '');
  const [error, setError] = useState<string | null>(null);
  const manual = c.mode === 'manual';
  const save = (patch: { instructions?: string | null; isEnabled?: boolean }) =>
    update.mutate({ code: c.code, ...patch }, {
      onSuccess: () => { setError(null); toast.success('Moyen de paiement enregistré.'); },
      onError: (e) => setError(isApiError(e) ? e.message : "L'enregistrement a échoué."),
    });
  return (
    <li className="surface glass-1 flex flex-col gap-4 p-6 [--surface-radius:var(--r-card)]">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[17px] font-semibold text-ink">{PAYMENT_METHOD[c.code] ?? c.name}</h3>
        <div className="flex gap-1.5">
          <Badge>{manual ? 'Manuel' : 'Automatisé'}</Badge>
          {c.isEnabled ? <StateBadge tone="success">Actif</StateBadge> : <StateBadge tone="neutral">Inactif</StateBadge>}
        </div>
      </div>
      {manual ? (
        <>
          <Field label="Consignes de paiement" hint="Affichées à l'établissement : numéro à créditer, RIB… (5 caractères minimum pour pouvoir activer).">
            {(f) => <Textarea {...f} value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={3} maxLength={1000} />}
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" size="sm" loading={update.isPending} disabled={instructions === (c.instructions ?? '')} onClick={() => save({ instructions: instructions.trim() || null })}>Enregistrer les consignes</Button>
            <Switch label={c.isEnabled ? 'Ouvert aux établissements' : 'Fermé aux établissements'} checked={c.isEnabled} onCheckedChange={(on) => save({ isEnabled: on, instructions: instructions.trim() || null })} />
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <Callout tone="warning"><span className="flex items-start gap-2"><PlugZap aria-hidden className="mt-0.5 size-4 shrink-0" />Aucun prestataire de paiement en ligne n&apos;est connecté. Ce moyen ne peut pas être activé : un faux paiement « réussi » est impossible.</span></Callout>
          <Switch label="Ouvert aux établissements" description="Indisponible tant qu'une vraie intégration n'existe pas." checked={false} disabled />
        </div>
      )}
      {error && <p role="alert" className="text-[13px] text-danger-ink">{error}</p>}
    </li>
  );
}

function Connectors() {
  const q = useConnectors();
  if (q.isPending) return <div role="status" className="grid gap-4 md:grid-cols-2"><Skeleton className="h-56 rounded-[22px]" /><Skeleton className="h-56 rounded-[22px]" /><span className="sr-only">Chargement</span></div>;
  if (q.isError) return <Panel><p className="text-[14px] text-ink-2">Impossible de charger les moyens de paiement.</p></Panel>;
  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-start gap-2 text-[14px] leading-snug text-ink-2"><CircleHelp aria-hidden className="mt-0.5 size-4 shrink-0" />{q.data.note}</p>
      <ul className="grid gap-4 md:grid-cols-2">{q.data.connectors.map((c) => <ConnectorCard key={c.code} c={c} />)}</ul>
    </div>
  );
}

/** Double authentification : la clé se saisit dans l'application (Google Authenticator, Aegis, FreeOTP, Microsoft Authenticator…). */
function Security() {
  const me = usePlatformMeQuery();
  const setup = useTotpSetup();
  const enable = useTotpEnable();
  const disable = useTotpDisable();
  const [secret, setSecret] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [password, setPassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fail = (e: unknown) => setError(isApiError(e) ? e.message : "L'action a échoué.");
  const on = me.data?.totpEnabled;
  return (
    <Panel title="Double authentification" description="Un code à 6 chiffres, renouvelé toutes les 30 secondes, s'ajoute au mot de passe. Indispensable pour un compte qui voit toute la plateforme.">
      {recovery ? (
        <div className="flex flex-col gap-4">
          <Callout tone="warning">Notez ces 8 codes de secours : chacun ne sert qu'une fois, en cas de perte de votre téléphone. Ils ne seront plus jamais affichés.</Callout>
          <ul className="grid gap-2 sm:grid-cols-2" aria-label="Codes de secours">{recovery.map((c) => <li key={c}><code className="num-col block rounded-[10px] bg-silver-soft px-3 py-2 text-[15px] text-ink">{c}</code></li>)}</ul>
          <Button variant="primary" className="self-start" onClick={() => setRecovery(null)}>J'ai noté mes codes</Button>
        </div>
      ) : on ? (
        <div className="flex flex-col gap-4">
          <p className="flex items-center gap-2 text-[14px] text-ink"><StateBadge tone="success">Activée</StateBadge>{me.data?.recoveryCodesLeft} code{(me.data?.recoveryCodesLeft ?? 0) > 1 ? 's' : ''} de secours restant{(me.data?.recoveryCodesLeft ?? 0) > 1 ? 's' : ''}.</p>
          <div className="grid max-w-xl gap-4 sm:grid-cols-2">
            <Field label="Mot de passe">{(c) => <PasswordInput {...c} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
            <Field label="Code actuel">{(c) => <Input {...c} inputMode="numeric" autoComplete="one-time-code" value={disableCode} onChange={(e) => setDisableCode(e.target.value)} />}</Field>
          </div>
          {error && <Callout tone="danger">{error}</Callout>}
          <Button variant="danger" className="self-start" loading={disable.isPending} onClick={() => { setError(null); disable.mutate({ password, code: disableCode }, { onSuccess: () => { setPassword(''); setDisableCode(''); toast.success('Double authentification désactivée.'); }, onError: fail }); }}>Désactiver</Button>
        </div>
      ) : secret ? (
        <div className="flex flex-col gap-4">
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-[14px] text-ink-2">
            <li>Dans votre application d'authentification, choisissez « Saisir une clé de configuration ».</li>
            <li>Saisissez cette clé (type : basé sur l'heure) :</li>
          </ol>
          <code className="num-col block max-w-full overflow-x-auto rounded-[12px] bg-silver-soft px-4 py-3 text-[17px] tracking-[0.12em] text-ink" data-testid="totp-secret">{secret.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
          <Field label="Code affiché par l'application" hint="Pour vérifier que tout est bien configuré." required>{(c) => <Input {...c} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />}</Field>
          {error && <Callout tone="danger">{error}</Callout>}
          <div className="flex gap-2"><Button variant="primary" loading={enable.isPending} onClick={() => { setError(null); enable.mutate(code.trim(), { onSuccess: (r) => { setSecret(null); setCode(''); setRecovery(r.recoveryCodes); }, onError: fail }); }}>Activer</Button><Button variant="secondary" onClick={() => setSecret(null)}>Annuler</Button></div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Callout tone="warning">La double authentification n'est pas activée sur votre compte.</Callout>
          <Button variant="primary" className="self-start" loading={setup.isPending} onClick={() => { setError(null); setup.mutate(undefined, { onSuccess: setSecret, onError: fail }); }}>Activer la double authentification</Button>
        </div>
      )}
    </Panel>
  );
}

export default function PlatformSettingsPage() {
  useDocumentTitle('Réglages — Console');
  return (
    <>
      <PageHeader title="Réglages" description="Les règles commerciales de la plateforme et les moyens de paiement ouverts aux établissements. Chaque modification est journalisée." />
      <Tabs label="Sections des réglages" tabs={[{ value: 'general', label: 'Règles commerciales', content: <GeneralSettings /> }, { value: 'payments', label: 'Moyens de paiement', content: <Connectors /> }, { value: 'security', label: 'Sécurité', content: <Security /> }]} />
    </>
  );
}
