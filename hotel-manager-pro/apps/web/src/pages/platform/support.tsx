import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { isApiError } from '../../api/client';
import { usePlatformTicket, usePlatformTickets, useReplyPlatformTicket, useUpdateTicket, type TicketRow } from '../../api/platform';
import type { TicketPriority, TicketStatus } from '../../api/types';
import { cn } from '../../lib/cn';
import { formatDate } from '../../lib/format';
import { TICKET_CATEGORY, TICKET_PRIORITY, TICKET_STATUS } from '../../lib/labels';
import { useDocumentTitle } from '../../lib/use-title';
import { Button } from '../../ui/button';
import { Badge, DataTable, EmptyState, Skeleton, StateBadge } from '../../ui/data';
import { Field, Select, Switch, Textarea } from '../../ui/form';
import { Drawer } from '../../ui/overlay';
import { Callout, PageHeader, Panel } from '../../ui/page';
import { HotelLink, Pager } from './parts';

function TicketDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = usePlatformTicket(id);
  const reply = useReplyPlatformTicket();
  const update = useUpdateTicket();
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = q.data?.ticket;

  const send = () => {
    if (!id) return;
    if (!body.trim()) return setError('Écrivez votre message avant de l\'envoyer.');
    setError(null);
    reply.mutate({ id, body: body.trim(), internal }, {
      onSuccess: () => { setBody(''); toast.success(internal ? 'Note interne ajoutée.' : 'Réponse envoyée à l\'établissement.'); },
      onError: (e) => setError(isApiError(e) ? e.message : "L'envoi a échoué."),
    });
  };
  const change = (patch: { status?: TicketStatus; priority?: TicketPriority; assignToMe?: boolean }) =>
    id && update.mutate({ id, ...patch }, { onError: (e) => toast.error(isApiError(e) ? e.message : 'La modification a échoué.') });

  return (
    <Drawer open={!!id} onOpenChange={(o) => !o && onClose()} title={t ? `${t.number} — ${t.subject}` : 'Demande'} description={t ? `${t.hotelName} · ${TICKET_CATEGORY[t.category]}` : undefined}>
      {q.isPending ? (
        <div role="status" className="flex flex-col gap-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-3/4" /><span className="sr-only">Chargement</span></div>
      ) : q.isError || !t ? (
        <p className="text-[14px] text-ink-2">Demande introuvable.</p>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="État">{(c) => <Select {...c} value={t.status} onValueChange={(v) => change({ status: v as TicketStatus })} options={Object.entries(TICKET_STATUS).map(([value, s]) => ({ value, label: s.label }))} />}</Field>
            <Field label="Priorité">{(c) => <Select {...c} value={t.priority} onValueChange={(v) => change({ priority: v as TicketPriority })} options={Object.entries(TICKET_PRIORITY).map(([value, label]) => ({ value, label }))} />}</Field>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[13px] text-ink-2">
            <HotelLink id={t.hotelId} name={t.hotelName} />
            {!t.assignedAdminId && <Button size="sm" variant="secondary" onClick={() => change({ assignToMe: true })}>M&apos;assigner</Button>}
          </div>
          <ol className="flex flex-col gap-3" aria-label="Échanges">
            {q.data.messages.map((m) => {
              const staff = m.authorKind === 'platform_admin';
              return (
                <li key={m.id} className={cn('flex max-w-[92%] flex-col gap-1 rounded-[16px] px-4 py-3', m.isInternal ? 'self-end border border-dashed border-field-border bg-[var(--st-pending-soft)]' : staff ? 'self-end bg-accent-soft' : 'self-start border border-hairline bg-[var(--glass-data)]')}>
                  <span className="text-[12.5px] font-medium text-ink-2">
                    {m.isInternal ? 'Note interne (invisible de l\'établissement)' : staff ? 'Support' : m.authorKind === 'system' ? 'Système' : 'Établissement'} · {formatDate(m.createdAt, { time: true })}
                  </span>
                  <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-ink">{m.body}</p>
                </li>
              );
            })}
          </ol>
          <div className="flex flex-col gap-3">
            <Field label={internal ? 'Note interne' : 'Votre réponse'} error={error ?? undefined}>{(c) => <Textarea {...c} value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={5000} />}</Field>
            <Switch label="Note interne" description="Visible par les administrateurs seulement ; ne change pas l'état visible de la demande." checked={internal} onCheckedChange={setInternal} />
            {!internal && <Callout>La réponse est envoyée à l&apos;établissement, qui la verra dans son espace.</Callout>}
            <Button variant="primary" className="self-start" loading={reply.isPending} onClick={send}>{internal ? 'Ajouter la note' : 'Répondre'}</Button>
          </div>
        </div>
      )}
    </Drawer>
  );
}

const PRIORITY_TONE: Record<TicketPriority, 'neutral' | 'accent' | 'champagne'> = { low: 'neutral', normal: 'neutral', high: 'champagne', urgent: 'champagne' };

export default function PlatformSupportPage() {
  useDocumentTitle('Assistance — Console');
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'all';
  const page = Number(params.get('page') ?? 1) || 1;
  const openId = params.get('open');
  const list = usePlatformTickets({ status: status === 'all' ? undefined : status, page, pageSize: 25 });
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v === null || v === 'all' ? next.delete(k) : next.set(k, v));
    if (!('page' in patch) && !('open' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };
  return (
    <>
      <PageHeader title="Assistance" description="Les demandes de tous les établissements, les plus urgentes d'abord." />
      <Panel>
        <div className="max-w-xs"><Field label="Afficher">{(c) => <Select {...c} value={status} onValueChange={(v) => set({ status: v })} options={[{ value: 'all', label: 'Toutes' }, ...Object.entries(TICKET_STATUS).map(([value, s]) => ({ value, label: s.label }))]} />}</Field></div>
        {list.isError ? <p className="text-[14px] text-ink-2">Impossible de charger les demandes.</p> : (
          <>
            <DataTable<TicketRow>
              caption="Demandes d'assistance"
              loading={list.isPending}
              rows={list.data?.items ?? []}
              rowKey={(r) => r.id}
              columns={[
                { key: 'p', header: 'Priorité', cell: (r) => <Badge tone={PRIORITY_TONE[r.priority]}>{TICKET_PRIORITY[r.priority]}</Badge> },
                { key: 'n', header: 'Demande', cell: (r) => <button type="button" onClick={() => set({ open: r.id })} className="flex cursor-pointer flex-col items-start text-left"><span className="font-medium text-accent-ink hover:underline">{r.subject}</span><span className="num-col text-[13px] text-ink-2">{r.number} · {TICKET_CATEGORY[r.category]}</span></button> },
                { key: 'h', header: 'Établissement', cell: (r) => <HotelLink id={r.hotelId} name={r.hotelName} /> },
                { key: 's', header: 'État', cell: (r) => <StateBadge tone={TICKET_STATUS[r.status].tone}>{TICKET_STATUS[r.status].label}</StateBadge> },
                { key: 'u', header: 'Dernière activité', cell: (r) => formatDate(r.updatedAt, { time: true }) },
              ]}
              mobileCard={(r) => <button type="button" onClick={() => set({ open: r.id })} className="flex w-full cursor-pointer flex-col gap-1.5 text-left"><span className="flex items-center justify-between gap-3"><span className="font-medium text-ink">{r.subject}</span><Badge tone={PRIORITY_TONE[r.priority]}>{TICKET_PRIORITY[r.priority]}</Badge></span><span className="text-[13px] text-ink-2">{r.hotelName} · {r.number}</span><StateBadge tone={TICKET_STATUS[r.status].tone}>{TICKET_STATUS[r.status].label}</StateBadge></button>}
              empty={<EmptyState kind="search" title="Aucune demande" description="Aucune demande ne correspond à ce filtre." />}
            />
            <Pager page={page} pageSize={25} total={list.data?.total ?? 0} onPage={(p) => set({ page: String(p) })} />
          </>
        )}
      </Panel>
      <TicketDrawer id={openId} onClose={() => set({ open: null })} />
    </>
  );
}
