import { useSearchParams } from 'react-router';
import { useAuditLogs, type AuditRow } from '../../api/platform';
import { AUDIT_LABELS, auditLabel } from '../../lib/audit-labels';
import { formatDate } from '../../lib/format';
import { useDocumentTitle } from '../../lib/use-title';
import { DataTable, EmptyState } from '../../ui/data';
import { Field, Select } from '../../ui/form';
import { PageHeader, Panel } from '../../ui/page';
import { HotelLink, Pager } from './parts';

/** Détails lisibles : on montre le motif et les valeurs utiles, jamais un JSON brut. */
function details(d: Record<string, unknown>) {
  const parts: string[] = [];
  if (typeof d.reason === 'string') parts.push(`Motif : ${d.reason}`);
  if (typeof d.plan === 'string') parts.push(`Formule : ${d.plan}`);
  if (typeof d.code === 'string') parts.push(`Code : ${d.code}`);
  if (typeof d.key === 'string') parts.push(`Réglage : ${d.key}`);
  if (typeof d.number === 'string') parts.push(`Facture ${d.number}`);
  if (d.from !== undefined && d.to !== undefined) parts.push(`${String(d.from)} → ${String(d.to)}`);
  if (Array.isArray(d.effects) && d.effects.length) parts.push(`Effets : ${d.effects.join(', ')}`);
  return parts.join(' · ');
}

export default function AuditPage() {
  useDocumentTitle("Journal d'audit — Console");
  const [params, setParams] = useSearchParams();
  const action = params.get('action') ?? 'all';
  const page = Number(params.get('page') ?? 1) || 1;
  const list = useAuditLogs({ action: action === 'all' ? undefined : action, page, pageSize: 50 });
  const set = (patch: Record<string, string>) => setParams(patch, { replace: true });
  return (
    <>
      <PageHeader title="Journal d'audit" description="Chaque action de la console, avec son auteur et l'établissement concerné. Le journal est en ajout seul : même la plateforme ne peut ni le modifier ni le supprimer." />
      <Panel>
        <div className="max-w-sm"><Field label="Type d'action">{(c) => <Select {...c} value={action} onValueChange={(v) => set({ action: v })} options={[{ value: 'all', label: 'Toutes les actions' }, ...Object.entries(AUDIT_LABELS).map(([value, label]) => ({ value, label }))]} />}</Field></div>
        {list.isError ? <p className="text-[14px] text-ink-2">Impossible de charger le journal.</p> : (
          <>
            <DataTable<AuditRow>
              caption="Journal d'audit de la plateforme"
              loading={list.isPending}
              rows={list.data?.items ?? []}
              rowKey={(r) => String(r.id)}
              columns={[
                { key: 'd', header: 'Date', cell: (r) => <span className="num-col whitespace-nowrap">{formatDate(r.createdAt, { time: true })}</span> },
                { key: 'a', header: 'Action', cell: (r) => <span className="font-medium">{auditLabel(r.action)}</span> },
                { key: 'by', header: 'Par', cell: (r) => r.adminEmail ?? '—' },
                { key: 'h', header: 'Établissement', cell: (r) => (r.hotelId ? <HotelLink id={r.hotelId} name="Voir la fiche" /> : '—') },
                { key: 'det', header: 'Détail', cell: (r) => <span className="text-ink-2">{details(r.details)}</span> },
              ]}
              mobileCard={(r) => <div className="flex flex-col gap-1"><span className="font-medium text-ink">{auditLabel(r.action)}</span><span className="text-[13px] text-ink-2">{formatDate(r.createdAt, { time: true })} · {r.adminEmail ?? '—'}</span><span className="text-[13px] text-ink-2">{details(r.details)}</span></div>}
              empty={<EmptyState kind="search" title="Aucune entrée" description="Aucune action ne correspond à ce filtre." />}
            />
            <Pager page={page} pageSize={50} total={list.data?.total ?? 0} onPage={(p) => set({ action, page: String(p) })} />
          </>
        )}
      </Panel>
    </>
  );
}
