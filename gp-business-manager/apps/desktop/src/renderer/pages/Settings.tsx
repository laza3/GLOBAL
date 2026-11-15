import { useEffect, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { CURRENCIES, DEFAULT_NUMBERING } from '@gp/shared';
import { Badge, Button, Card, Checkbox, DataTable, ErrorBox, Field, Input, Modal, MoneyInput, PageHeader, Select, Tabs, Textarea, Warn, useToast } from '../components/ui';
import { system, useM, useQ } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useT } from '../lib/i18n';
import { money, pct } from '../lib/format';

export function SettingsPage() {
  const [tab, setTab] = useState<'company' | 'commerce' | 'payments' | 'taxes' | 'numbering' | 'pos'>('company');
  return (
    <>
      <PageHeader title="Paramètres" subtitle="Entreprise, taxes, modes de paiement, numérotation et tickets" />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'company', label: 'Entreprise' }, { id: 'commerce', label: 'Paramètres commerciaux' }, { id: 'payments', label: 'Modes de paiement' }, { id: 'taxes', label: 'Taxes' }, { id: 'numbering', label: 'Numérotation' }, { id: 'pos', label: 'Tickets & caisse' }]} />
      {tab === 'company' && <CompanyTab />}{tab === 'commerce' && <CommerceTab />}{tab === 'payments' && <PaymentsTab />}{tab === 'taxes' && <TaxesTab />}{tab === 'numbering' && <NumberingTab />}{tab === 'pos' && <PosTab />}
    </>
  );
}

function useCompanyForm() {
  const { refreshCompany } = useAuth();
  const { push } = useToast();
  const { t } = useT();
  const { data } = useQ('company.get');
  const [f, setF] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { if (data) setF(data); }, [data]);
  const m = useM('company.update', { onSuccess: () => { push('success', t('Paramètres enregistrés')); void refreshCompany(); } });
  const save = (patch: any) => m.mutate(patch, { onError: setErr });
  return { f, setF, err, save, saving: m.isPending, data };
}

function CompanyTab() {
  const { t } = useT();
  const { push } = useToast();
  const { f, setF, err, save, saving } = useCompanyForm();
  if (!f) return null;
  const set = (k: string, v: any) => setF({ ...f, [k]: v });
  const logo = async () => { try { const d = await system('pickImage'); if (d) set('logo', d); } catch (e) { push('error', (e as Error).message); } };
  return (
    <Card className="max-w-4xl p-6">
      <div className="grid gap-4 md:grid-cols-[9rem_1fr]">
        <button onClick={logo} className="grid aspect-square place-items-center overflow-hidden rounded-2xl border-2 border-dashed border-ink-200 bg-ink-50 text-xs text-ink-400 hover:border-gold-400 dark:border-white/10 dark:bg-white/5">{f.logo ? <img src={f.logo} alt="" className="size-full object-contain p-2" /> : <span className="flex flex-col items-center gap-1"><ImagePlus className="size-6" />{t('Logo')}</span>}</button>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Nom commercial"><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field><Field label="Raison sociale"><Input value={f.legalName ?? ''} onChange={(e) => set('legalName', e.target.value)} /></Field>
          <Field label="NIF"><Input value={f.taxId ?? ''} onChange={(e) => set('taxId', e.target.value)} /></Field><Field label="N° statistique (STAT)"><Input value={f.statNo ?? ''} onChange={(e) => set('statNo', e.target.value)} /></Field>
          <Field label="Adresse" className="md:col-span-2"><Input value={f.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
          <Field label="Téléphone"><Input value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field><Field label="E-mail"><Input value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
        </div>
      </div>
      <div className="mt-4"><ErrorBox error={err} /></div>
      <div className="mt-4 flex justify-end"><Button variant="primary" loading={saving} onClick={() => save({ name: f.name, legalName: f.legalName, taxId: f.taxId, statNo: f.statNo, address: f.address, phone: f.phone, email: f.email, logo: f.logo })}>{t('Enregistrer')}</Button></div>
    </Card>
  );
}

function CommerceTab() {
  const { t } = useT();
  const { f, setF, err, save, saving } = useCompanyForm();
  const { setLocale } = useAuth();
  if (!f) return null;
  const set = (k: string, v: any) => setF({ ...f, [k]: v });
  return (
    <Card className="max-w-3xl p-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Devise" hint="Non modifiable après la première vente"><Select value={f.currency} onChange={(e) => set('currency', e.target.value)}>{Object.values(CURRENCIES).map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}</Select></Field>
        <Field label="Langue par défaut"><Select value={f.locale} onChange={(e) => set('locale', e.target.value)}><option value="fr">Français</option><option value="en">English</option></Select></Field>
        <Field label="Fuseau horaire"><Input value={f.timezone} onChange={(e) => set('timezone', e.target.value)} /></Field>
        <Field label="Prix de vente saisis" hint="Non modifiable après la première vente"><Select value={f.pricesIncludeTax ? '1' : '0'} onChange={(e) => set('pricesIncludeTax', e.target.value === '1')}><option value="1">{t('Taxe incluse (TTC)')}</option><option value="0">{t('Hors taxe (HT)')}</option></Select></Field>
        <Field label="Remise maximale sans autorisation (%)" hint="Au-delà, seul un rôle disposant de sale.discount peut valider"><Input type="number" min={0} max={100} value={f.maxCashierDiscountBp / 100} onChange={(e) => set('maxCashierDiscountBp', Math.round(Number(e.target.value) * 100))} /></Field>
        <div className="flex items-end"><Checkbox checked={f.allowNegativeStock} onChange={(v) => set('allowNegativeStock', v)} label="Autoriser la vente sous le stock disponible" /></div>
      </div>
      <div className="mt-4"><ErrorBox error={err} /></div>
      <div className="mt-4 flex justify-end"><Button variant="primary" loading={saving} onClick={() => { save({ currency: f.currency, locale: f.locale, timezone: f.timezone, pricesIncludeTax: f.pricesIncludeTax, allowNegativeStock: f.allowNegativeStock, maxCashierDiscountBp: f.maxCashierDiscountBp }); setLocale(f.locale); }}>{t('Enregistrer')}</Button></div>
    </Card>
  );
}

function PaymentsTab() {
  const { t } = useT();
  const { data } = useQ('ref.paymentMethods', { all: true });
  const accounts = (useQ('finance.accounts').data ?? []) as any[];
  const [edit, setEdit] = useState<any | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const m = useM('ref.savePaymentMethod', { onSuccess: () => setEdit(null) });
  return (
    <Card className="max-w-3xl">
      <div className="flex justify-end p-4"><Button variant="gold" onClick={() => { setErr(null); setEdit({ code: '', name: '', kind: 'MOBILE', accountId: accounts.find((a) => a.type === 'MOBILE')?.id }); }}>{t('Ajouter')}</Button></div>
      <DataTable rowKey={(r: any) => r.id} onRowClick={(r: any) => { setErr(null); setEdit(r); }} rows={(data ?? []) as any[]} columns={[{ key: 'n', header: 'Nom', render: (r: any) => r.name }, { key: 'k', header: 'Type', render: (r: any) => <Badge>{r.kind}</Badge> }, { key: 'a', header: 'Compte', render: (r: any) => accounts.find((a) => a.id === r.accountId)?.name ?? (r.kind === 'CASH' ? t('Caisse de la session') : '—') }, { key: 's', header: '', render: (r: any) => !r.active && <Badge tone="red">{t('Inactif')}</Badge> }]} />
      {edit && <Modal open onClose={() => setEdit(null)} size="sm" title="Mode de paiement" footer={<><Button onClick={() => setEdit(null)}>{t('Annuler')}</Button><Button variant="primary" disabled={!edit.name.trim() || (!edit.id && edit.code.length < 2)} onClick={() => m.mutate({ id: edit.id, code: edit.code || 'X', name: edit.name, kind: edit.kind, accountId: edit.accountId || undefined, active: edit.active !== 0 && edit.active !== false }, { onError: setErr })}>{t('Enregistrer')}</Button></>}>
        <div className="space-y-3"><Field label="Nom"><Input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          {!edit.id && <><Field label="Code"><Input value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} /></Field><Field label="Type"><Select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>{['MOBILE', 'CARD', 'BANK', 'CHEQUE', 'OTHER'].map((k) => <option key={k} value={k}>{k}</option>)}</Select></Field></>}
          {edit.kind !== 'CASH' && <Field label="Compte crédité"><Select value={edit.accountId ?? ''} onChange={(e) => setEdit({ ...edit, accountId: e.target.value })}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>}
          {edit.id && <Checkbox checked={edit.active !== 0 && edit.active !== false} onChange={(v) => setEdit({ ...edit, active: v })} label="Actif" />}<ErrorBox error={err} /></div></Modal>}
    </Card>
  );
}

function TaxesTab() {
  const { t } = useT();
  const { data } = useQ('ref.taxRates');
  const [f, setF] = useState({ name: '', rate: '' });
  const m = useM('ref.saveTaxRate', { onSuccess: () => setF({ name: '', rate: '' }) });
  return (
    <Card className="max-w-xl">
      <div className="flex gap-2 p-4"><Input placeholder={t('Nom (ex. TVA 5 %)')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /><Input className="w-28" placeholder="%" inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /><Button variant="gold" disabled={!f.name || f.rate === ''} onClick={() => m.mutate({ name: f.name, rateBp: Math.round(Number(f.rate.replace(',', '.')) * 100) })}>{t('Ajouter')}</Button></div>
      <DataTable rowKey={(r: any) => r.id} rows={(data ?? []) as any[]} columns={[{ key: 'n', header: 'Taxe', render: (r: any) => r.name }, { key: 'r', header: 'Taux', align: 'right', render: (r: any) => pct(r.rateBp) }, { key: 'd', header: '', render: (r: any) => (r.isDefault ? <Badge tone="gold">{t('Par défaut')}</Badge> : <Button size="sm" variant="ghost" onClick={() => m.mutate({ id: r.id, name: r.name, rateBp: r.rateBp, isDefault: true })}>{t('Définir par défaut')}</Button>) }]} />
    </Card>
  );
}

function NumberingTab() {
  const { t } = useT();
  const { f, setF, err, save, saving } = useCompanyForm();
  if (!f) return null;
  const labels: Record<string, string> = { SALE: 'Tickets de vente', INVOICE: 'Factures', RETURN: 'Retours', CREDIT_NOTE: 'Avoirs', PURCHASE: 'Commandes fournisseurs', RECEIPT: 'Réceptions', EXPENSE: 'Dépenses', TRANSFER: 'Transferts', INVENTORY: 'Inventaires' };
  return (
    <Card className="max-w-3xl p-6">
      <Warn>{t('Formats : {YYYY} année, {YY}, {MM} mois, {000000} compteur à 6 chiffres. Les numéros déjà émis ne changent pas.')}</Warn>
      <div className="mt-4 grid gap-3 md:grid-cols-2">{Object.entries(labels).map(([k, l]) => <Field key={k} label={l}><Input value={f.numbering?.[k] ?? DEFAULT_NUMBERING[k]} onChange={(e) => setF({ ...f, numbering: { ...f.numbering, [k]: e.target.value } })} /></Field>)}</div>
      <div className="mt-4"><ErrorBox error={err} /></div>
      <div className="mt-4 flex justify-end"><Button variant="primary" loading={saving} onClick={() => save({ numbering: f.numbering })}>{t('Enregistrer')}</Button></div>
    </Card>
  );
}

function PosTab() {
  const { t } = useT();
  const { f, setF, err, save, saving } = useCompanyForm();
  const [auto, setAuto] = useState(() => { try { return localStorage.getItem('gp.autoprint') === '1'; } catch { return false; } });
  const [printers, setPrinters] = useState<any[]>([]);
  useEffect(() => { system('listPrinters').then(setPrinters).catch(() => {}); }, []);
  if (!f) return null;
  return (
    <Card className="max-w-3xl p-6">
      <div className="space-y-4">
        <Field label="Pied de ticket"><Textarea rows={2} value={f.receiptFooter ?? ''} onChange={(e) => setF({ ...f, receiptFooter: e.target.value })} /></Field>
        <Field label="Mentions sur les factures" hint="Conditions de paiement, coordonnées bancaires, mentions légales…"><Textarea rows={3} value={f.invoiceNotes ?? ''} onChange={(e) => setF({ ...f, invoiceNotes: e.target.value })} /></Field>
        <Checkbox checked={auto} onChange={(v) => { setAuto(v); try { localStorage.setItem('gp.autoprint', v ? '1' : '0'); } catch { /* ignore */ } }} label="Imprimer automatiquement le ticket après chaque vente (sur ce poste)" />
        <p className="text-xs text-ink-400">{t('Imprimantes détectées')} : {printers.map((p) => p.name + (p.isDefault ? ' ★' : '')).join(', ') || t('aucune')}</p>
      </div>
      <div className="mt-4"><ErrorBox error={err} /></div>
      <div className="mt-4 flex justify-end"><Button variant="primary" loading={saving} onClick={() => save({ receiptFooter: f.receiptFooter, invoiceNotes: f.invoiceNotes })}>{t('Enregistrer')}</Button></div>
    </Card>
  );
}
void money; void MoneyInput;
