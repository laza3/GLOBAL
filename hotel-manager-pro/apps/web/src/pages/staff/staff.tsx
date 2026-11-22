import { Copy, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { isApiError } from '../../api/client';
import { useCreateStaff, useRoles, useStaff, useUpdateStaff, useResetPassword, type StaffMember } from '../../api/staff';
import { useCan, useMe } from '../../auth/session';
import { formatDate } from '../../lib/format';
import { useDocumentTitle } from '../../lib/use-title';
import { ActionModal } from '../../ui/action-modal';
import { Button } from '../../ui/button';
import { Badge, DataTable, EmptyState, StateBadge } from '../../ui/data';
import { Field, Input, Select } from '../../ui/form';
import { ConfirmDialog, Modal } from '../../ui/overlay';
import { Callout, Panel } from '../../ui/page';

/** Mot de passe provisoire : montré UNE fois, avec les consignes pour le remettre à l'employé. */
function SecretModal({ title, email, password, onClose }: { title: string; email?: string; password: string; onClose: () => void }) {
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={title} description="Ce mot de passe ne sera plus jamais affiché. Aucun e-mail n'est envoyé : remettez-le à l'employé en main propre." footer={<Button variant="primary" onClick={onClose}>J'ai noté le mot de passe</Button>}>
      <div className="flex flex-col gap-4">
        {email && <p className="text-[14px] text-ink-2">Identifiant : <strong className="text-ink">{email}</strong></p>}
        <div className="flex items-center justify-between gap-3 rounded-[14px] bg-silver-soft px-4 py-3">
          <code className="num-col text-[18px] font-semibold tracking-wide text-ink" data-testid="temporary-password">{password}</code>
          <Button size="sm" variant="secondary" onClick={() => { void navigator.clipboard?.writeText(password).then(() => toast.success('Copié.')); }} aria-label="Copier le mot de passe"><Copy aria-hidden className="size-4" />Copier</Button>
        </div>
        <Callout tone="info">L'employé devra le remplacer par un mot de passe personnel dès sa première connexion (rubrique « Mon compte »).</Callout>
      </div>
    </Modal>
  );
}

function AddModal({ onClose, onCreated }: { onClose: () => void; onCreated: (email: string, password: string) => void }) {
  const roles = useRoles();
  const create = useCreateStaff();
  const me = useMe();
  const [v, setV] = useState({ fullName: '', email: '', jobTitle: '' });
  const [roleId, setRoleId] = useState('');
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  // On ne propose que les rôles dont on possède toutes les permissions (le serveur refuse le reste)
  const options = (roles.data ?? []).filter((r) => r.permissions.every((p) => me.permissions.includes(p)));
  return (
    <ActionModal title="Ajouter un membre du personnel" description="Un compte est créé avec un mot de passe provisoire, affiché une seule fois à l'étape suivante." confirmLabel="Créer le compte" onClose={onClose}
      onSubmit={() => {
        if (v.fullName.trim().length < 2) return 'Indiquez le nom complet.';
        if (!/^\S+@\S+\.\S+$/.test(v.email.trim())) return "L'adresse e-mail n'est pas valide.";
        if (!roleId) return 'Choisissez un rôle.';
        return create.mutateAsync({ fullName: v.fullName.trim(), email: v.email.trim(), roleId, jobTitle: v.jobTitle.trim() || null }).then((r) => void onCreated(r.email, r.temporaryPassword));
      }}>
      <Field label="Nom complet" required>{(c) => <Input {...c} value={v.fullName} onChange={set('fullName')} maxLength={120} autoFocus />}</Field>
      <Field label="Adresse e-mail" required hint="Sert d'identifiant de connexion.">{(c) => <Input {...c} type="email" value={v.email} onChange={set('email')} autoComplete="off" />}</Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Rôle" required>{(c) => <Select {...c} value={roleId} onValueChange={setRoleId} placeholder="Choisir un rôle" options={options.map((r) => ({ value: r.id, label: r.name }))} />}</Field>
        <Field label="Fonction (facultatif)">{(c) => <Input {...c} value={v.jobTitle} onChange={set('jobTitle')} maxLength={80} placeholder="Réceptionniste de nuit" />}</Field>
      </div>
    </ActionModal>
  );
}

function EditModal({ member, onClose }: { member: StaffMember; onClose: () => void }) {
  const roles = useRoles();
  const update = useUpdateStaff();
  const me = useMe();
  const self = member.userId === me.user.id;
  const [roleId, setRoleId] = useState(member.roleId);
  const [jobTitle, setJobTitle] = useState(member.jobTitle ?? '');
  const options = (roles.data ?? []).filter((r) => r.id === member.roleId || r.permissions.every((p) => me.permissions.includes(p)));
  return (
    <ActionModal title={`Modifier ${member.fullName}`} description={self ? 'Vous ne pouvez pas changer votre propre rôle.' : 'Le changement de rôle prend effet immédiatement.'} confirmLabel="Enregistrer" onClose={onClose}
      onSubmit={() => {
        const body: Record<string, unknown> = {};
        if (roleId !== member.roleId) body.roleId = roleId;
        if (jobTitle.trim() !== (member.jobTitle ?? '')) body.jobTitle = jobTitle.trim() || null;
        if (Object.keys(body).length === 0) return 'Aucune modification.';
        return update.mutateAsync({ id: member.id, body }).then(() => void toast.success('Membre modifié.'));
      }}>
      <Field label="Rôle">{(c) => <Select {...c} value={roleId} onValueChange={setRoleId} disabled={self} options={options.map((r) => ({ value: r.id, label: r.name }))} />}</Field>
      <Field label="Fonction">{(c) => <Input {...c} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} maxLength={80} />}</Field>
    </ActionModal>
  );
}

export default function StaffPage() {
  useDocumentTitle('Personnel');
  const can = useCan();
  const me = useMe();
  const staff = useStaff();
  const update = useUpdateStaff();
  const reset = useResetPassword();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [secret, setSecret] = useState<{ title: string; email?: string; password: string } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'disable' | 'reset'; member: StaffMember } | null>(null);
  const manage = can('staff:manage');
  const fail = (e: unknown) => { setConfirm(null); toast.error(isApiError(e) ? e.message : "L'action a échoué."); };

  return (
    <>
      <Panel title="Équipe" description="Les personnes qui se connectent à votre établissement, et ce qu'elles ont le droit de faire." actions={manage ? <Button variant="primary" onClick={() => setAdding(true)}><Plus aria-hidden className="size-4" />Ajouter un membre</Button> : undefined}>
        {staff.isError ? <p className="text-[14px] text-ink-2">Impossible de charger le personnel.</p> : (
          <DataTable<StaffMember>
            caption="Personnel"
            loading={staff.isPending}
            rows={staff.data ?? []}
            rowKey={(r) => r.id}
            columns={[
              { key: 'n', header: 'Nom', cell: (r) => <span className="flex flex-col"><span className="font-medium text-ink">{r.fullName}{r.userId === me.user.id ? ' (vous)' : ''}</span><span className="text-[13px] text-ink-2">{r.email}</span></span>, sortValue: (r) => r.fullName },
              { key: 'r', header: 'Rôle', cell: (r) => <span className="flex flex-col"><span>{r.roleName}</span>{r.jobTitle && <span className="text-[13px] text-ink-2">{r.jobTitle}</span>}</span> },
              { key: 's', header: 'État', cell: (r) => <span className="flex flex-col items-start gap-1">{r.status === 'active' ? <StateBadge tone="success">Actif</StateBadge> : <Badge>Désactivé</Badge>}{r.mustChangePassword && <StateBadge tone="warning">Mot de passe provisoire</StateBadge>}</span> },
              { key: 'l', header: 'Dernière connexion', cell: (r) => (r.lastLoginAt ? formatDate(r.lastLoginAt, { time: true }) : <span className="text-ink-3">Jamais</span>) },
              { key: 'a', header: 'Actions', cell: (r) => (manage && r.userId !== me.user.id ? (
                <span className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(r)} aria-label={`Modifier ${r.fullName}`}>Modifier</Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'reset', member: r })} aria-label={`Réinitialiser le mot de passe de ${r.fullName}`}>Mot de passe</Button>
                  {r.status === 'active'
                    ? <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'disable', member: r })} aria-label={`Désactiver ${r.fullName}`}>Désactiver</Button>
                    : <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: r.id, body: { status: 'active' } }, { onSuccess: () => toast.success('Compte réactivé.'), onError: fail })} aria-label={`Réactiver ${r.fullName}`}>Réactiver</Button>}
                </span>
              ) : manage ? <Button size="sm" variant="secondary" onClick={() => setEditing(r)} aria-label="Modifier ma fonction">Ma fonction</Button> : null) },
            ]}
            mobileCard={(r) => <div className="flex flex-col gap-1"><span className="flex items-center justify-between gap-3"><span className="font-medium text-ink">{r.fullName}</span>{r.status === 'active' ? <StateBadge tone="success">Actif</StateBadge> : <Badge>Désactivé</Badge>}</span><span className="text-[13px] text-ink-2">{r.email} · {r.roleName}</span>{manage && r.userId !== me.user.id && <span className="flex gap-2 pt-1"><Button size="sm" variant="secondary" onClick={() => setEditing(r)}>Modifier</Button></span>}</div>}
            empty={<EmptyState kind="key" title="Aucun membre" description="Ajoutez les personnes qui travaillent avec vous." />}
          />
        )}
      </Panel>
      {adding && <AddModal onClose={() => setAdding(false)} onCreated={(email, password) => setSecret({ title: 'Compte créé', email, password })} />}
      {editing && <EditModal member={editing} onClose={() => setEditing(null)} />}
      {secret && <SecretModal {...secret} onClose={() => setSecret(null)} />}
      <ConfirmDialog
        open={confirm?.kind === 'disable'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Désactiver ce compte ?"
        description={confirm ? `${confirm.member.fullName} ne pourra plus se connecter et sera déconnecté immédiatement. Son historique est conservé. Vous pourrez le réactiver.` : ''}
        confirmLabel="Désactiver"
        loading={update.isPending}
        onConfirm={() => confirm && update.mutate({ id: confirm.member.id, body: { status: 'disabled' } }, { onSuccess: () => { setConfirm(null); toast.success('Compte désactivé.'); }, onError: fail })}
      />
      <ConfirmDialog
        open={confirm?.kind === 'reset'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Réinitialiser le mot de passe ?"
        description={confirm ? `Un nouveau mot de passe provisoire est créé pour ${confirm.member.fullName}, affiché une seule fois. L'ancien cesse de fonctionner et ses sessions sont fermées.` : ''}
        confirmLabel="Réinitialiser"
        destructive={false}
        loading={reset.isPending}
        onConfirm={() => confirm && reset.mutate(confirm.member.id, { onSuccess: (r) => { setSecret({ title: 'Nouveau mot de passe provisoire', email: confirm.member.email, password: r.temporaryPassword }); setConfirm(null); }, onError: fail })}
      />
    </>
  );
}
