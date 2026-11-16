import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DatabaseBackup, FolderOpen, Plus, RotateCcw, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react';
import { PERMISSIONS } from '@gp/shared';
import { Badge, Button, Card, ConfirmDialog, DataTable, ErrorBox, Field, Input, Modal, PageHeader, Select, Tabs, Checkbox, Warn, useToast } from '../components/ui';
import { system, useM, useQ } from '../lib/api';
import { useAuth } from '../lib/auth';
import { UpdateCard } from '../components/Update';
import { useT } from '../lib/i18n';
import { dateTime, money } from '../lib/format';

export function AdminPage() {
  const { t } = useT();
  const { can, me } = useAuth();
  const tabs = [
    ...(can('user.manage') ? [{ id: 'users', label: 'Comptes utilisateurs' }] : []),
    ...(can(['role.manage', 'user.manage']) ? [{ id: 'roles', label: 'Rôles & permissions' }] : []),
    ...(can('organization.manage') ? [{ id: 'org', label: 'Organisation' }] : []),
    ...(can('audit.view') ? [{ id: 'audit', label: 'Journal d’activité' }] : []),
    ...(can('backup.manage') ? [{ id: 'backup', label: 'Sauvegardes' }] : []),
    ...(me?.roleCode === 'ADMIN' ? [{ id: 'reset', label: 'Réinitialisation' }] : []),
  ] as { id: string; label: string }[];
  const [tab, setTab] = useState(tabs[0]?.id ?? 'users');
  return (
    <>
      <PageHeader title="Administration" subtitle="Utilisateurs, droits, organisation, audit et sauvegardes" />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'users' && <Users />}{tab === 'roles' && <Roles />}{tab === 'org' && <Org />}{tab === 'audit' && <Audit />}{tab === 'backup' && <Backup />}{tab === 'reset' && me?.roleCode === 'ADMIN' && <ResetAll />}
    </>
  );
}

function Users() {
  const { t } = useT();
  const { data } = useQ('users.list');
  const roles = (useQ('roles.list').data ?? []) as any[];
  const [edit, setEdit] = useState<any | null>(null);
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="max-w-xl text-sm text-ink-500">{t('Créez un compte pour chaque personne de l’entreprise et choisissez son profil. Elle devra changer son mot de passe temporaire à sa première connexion.')}</p>
        <Button variant="gold" icon={<Plus className="size-4" />} onClick={() => setEdit({ roleId: roles.find((r) => r.code === 'CASHIER')?.id ?? roles[0]?.id, branchId: '' })}>{t('Créer un compte')}</Button>
      </div>
      <DataTable rowKey={(r: any) => r.id} onRowClick={(r: any) => setEdit({ ...r, password: '', branchId: r.branchId ?? '' })} rows={(data ?? []) as any[]} columns={[
        { key: 'n', header: 'Utilisateur', render: (r: any) => <><span className="font-medium">{r.displayName}</span><span className="block text-xs text-ink-400">@{r.username}</span></> },
        { key: 'r', header: 'Profil', render: (r: any) => <Badge tone={r.roleCode === 'ADMIN' ? 'gold' : r.roleCode === 'MANAGER' ? 'blue' : 'neutral'}>{t(r.roleName)}</Badge> },
        { key: 'b', header: 'Boutique', render: (r: any) => (r.branchName ? r.branchName : <span className="text-ink-400">{t('Toutes les boutiques')}</span>) },
        { key: 'l', header: 'Dernière connexion', render: (r: any) => (r.lastLoginAt ? dateTime(r.lastLoginAt) : <span className="text-ink-400">{t('Jamais')}</span>) },
        { key: 's', header: 'Statut', render: (r: any) => (r.lockedUntil && new Date(r.lockedUntil) > new Date() ? <Badge tone="red">{t('Verrouillé')}</Badge> : !r.active ? <Badge>{t('Désactivé')}</Badge> : r.mustChangePassword ? <Badge tone="gold">{t('Mot de passe temporaire')}</Badge> : <Badge tone="green">{t('Actif')}</Badge>) }]} />
      {edit && <UserForm initial={edit} roles={roles} onClose={() => setEdit(null)} />}
    </Card>
  );
}
function UserForm({ initial, roles, onClose }: { initial: any; roles: any[]; onClose: () => void }) {
  const { t } = useT();
  const branches = (useQ('org.branches').data ?? []) as any[];
  const [f, setF] = useState<any>({ username: '', displayName: '', password: '', active: true, branchId: '', ...initial });
  const [err, setErr] = useState<unknown>(null);
  const create = useM('users.create', { onSuccess: onClose });
  const update = useM('users.update', { onSuccess: onClose });
  const role = roles.find((r) => r.id === f.roleId);
  const { me } = useAuth();
  const { push } = useToast();
  const [confirmDel, setConfirmDel] = useState(false);
  const del = useM('users.delete', { onSuccess: (r) => { push('success', r.mode === 'deleted' ? t('Compte supprimé.') : t('Compte archivé : il ne peut plus se connecter ; son historique de ventes est conservé.')); onClose(); } });
  const save = () => (f.id
    ? update.mutate({ id: f.id, displayName: f.displayName, roleId: f.roleId, branchId: f.branchId || null, active: f.active, password: f.password || undefined }, { onError: setErr })
    : create.mutate({ username: f.username, displayName: f.displayName, password: f.password, roleId: f.roleId, branchId: f.branchId || undefined }, { onError: setErr }));
  return (
    <Modal open onClose={onClose} size="md" title={f.id ? 'Modifier le compte' : 'Créer un compte'} footer={<>{f.id && f.id !== me?.id && <Button variant="danger" className="mr-auto" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDel(true)}>{t('Supprimer le compte')}</Button>}<Button onClick={onClose}>{t('Annuler')}</Button><Button variant="primary" loading={create.isPending || update.isPending} disabled={!f.displayName || (!f.id && (!f.username || f.password.length < 8))} onClick={save}>{t('Enregistrer')}</Button></>}>
      <div className="space-y-3">
        <ConfirmDialog open={confirmDel} danger title="Supprimer ce compte" message={`${f.displayName} (@${f.username}) ne pourra plus se connecter. Si cette personne a déjà fait des ventes ou ouvert une caisse, le compte est archivé : l'historique est conservé. Sinon il est supprimé définitivement.`} confirmLabel="Supprimer le compte" onClose={() => setConfirmDel(false)} onConfirm={() => del.mutate({ id: f.id }, { onError: setErr })} />
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Nom de la personne"><Input autoFocus value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></Field>
          <Field label="Identifiant de connexion" hint="Lettres, chiffres, point ou tiret"><Input disabled={!!f.id} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
        </div>
        <Field label="Profil">
          <Select value={f.roleId} onChange={(e) => setF({ ...f, roleId: e.target.value })}>{roles.map((r) => <option key={r.id} value={r.id}>{t(r.name)}</option>)}</Select>
        </Field>
        {role?.description && <p className="rounded-xl bg-ink-100/70 p-3 text-sm text-ink-600 dark:bg-white/5 dark:text-ink-200">{t(role.description)}</p>}
        <Field label="Boutique" hint="Une personne rattachée à une boutique ne voit et ne vend que dans celle-ci (sauf profils autorisés à tout voir : administrateur, gérant, responsable des ventes, comptable).">
          <Select value={f.branchId ?? ''} onChange={(e) => setF({ ...f, branchId: e.target.value })}><option value="">{t('Toutes les boutiques')}</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
        </Field>
        <Field label={f.id ? 'Nouveau mot de passe temporaire (laisser vide pour conserver)' : 'Mot de passe temporaire'} hint="8 caractères minimum. La personne devra le remplacer à sa première connexion ; vous ne connaîtrez jamais son mot de passe définitif.">
          <Input type="text" autoComplete="off" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </Field>
        {f.id && <Checkbox checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Compte actif (décochez pour retirer l’accès à un employé qui part)" />}
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

const GROUPS: Record<string, string> = { dashboard: 'Tableau de bord', product: 'Produits', stock: 'Stocks', inventory: 'Inventaires', customer: 'Clients', supplier: 'Fournisseurs', purchase: 'Achats', sale: 'Ventes', cash: 'Caisse', finance: 'Finances', expense: 'Dépenses', report: 'Rapports', user: 'Administration', role: 'Administration', settings: 'Administration', backup: 'Administration', audit: 'Administration', organization: 'Administration', branch: 'Administration' };
function Roles() {
  const { t } = useT();
  const roles = (useQ('roles.list').data ?? []) as any[];
  const [edit, setEdit] = useState<any | null>(null);
  const [del, setDel] = useState<any | null>(null);
  const rm = useM('roles.delete');
  const { push } = useToast();
  return (
    <Card>
      <div className="flex justify-end p-4"><Button variant="gold" icon={<Plus className="size-4" />} onClick={() => setEdit({ name: '', permissions: [] })}>{t('Nouveau rôle')}</Button></div>
      <DataTable rowKey={(r: any) => r.id} onRowClick={(r: any) => setEdit(r)} rows={roles} columns={[{ key: 'n', header: 'Profil', render: (r: any) => <><span className="font-medium">{t(r.name)}</span> {r.isSystem && <Badge>{t('Système')}</Badge>}{r.description && <span className="mt-0.5 block max-w-xl text-xs text-ink-400">{t(r.description)}</span>}</> }, { key: 'u', header: 'Comptes', align: 'right', render: (r: any) => r.userCount }, { key: 'p', header: 'Permissions', align: 'right', render: (r: any) => `${r.permissions.length} / ${PERMISSIONS.length}` },
        { key: 'a', header: '', align: 'right', render: (r: any) => !r.isSystem && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setDel(r); }}><Trash2 className="size-4" /></Button> }]} />
      {edit && <RoleForm initial={edit} onClose={() => setEdit(null)} />}
      <ConfirmDialog open={!!del} danger title="Supprimer le rôle" message="Le rôle sera supprimé s'il n'est attribué à aucun utilisateur." onClose={() => setDel(null)} onConfirm={() => rm.mutate({ id: del.id }, { onError: (e) => push('error', e.message) })} />
    </Card>
  );
}
function RoleForm({ initial, onClose }: { initial: any; onClose: () => void }) {
  const { t } = useT();
  const [name, setName] = useState(initial.name);
  const [perms, setPerms] = useState<Set<string>>(new Set(initial.permissions));
  const [err, setErr] = useState<unknown>(null);
  const locked = initial.code === 'ADMIN';
  const m = useM('roles.save', { onSuccess: onClose });
  const groups = [...new Set(PERMISSIONS.map((p) => GROUPS[p.split('.')[0]] ?? 'Autres'))];
  const toggle = (p: string) => setPerms((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });
  return (
    <Modal open onClose={onClose} size="lg" title={initial.id ? `${t('Rôle')} — ${initial.name}` : 'Nouveau rôle'} footer={<><Button onClick={onClose}>{t('Fermer')}</Button>{!locked && <Button variant="primary" loading={m.isPending} disabled={!name.trim()} onClick={() => m.mutate({ id: initial.id, name, permissions: [...perms] }, { onError: setErr })}>{t('Enregistrer')}</Button>}</>}>
      {locked && <div className="mb-3"><Warn>{t('Le rôle Administrateur possède toutes les permissions et ne peut pas être modifié.')}</Warn></div>}
      <Field label="Nom du rôle"><Input disabled={locked} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="mt-4 grid gap-4 md:grid-cols-2">{groups.map((g) => (
        <div key={g} className="rounded-xl border border-ink-100 p-3 dark:border-white/10"><p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">{t(g)}</p>
          <div className="space-y-1.5">{PERMISSIONS.filter((p) => (GROUPS[p.split('.')[0]] ?? 'Autres') === g).map((p) => <label key={p} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={locked} className="accent-gold-500" checked={perms.has(p)} onChange={() => toggle(p)} /><code className="text-xs">{p}</code></label>)}</div></div>))}</div>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

function Org() {
  const { t } = useT();
  const branches = (useQ('org.branches').data ?? []) as any[];
  const wh = (useQ('org.warehouses').data ?? []) as any[];
  const regs = (useQ('org.registers').data ?? []) as any[];
  const [form, setForm] = useState<null | { kind: 'branch' | 'warehouse' | 'register'; data: any }>(null);
  const [err, setErr] = useState<unknown>(null);
  const sb = useM('org.saveBranch', { onSuccess: () => setForm(null) });
  const sw = useM('org.saveWarehouse', { onSuccess: () => setForm(null) });
  const sr = useM('org.saveRegister', { onSuccess: () => setForm(null) });
  const save = () => { const d = form!.data; (form!.kind === 'branch' ? sb : form!.kind === 'warehouse' ? sw : sr).mutate(d, { onError: setErr }); };
  const Section = ({ title, kind, rows, cols }: { title: string; kind: 'branch' | 'warehouse' | 'register'; rows: any[]; cols: any[] }) => (
    <Card><div className="flex items-center justify-between p-4"><h3 className="font-semibold">{t(title)}</h3><Button size="sm" icon={<Plus className="size-4" />} onClick={() => { setErr(null); setForm({ kind, data: { branchId: branches[0]?.id, warehouseId: wh[0]?.id, name: '' } }); }}>{t('Ajouter')}</Button></div>
      <DataTable dense rowKey={(r: any) => r.id} onRowClick={(r: any) => { setErr(null); setForm({ kind, data: { ...r } }); }} rows={rows} columns={cols} /></Card>);
  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <Section title="Établissements" kind="branch" rows={branches} cols={[{ key: 'n', header: 'Nom', render: (r: any) => r.name }, { key: 'a', header: '', render: (r: any) => !r.active && <Badge>{t('Inactif')}</Badge> }]} />
      <Section title="Entrepôts" kind="warehouse" rows={wh} cols={[{ key: 'n', header: 'Nom', render: (r: any) => r.name }, { key: 'b', header: 'Établissement', render: (r: any) => r.branchName }]} />
      <Section title="Caisses" kind="register" rows={regs} cols={[{ key: 'n', header: 'Nom', render: (r: any) => r.name }, { key: 'w', header: 'Entrepôt', render: (r: any) => r.warehouseName }, { key: 's', header: '', render: (r: any) => r.openSessionId && <Badge tone="green">{t('Ouverte')}</Badge> }]} />
      {form && <Modal open onClose={() => setForm(null)} size="sm" title={form.kind === 'branch' ? 'Établissement' : form.kind === 'warehouse' ? 'Entrepôt' : 'Caisse'} footer={<><Button onClick={() => setForm(null)}>{t('Annuler')}</Button><Button variant="primary" disabled={!form.data.name?.trim()} onClick={save}>{t('Enregistrer')}</Button></>}>
        <div className="space-y-3"><Field label="Nom"><Input autoFocus value={form.data.name ?? ''} onChange={(e) => setForm({ ...form, data: { ...form.data, name: e.target.value } })} /></Field>
          {form.kind !== 'branch' && <Field label="Établissement"><Select value={form.data.branchId} onChange={(e) => setForm({ ...form, data: { ...form.data, branchId: e.target.value } })}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>}
          {form.kind === 'register' && <Field label="Entrepôt de la caisse"><Select value={form.data.warehouseId} onChange={(e) => setForm({ ...form, data: { ...form.data, warehouseId: e.target.value } })}>{wh.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>}
          {form.data.id && <Checkbox checked={form.data.active !== 0 && form.data.active !== false} onChange={(v) => setForm({ ...form, data: { ...form.data, active: v } })} label="Actif" />}<ErrorBox error={err} /></div></Modal>}
    </div>
  );
}

function Audit() {
  const { t } = useT();
  const [action, setAction] = useState('');
  const { data } = useQ('audit.list', { limit: 300, action: action || undefined });
  return (
    <Card><div className="p-4"><Select className="w-64" value={action} onChange={(e) => setAction(e.target.value)}><option value="">{t('Toutes les actions')}</option>{['auth', 'sale', 'stock', 'product', 'user', 'role', 'finance', 'cash', 'security', 'company'].map((a) => <option key={a} value={a}>{a}.*</option>)}</Select></div>
      <DataTable dense rowKey={(r: any) => r.id} rows={(data ?? []) as any[]} columns={[{ key: 'd', header: 'Date', render: (r: any) => dateTime(r.at) }, { key: 'u', header: 'Utilisateur', render: (r: any) => r.username }, { key: 'a', header: 'Action', render: (r: any) => <code className="text-xs">{r.action}</code> }, { key: 'e', header: 'Détails', render: (r: any) => <span className="block max-w-md truncate text-xs text-ink-400">{r.details}</span> }]} /></Card>
  );
}

function Backup() {
  const { t } = useT();
  const { push } = useToast();
  const [confirm, setConfirm] = useState(false);
  const info = useQ('sync.status');
  const [data, setData] = useState<any>(null);
  const [backups, setBackups] = useState<any[]>([]);
  const load = async () => { setData(await system('info')); setBackups(await system('listBackups')); };
  useState(() => { void load(); });
  const doBackup = async () => { try { const p = await system('backup'); if (p) { push('success', `${t('Sauvegarde créée')} : ${p}`); void load(); } } catch (e) { push('error', (e as Error).message); } };
  const doRestore = async () => { try { await system('restore'); } catch (e) { push('error', (e as Error).message); } };
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="p-5"><h3 className="font-semibold">{t('Sauvegarde manuelle')}</h3><p className="mb-4 mt-1 text-sm text-ink-500">{t('Exportez une copie complète et cohérente de vos données (ventes, stock, clients, finances) vers un support externe.')}</p>
        <div className="flex flex-wrap gap-2"><Button variant="gold" icon={<DatabaseBackup className="size-4" />} onClick={doBackup}>{t('Créer une sauvegarde')}</Button><Button icon={<RotateCcw className="size-4" />} onClick={() => setConfirm(true)}>{t('Restaurer…')}</Button><Button variant="ghost" icon={<FolderOpen className="size-4" />} onClick={() => system('openDataFolder')}>{t('Dossier des données')}</Button></div>
        {data && <p className="mt-4 break-all text-xs text-ink-400">{t('Base de données')} : {data.dbPath}<br />v{data.version}</p>}</Card>
      <Card className="p-5"><h3 className="mb-1 flex items-center gap-2 font-semibold"><ShieldCheck className="size-4 text-emerald-500" />{t('Sauvegardes automatiques')}</h3><p className="mb-3 text-sm text-ink-500">{t('Une copie est créée chaque jour au démarrage (14 jours conservés).')}</p>
        <ul className="max-h-48 divide-y divide-ink-50 overflow-y-auto text-sm dark:divide-white/5">{backups.map((b) => <li key={b.name} className="flex justify-between py-1.5"><span>{b.name}</span><span className="text-ink-400">{(b.size / 1024).toFixed(0)} Ko</span></li>)}{!backups.length && <li className="py-3 text-ink-400">{t('Aucune sauvegarde pour le moment')}</li>}</ul>
        <p className="mt-3 text-xs text-ink-400">{t('Synchronisation : {n} opération(s) en attente de synchronisation cloud (non activée).', { n: info.data?.pending ?? 0 })}</p></Card>
      <UpdateCard version={data?.version} />
      <ConfirmDialog open={confirm} danger title="Restaurer une sauvegarde" message="Les données actuelles seront remplacées par la sauvegarde choisie (une copie de sécurité est créée avant). L'application redémarrera." confirmLabel="Choisir un fichier…" onClose={() => setConfirm(false)} onConfirm={doRestore} />
    </div>
  );
}
void money;

const RESET_PHRASE = 'TOUT EFFACER';
function ResetAll() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <Card className="max-w-3xl border-red-200 p-6 dark:border-red-400/30">
      <h3 className="flex items-center gap-2 text-lg font-semibold text-red-600 dark:text-red-400"><TriangleAlert className="size-5" />{t('Réinitialiser les données')}</h3>
      <p className="mt-2 text-sm text-ink-600 dark:text-ink-200">{t('Efface tout le contenu de gestion — produits, stocks, clients, fournisseurs, ventes, achats, caisses, dépenses et trésorerie — et remet les numérotations à 1, comme au premier jour.')}</p>
      <p className="mt-2 text-sm text-ink-600 dark:text-ink-200"><b>{t('Conservés :')}</b> {t('les comptes utilisateurs et leurs profils, les paramètres de l’entreprise, les boutiques, entrepôts et caisses, les modes de paiement, les taxes et le journal d’activité.')}</p>
      <p className="mt-2 text-sm font-semibold text-red-600 dark:text-red-400">{t('Cette action est définitive et ne peut pas être annulée.')}</p>
      <div className="mt-4"><Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setOpen(true)}>{t('Réinitialiser les données…')}</Button></div>
      <p className="mt-3 text-xs text-ink-400">{t('Réservé aux administrateurs. Votre mot de passe sera demandé.')}</p>
      {open && <ResetDialog onClose={() => setOpen(false)} />}
    </Card>
  );
}
function ResetDialog({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const { push } = useToast();
  const qc = useQueryClient();
  const [step, setStep] = useState<1 | 2>(1);
  const [deleteBackups, setDeleteBackups] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const ok = phrase.trim().toUpperCase() === RESET_PHRASE && password.length > 0;
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      await system('factoryReset', { password, confirm: phrase, deleteBackups });
      qc.clear(); // toutes les données affichées sont périmées
      push('success', t('Données réinitialisées. Les comptes et les paramètres sont conservés.'));
      onClose();
    } catch (e) { setErr(e); setBusy(false); }
  };
  return (
    <Modal open danger onClose={busy ? () => {} : onClose} size="md" title={step === 1 ? 'Attention : effacement des données' : 'Confirmer la réinitialisation'}
      footer={step === 1
        ? <><Button onClick={onClose}>{t('Annuler')}</Button><Button variant="danger" onClick={() => setStep(2)}>{t('Je comprends, continuer')}</Button></>
        : <><Button onClick={() => setStep(1)} disabled={busy}>{t('Retour')}</Button><Button variant="danger" loading={busy} disabled={!ok} onClick={go} icon={<Trash2 className="size-4" />}>{t('Effacer définitivement')}</Button></>}>
      {step === 1 ? (
        <div className="space-y-3 text-sm">
          <div className="flex gap-3 rounded-xl bg-red-50 p-3 text-red-700 dark:bg-red-400/10 dark:text-red-300"><TriangleAlert className="mt-0.5 size-5 shrink-0" /><p className="font-semibold">{t('Seront supprimés, définitivement :')}</p></div>
          <ul className="list-disc space-y-1 pl-6 text-ink-700 dark:text-ink-200">
            <li>{t('tous les produits, catégories, marques et stocks ;')}</li>
            <li>{t('tous les clients et fournisseurs, avec leurs comptes ;')}</li>
            <li>{t('toutes les ventes, factures, retours, paiements et achats ;')}</li>
            <li>{t('toutes les sessions de caisse, dépenses et la trésorerie (soldes remis à 0) ;')}</li>
            <li>{t('les numéros de documents (tickets, factures…) repartent de 1.')}</li>
          </ul>
          <div className="rounded-xl bg-emerald-50 p-3 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"><b>{t('Conservés :')}</b> {t('comptes utilisateurs et profils, paramètres de l’entreprise, boutiques, entrepôts, caisses, modes de paiement, taxes, journal d’activité.')}</div>
          <Checkbox checked={deleteBackups} onChange={setDeleteBackups} label="Supprimer aussi toutes les sauvegardes de cet ordinateur" />
          <p className="text-xs text-ink-400">{deleteBackups ? t('Aucune copie ne sera conservée : il sera impossible de récupérer ces données.') : t('Par sécurité, une copie des données actuelles est créée automatiquement avant l’effacement (dossier des sauvegardes).')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label={`Recopiez « ${RESET_PHRASE} » pour confirmer`}><Input autoFocus autoComplete="off" value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder={RESET_PHRASE} /></Field>
          <Field label="Votre mot de passe d’administrateur"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok && go()} /></Field>
          <ErrorBox error={err} />
        </div>
      )}
    </Modal>
  );
}
