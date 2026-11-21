import { LifeBuoy, Plus } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { isApiError } from '../../api/client';
import { useCreateTicket, useReplyTicket, useTicket, useTickets } from '../../api/hotel';
import type { TicketCategory, TicketPriority, TicketSummary } from '../../api/types';
import { useCan } from '../../auth/session';
import { feedbackFrom, requiredProblem, type FormFeedback } from '../../lib/forms';
import { formatDate } from '../../lib/format';
import { TICKET_CATEGORY, TICKET_PRIORITY, TICKET_STATUS } from '../../lib/labels';
import { cn } from '../../lib/cn';
import { Button } from '../../ui/button';
import { DataTable, EmptyState, Skeleton, StateBadge } from '../../ui/data';
import { Field, Input, Select, Textarea } from '../../ui/form';
import { Drawer, Modal } from '../../ui/overlay';
import { Callout, Panel } from '../../ui/page';

function NewTicketModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const create = useCreateTicket();
  const [v, setV] = useState({ subject: '', message: '' });
  const [category, setCategory] = useState<TicketCategory>('other');
  const [priority, setPriority] = useState<TicketPriority>('normal');
  const [feedback, setFeedback] = useState<FormFeedback>({ fields: {} });

  const submit = () => {
    const fields: Record<string, string> = {};
    const s = requiredProblem(v.subject, "L'objet", 3);
    if (s) fields.subject = s;
    const m = requiredProblem(v.message, 'Le message');
    if (m) fields.message = m;
    if (Object.keys(fields).length) return setFeedback({ fields });
    setFeedback({ fields: {} });
    create.mutate(
      { subject: v.subject.trim(), message: v.message.trim(), category, priority },
      {
        onSuccess: (r) => {
          toast.success(`Demande ${r.ticket.number} envoyée. Nous vous répondons dès que possible.`);
          onCreated(r.ticket.id);
        },
        onError: (e) => setFeedback(feedbackFrom(e)),
      },
    );
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Nouvelle demande"
      description="Décrivez votre question ou votre problème : plus c'est précis, plus la réponse sera rapide."
      width="34rem"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={create.isPending} onClick={submit}>Envoyer la demande</Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {feedback.general && <Callout tone="danger">{feedback.general}</Callout>}
        <Field label="Objet" error={feedback.fields.subject} required>{(c) => <Input {...c} value={v.subject} onChange={(e) => setV((s) => ({ ...s, subject: e.target.value }))} maxLength={200} />}</Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Sujet">{(c) => <Select {...c} value={category} onValueChange={(x) => setCategory(x as TicketCategory)} options={Object.entries(TICKET_CATEGORY).map(([value, label]) => ({ value, label }))} />}</Field>
          <Field label="Urgence">{(c) => <Select {...c} value={priority} onValueChange={(x) => setPriority(x as TicketPriority)} options={Object.entries(TICKET_PRIORITY).map(([value, label]) => ({ value, label }))} />}</Field>
        </div>
        <Field label="Message" error={feedback.fields.message} required>{(c) => <Textarea {...c} value={v.message} onChange={(e) => setV((s) => ({ ...s, message: e.target.value }))} rows={5} maxLength={5000} />}</Field>
      </div>
    </Modal>
  );
}

function TicketDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const ticket = useTicket(id);
  const reply = useReplyTicket(id ?? '');
  const can = useCan();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const t = ticket.data?.ticket;
  const closed = t?.status === 'closed';

  const send = () => {
    if (!body.trim()) return setError('Écrivez votre message avant de l\'envoyer.');
    setError(null);
    reply.mutate(body.trim(), {
      onSuccess: () => setBody(''),
      onError: (e) => setError(isApiError(e) ? e.message : "Le message n'a pas pu être envoyé."),
    });
  };

  return (
    <Drawer open={!!id} onOpenChange={(o) => !o && onClose()} title={t ? `${t.number} — ${t.subject}` : 'Demande'} description={t ? `${TICKET_CATEGORY[t.category]} · ouverte le ${formatDate(t.createdAt, { long: true })}` : undefined}>
      {ticket.isPending ? (
        <div role="status" className="flex flex-col gap-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-3/4" /><span className="sr-only">Chargement</span></div>
      ) : ticket.isError || !t ? (
        <p className="text-[14px] text-ink-2">Impossible de charger cette demande.</p>
      ) : (
        <div className="flex flex-col gap-5">
          <StateBadge tone={TICKET_STATUS[t.status].tone} className="self-start">{TICKET_STATUS[t.status].label}</StateBadge>
          <ol className="flex flex-col gap-3" aria-label="Échanges">
            {ticket.data.messages.map((m) => {
              const mine = m.authorKind === 'hotel_user';
              return (
                <li key={m.id} className={cn('flex max-w-[92%] flex-col gap-1 rounded-[16px] px-4 py-3', mine ? 'self-end bg-accent-soft' : 'self-start border border-hairline bg-[var(--glass-data)]')}>
                  <span className="text-[12.5px] font-medium text-ink-2">{m.authorName} · {formatDate(m.createdAt, { time: true })}</span>
                  <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-ink">{m.body}</p>
                </li>
              );
            })}
          </ol>
          {closed ? (
            <Callout>Cette demande est close. Ouvrez une nouvelle demande si besoin.</Callout>
          ) : can('support:create') ? (
            <div className="flex flex-col gap-3">
              <Field label="Votre réponse" error={error ?? undefined}>{(c) => <Textarea {...c} value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={5000} />}</Field>
              <Button variant="primary" className="self-start" loading={reply.isPending} onClick={send}>Envoyer</Button>
            </div>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}

/** Liste des demandes + création + fil de discussion. Utilisée dans Paramètres ET sur l'écran « compte suspendu » (l'assistance reste joignable). */
export function SupportPanel() {
  const tickets = useTickets();
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const openId = params.get('ticket');
  const open = (id: string | null) => setParams(id ? { ticket: id } : {}, { replace: true });
  const rows = tickets.data ?? [];

  return (
    <Panel
      title="Mes demandes"
      description="Posez une question, signalez un problème : notre équipe vous répond ici."
      actions={can('support:create') ? <Button variant="primary" onClick={() => setCreating(true)}><Plus aria-hidden className="size-4" />Nouvelle demande</Button> : undefined}
    >
      {tickets.isError ? (
        <p className="text-[14px] text-ink-2">Impossible de charger vos demandes pour le moment.</p>
      ) : (
        <DataTable<TicketSummary>
          caption="Demandes d'assistance"
          loading={tickets.isPending}
          rows={rows}
          rowKey={(r) => r.id}
          columns={[
            { key: 'number', header: 'N°', cell: (r) => <span className="num-col">{r.number}</span>, sortValue: (r) => r.number },
            { key: 'subject', header: 'Objet', cell: (r) => <button type="button" onClick={() => open(r.id)} className="cursor-pointer text-left font-medium text-accent-ink underline-offset-4 hover:underline">{r.subject}</button> },
            { key: 'cat', header: 'Sujet', cell: (r) => TICKET_CATEGORY[r.category] },
            { key: 'status', header: 'État', cell: (r) => <StateBadge tone={TICKET_STATUS[r.status].tone}>{TICKET_STATUS[r.status].label}</StateBadge> },
            { key: 'upd', header: 'Dernière activité', cell: (r) => formatDate(r.updatedAt, { time: true }), sortValue: (r) => r.updatedAt },
          ]}
          mobileCard={(r) => (
            <button type="button" onClick={() => open(r.id)} className="flex w-full cursor-pointer flex-col gap-2 text-left">
              <span className="flex items-center justify-between gap-3"><span className="font-medium text-ink">{r.subject}</span></span>
              <span className="flex items-center gap-2"><StateBadge tone={TICKET_STATUS[r.status].tone}>{TICKET_STATUS[r.status].label}</StateBadge></span>
              <span className="text-[13px] text-ink-2">{r.number} · {formatDate(r.updatedAt, { time: true })}</span>
            </button>
          )}
          empty={<EmptyState kind="search" title="Aucune demande" description="Une question ? Un problème ? Écrivez-nous, nous vous répondons ici." action={can('support:create') ? <Button variant="primary" onClick={() => setCreating(true)}><LifeBuoy aria-hidden className="size-4" />Écrire au support</Button> : undefined} />}
        />
      )}
      {creating && <NewTicketModal onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); open(id); }} />}
      <TicketDrawer id={openId} onClose={() => open(null)} />
    </Panel>
  );
}
