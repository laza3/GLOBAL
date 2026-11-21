import { MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { isApiError } from '../../api/client';
import { useLicenseAction, useLicenses, type LicenseRow } from '../../api/platform';
import { formatDate } from '../../lib/format';
import { useDocumentTitle } from '../../lib/use-title';
import { Button } from '../../ui/button';
import { DataTable, EmptyState, StateBadge } from '../../ui/data';
import { Field, Input } from '../../ui/form';
import { Menu, Modal, type MenuItem } from '../../ui/overlay';
import { Callout, PageHeader, Panel } from '../../ui/page';
import { HotelLink, ReasonModal } from './parts';

const STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  active: { label: 'Active', tone: 'success' },
  pending: { label: 'En attente de paiement', tone: 'warning' },
  suspended: { label: 'Suspendue', tone: 'warning' },
  revoked: { label: 'Révoquée', tone: 'danger' },
};

function MaintenanceModal({ license, onClose }: { license: LicenseRow; onClose: () => void }) {
  const act = useLicenseAction();
  const [until, setUntil] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!until) return setError('Choisissez la nouvelle date de fin de maintenance.');
    setError(null);
    setBusy(true);
    try {
      await act.mutateAsync({ id: license.id, action: 'extend-maintenance', until: new Date(`${until}T23:59:59Z`).toISOString() });
      toast.success('Maintenance prolongée.');
      onClose();
    } catch (e) {
      setError(isApiError(e) ? e.message : "L'action a échoué.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Prolonger la maintenance" description={`${license.hotelName} — ${license.editionCode}. La maintenance couvre les mises à jour et le support ; l'usage de la licence ne dépend pas d'elle.`}
      footer={<><Button variant="secondary" onClick={onClose}>Annuler</Button><Button variant="primary" loading={busy} onClick={() => void submit()}>Prolonger</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Maintenance jusqu'au" required>{(c) => <Input {...c} type="date" value={until} onChange={(e) => setUntil(e.target.value)} />}</Field>
        {error && <Callout tone="danger">{error}</Callout>}
      </div>
    </Modal>
  );
}

export default function LicensesPage() {
  useDocumentTitle('Licences — Console');
  const list = useLicenses();
  const act = useLicenseAction();
  const [mode, setMode] = useState<{ license: LicenseRow; kind: 'suspend' | 'revoke' | 'maintenance' } | null>(null);

  const menu = (l: LicenseRow): MenuItem[] => [
    { label: 'Prolonger la maintenance', onSelect: () => setMode({ license: l, kind: 'maintenance' }), disabled: l.status === 'revoked' },
    ...(l.status === 'active' ? [{ label: 'Suspendre', onSelect: () => setMode({ license: l, kind: 'suspend' }) }] : []),
    ...(l.status === 'suspended' ? [{ label: 'Rétablir', onSelect: () => act.mutate({ id: l.id, action: 'reinstate' }, { onSuccess: () => toast.success('Licence rétablie.'), onError: (e) => toast.error(isApiError(e) ? e.message : "L'action a échoué.") }) }] : []),
    ...(l.status !== 'revoked' ? [{ label: 'Révoquer (définitif)', destructive: true, separated: true, onSelect: () => setMode({ license: l, kind: 'revoke' }) }] : []),
  ];

  return (
    <>
      <PageHeader title="Licences définitives" description="Droit d'usage perpétuel, vendu à un établissement. La clé n'est jamais ré-affichée : seul son préfixe est conservé. Pour émettre une licence, ouvrez la fiche de l'établissement." />
      <Panel>
        {list.isError ? <p className="text-[14px] text-ink-2">Impossible de charger les licences.</p> : (
          <DataTable<LicenseRow>
            caption="Licences"
            loading={list.isPending}
            rows={list.data ?? []}
            rowKey={(r) => r.id}
            columns={[
              { key: 'h', header: 'Établissement', cell: (r) => <HotelLink id={r.hotelId} name={r.hotelName} /> },
              { key: 'e', header: 'Édition', cell: (r) => <span className="font-medium">{r.editionCode}</span> },
              { key: 'k', header: 'Clé', cell: (r) => <span className="num-col">{r.keyPrefix}…</span> },
              { key: 'l', header: 'Limites', cell: (r) => `${r.maxRooms ?? '∞'} ch. · ${r.maxUsers ?? '∞'} util.` },
              { key: 'm', header: 'Maintenance', cell: (r) => (r.maintenanceUntil ? formatDate(r.maintenanceUntil) : 'Sans fin') },
              { key: 's', header: 'État', cell: (r) => <StateBadge tone={STATUS[r.status]?.tone ?? 'neutral'}>{STATUS[r.status]?.label ?? r.status}</StateBadge> },
              { key: 'a', header: 'Actions', cell: (r) => <Menu trigger={<Button variant="ghost" size="icon-sm" aria-label={`Actions sur la licence ${r.editionCode} de ${r.hotelName}`}><MoreHorizontal aria-hidden className="size-4" /></Button>} items={menu(r)} /> },
            ]}
            mobileCard={(r) => <div className="flex flex-col gap-1.5"><div className="flex items-center justify-between gap-3"><HotelLink id={r.hotelId} name={r.hotelName} /><StateBadge tone={STATUS[r.status]?.tone ?? 'neutral'}>{STATUS[r.status]?.label ?? r.status}</StateBadge></div><span className="text-[14px] text-ink">{r.editionCode} · {r.keyPrefix}…</span></div>}
            empty={<EmptyState kind="key" title="Aucune licence" description="Les licences définitives émises apparaîtront ici." />}
          />
        )}
      </Panel>
      {mode?.kind === 'maintenance' && <MaintenanceModal license={mode.license} onClose={() => setMode(null)} />}
      {mode && mode.kind !== 'maintenance' && (
        <ReasonModal
          title={mode.kind === 'revoke' ? 'Révoquer la licence' : 'Suspendre la licence'}
          description={`${mode.license.hotelName} — ${mode.license.editionCode}. ${mode.kind === 'revoke' ? 'Définitif : la licence ne pourra plus être rétablie.' : "L'établissement revient à son abonnement tant que la licence est suspendue."}`}
          confirmLabel={mode.kind === 'revoke' ? 'Révoquer' : 'Suspendre'}
          destructive
          onSubmit={(reason) => act.mutateAsync({ id: mode.license.id, action: mode.kind as 'revoke' | 'suspend', reason }).then(() => void toast.success(mode.kind === 'revoke' ? 'Licence révoquée.' : 'Licence suspendue.'))}
          onClose={() => setMode(null)}
        />
      )}
    </>
  );
}
