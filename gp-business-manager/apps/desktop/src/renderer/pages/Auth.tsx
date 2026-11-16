import { isWeb } from '../lib/platform';
import { useState, type FormEvent } from 'react';
import { Logo } from '../components/Brand';
import { Button, ErrorBox, Field, Input, Select } from '../components/ui';
import { useAuth } from '../lib/auth';
import { useT } from '../lib/i18n';
import { CURRENCIES, LOCALES } from '@gp/shared';
import { ShieldCheck, WifiOff } from 'lucide-react';

function Shell({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle: string }) {
  const { t } = useT();
  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-ink-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-gold-400/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 size-96 rounded-full bg-sky-400/10 blur-3xl" />
        <div className="relative flex items-center gap-3"><Logo size={44} /><div><p className="text-lg font-semibold tracking-tight">GP Business Manager</p><p className="text-xs text-ink-300">ERP commercial</p></div></div>
        <div className="relative max-w-md space-y-6">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">{t('Vendez, gérez, pilotez.')}<br /><span className="text-gold-300">{t('Même sans Internet.')}</span></h2>
          <ul className="space-y-3 text-sm text-ink-200">
            <li className="flex gap-3"><WifiOff className="mt-0.5 size-4 text-gold-300" />{t('Caisse, stock et clients disponibles hors ligne, données stockées sur cet ordinateur.')}</li>
            <li className="flex gap-3"><ShieldCheck className="mt-0.5 size-4 text-gold-300" />{t('Opérations financières immuables, journal d’activité et sauvegardes.')}</li>
          </ul>
        </div>
        <p className="relative text-xs text-ink-400">© {new Date().getFullYear()} GP Business Manager</p>
      </div>
      <div className="flex items-center justify-center bg-ink-50 p-6 dark:bg-ink-950">
        <div className="w-full max-w-md animate-fade-in">
          <div className="mb-6 flex items-center gap-3 lg:hidden"><Logo /><span className="font-semibold">GP Business Manager</span></div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900 dark:text-white">{t(title)}</h1>
          <p className="mb-6 mt-1 text-sm text-ink-500 dark:text-ink-300">{t(subtitle)}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { login, company } = useAuth();
  const { t } = useT();
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await login(u, p); } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (
    <Shell title="Connexion" subtitle={company?.name ? company.name : 'Identifiez-vous pour accéder à votre espace'}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Identifiant"><Input autoFocus autoComplete="username" value={u} onChange={(e) => setU(e.target.value)} /></Field>
        <Field label="Mot de passe"><Input type="password" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} /></Field>
        <ErrorBox error={err} />
        <Button type="submit" variant="gold" size="lg" className="w-full" loading={busy} disabled={!u || !p}>{t('Se connecter')}</Button>
      </form>
      <details className="mt-5 text-sm text-ink-500 dark:text-ink-300">
        <summary className="cursor-pointer select-none font-medium hover:text-gold-600">{t('Mot de passe oublié ?')}</summary>
        <div className="mt-2 space-y-2 rounded-xl bg-ink-100/70 p-3 dark:bg-white/5">
          <p>{t('Demandez à un autre administrateur de le réinitialiser (Administration → Utilisateurs).')}</p>
          {isWeb ? <p>{t('Sinon : contactez l’hébergeur du service (il peut réinitialiser votre mot de passe sans toucher à vos données).')}</p> : <>
          <p>{t('Sinon : fermez l’application, ouvrez une invite de commandes dans le dossier d’installation et lancez :')}</p>
          <code className="block select-all break-all rounded-lg bg-white p-2 text-xs dark:bg-ink-900">{'"GP Business Manager.exe" --reset-password=NouveauMotDePasse'}</code>
          <p className="text-xs">{t('Vos données sont conservées. Ajoutez --user=identifiant pour un autre compte.')}</p></>}
        </div>
      </details>
    </Shell>
  );
}

export function SetupPage() {
  const { setup } = useAuth();
  const { t } = useT();
  const [f, setF] = useState({ companyName: '', currency: 'MGA', locale: 'fr', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Indian/Antananarivo', pricesIncludeTax: true, username: 'admin', displayName: '', password: '', password2: '', setupCode: '' });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const mismatch = f.password && f.password2 && f.password !== f.password2;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (f.password !== f.password2) return setErr(new Error('Les mots de passe ne correspondent pas'));
    setBusy(true); setErr(null);
    try { await setup({ ...(isWeb ? { setupCode: f.setupCode.trim() } : {}), companyName: f.companyName, currency: f.currency, locale: f.locale, timezone: f.timezone, pricesIncludeTax: f.pricesIncludeTax, admin: { username: f.username, displayName: f.displayName || f.username, password: f.password } }); }
    catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (
    <Shell title="Bienvenue" subtitle="Configurons votre entreprise en une minute.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nom de l’entreprise"><Input autoFocus required value={f.companyName} onChange={(e) => set('companyName', e.target.value)} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Devise"><Select value={f.currency} onChange={(e) => set('currency', e.target.value)}>{Object.values(CURRENCIES).map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}</Select></Field>
          <Field label="Langue"><Select value={f.locale} onChange={(e) => set('locale', e.target.value)}>{LOCALES.filter((l) => l.code !== 'mg').map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</Select></Field>
        </div>
        <Field label="Prix de vente" hint="Détermine si les prix saisis incluent la taxe. Non modifiable après la première vente."><Select value={f.pricesIncludeTax ? '1' : '0'} onChange={(e) => set('pricesIncludeTax', e.target.value === '1')}><option value="1">{t('Taxe incluse (TTC)')}</option><option value="0">{t('Hors taxe (HT)')}</option></Select></Field>
        <div className="border-t border-ink-200 pt-4 dark:border-white/10"><p className="mb-3 text-sm font-medium text-ink-700 dark:text-ink-100">{t('Compte administrateur')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nom affiché"><Input required value={f.displayName} onChange={(e) => set('displayName', e.target.value)} /></Field>
            <Field label="Identifiant"><Input required minLength={3} value={f.username} onChange={(e) => set('username', e.target.value)} /></Field>
            <Field label="Mot de passe" hint="8 caractères minimum"><Input required type="password" minLength={8} autoComplete="new-password" value={f.password} onChange={(e) => set('password', e.target.value)} /></Field>
            <Field label="Confirmation" error={mismatch ? t('Ne correspond pas') : undefined}><Input required type="password" autoComplete="new-password" value={f.password2} onChange={(e) => set('password2', e.target.value)} /></Field>
          </div>
        </div>
        {isWeb && <Field label="Code d’installation" hint="Affiché dans le journal du serveur au premier démarrage (donné par votre hébergeur)."><Input required autoComplete="off" value={f.setupCode} onChange={(e) => set('setupCode', e.target.value)} /></Field>}
        <ErrorBox error={err} />
        <Button type="submit" variant="gold" size="lg" className="w-full" loading={busy}>{t('Créer mon espace')}</Button>
      </form>
    </Shell>
  );
}
