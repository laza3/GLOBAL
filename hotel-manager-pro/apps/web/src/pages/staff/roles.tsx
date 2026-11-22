import { Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { isApiError } from '../../api/client';
import { useDeleteRole, useRoles, useSaveRole, type Role } from '../../api/staff';
import { useCan, useMe } from '../../auth/session';
import { PERMISSION_GROUPS } from '../../lib/permission-labels';
import { useDocumentTitle } from '../../lib/use-title';
import { ActionModal } from '../../ui/action-modal';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/data';
import { Checkbox, Field, Input } from '../../ui/form';
import { ConfirmDialog } from '../../ui/overlay';
import { Callout, Panel } from '../../ui/page';

function RoleModal({ role, onClose }: { role: Role | null; onClose: () => void }) {
  const me = useMe();
  const save = useSaveRole();
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set(role?.permissions ?? ['reservations:read']));
  const toggle = (key: string, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(key); else n.delete(key); return n; });
  return (
    <ActionModal title={role ? `Modifier « ${role.name} »` : 'Nouveau rôle'} description="Vous ne pouvez accorder que des droits que vous avez vous-même. Les modifications s'appliquent immédiatement aux membres de ce rôle." confirmLabel="Enregistrer" width="44rem" onClose={onClose}
      onSubmit={() => {
        if (name.trim().length < 2) return 'Donnez un nom au rôle.';
        if (selected.size === 0) return 'Cochez au moins un droit.';
        return save.mutateAsync({ id: role?.id, body: { name: name.trim(), description: description.trim() || null, permissions: [...selected] } }).then(() => void toast.success('Rôle enregistré.'));
      }}>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Nom" required>{(c) => <Input {...c} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus />}</Field>
        <Field label="Description (facultatif)">{(c) => <Input {...c} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />}</Field>
      </div>
      <div className="flex max-h-[22rem] flex-col gap-4 overflow-y-auto pr-1">
        {PERMISSION_GROUPS.map((g) => (
          <fieldset key={g.title} className="flex flex-col gap-2">
            <legend className="mb-1 text-[13px] font-semibold text-ink-2">{g.title}</legend>
            {g.items.map((p) => {
              const allowed = me.permissions.includes(p.key);
              return <Checkbox key={p.key} label={`${p.label}${allowed ? '' : ' (vous ne l\'avez pas)'}`} checked={selected.has(p.key)} disabled={!allowed && !role?.permissions.includes(p.key)} onCheckedChange={(v) => toggle(p.key, v === true)} />;
            })}
          </fieldset>
        ))}
      </div>
    </ActionModal>
  );
}

export default function RolesPage() {
  useDocumentTitle('Rôles et permissions');
  const can = useCan();
  const roles = useRoles();
  const del = useDeleteRole();
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  const [removing, setRemoving] = useState<Role | null>(null);
  const manage = can('staff:manage');
  const me = useMe();
  const customAllowed = !!me.entitlements.features.staff_permissions;
  return (
    <>
      <Panel title="Rôles et permissions" description="Un rôle regroupe des droits. Les rôles prédéfinis couvrent les postes courants ; les formules Business et supérieures permettent d'en créer sur mesure." actions={manage && customAllowed ? <Button variant="primary" onClick={() => setEditing('new')}><Plus aria-hidden className="size-4" />Nouveau rôle</Button> : undefined}>
        {!customAllowed && <Callout tone="info">Les rôles personnalisés ne sont pas inclus dans votre formule. Les rôles prédéfinis ci-dessous restent utilisables.</Callout>}
        <ul className="grid gap-3 lg:grid-cols-2" aria-label="Rôles">
          {(roles.data ?? []).map((r) => (
            <li key={r.id} className="flex flex-col gap-2 rounded-[16px] border border-hairline bg-[var(--glass-data)] p-4">
              <span className="flex items-start justify-between gap-2"><span className="flex flex-col"><span className="text-[15px] font-semibold text-ink">{r.name}</span>{r.description && <span className="text-[13px] text-ink-2">{r.description}</span>}</span>{r.isSystem ? <Badge>Prédéfini</Badge> : <Badge tone="accent">Personnalisé</Badge>}</span>
              <span className="text-[13px] text-ink-2">{r.members} membre{r.members > 1 ? 's' : ''} · {r.permissions.length} droit{r.permissions.length > 1 ? 's' : ''}</span>
              <details className="text-[13px]"><summary className="min-h-8 cursor-pointer text-accent-ink">Voir les droits</summary>
                <ul className="mt-1 flex flex-col gap-0.5 text-ink-2">{PERMISSION_GROUPS.flatMap((g) => g.items).filter((p) => r.permissions.includes(p.key)).map((p) => <li key={p.key}>{p.label}</li>)}</ul>
              </details>
              {manage && customAllowed && !r.isSystem && (
                <span className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setEditing(r)} aria-label={`Modifier le rôle ${r.name}`}>Modifier</Button><Button size="sm" variant="ghost" onClick={() => setRemoving(r)} aria-label={`Supprimer le rôle ${r.name}`}>Supprimer</Button></span>
              )}
            </li>
          ))}
        </ul>
      </Panel>
      {editing && <RoleModal role={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} title="Supprimer ce rôle ?" description={removing ? `« ${removing.name} » sera supprimé. Possible seulement si aucun membre ne l'a.` : ''} confirmLabel="Supprimer le rôle" loading={del.isPending}
        onConfirm={() => removing && del.mutate(removing.id, { onSuccess: () => { setRemoving(null); toast.success('Rôle supprimé.'); }, onError: (e) => { setRemoving(null); toast.error(isApiError(e) ? e.message : 'La suppression a échoué.'); } })} />
    </>
  );
}
