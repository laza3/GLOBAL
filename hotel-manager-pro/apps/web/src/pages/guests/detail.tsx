import { formatMoney } from '@hmp/shared';
import { ArrowLeft, Eye, Merge, PencilLine, Plus, ShieldOff, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { isApiError } from '../../api/client';
import { revealDocument, useDeleteDocument, useGuest } from '../../api/guests';
import { useCan } from '../../auth/session';
import { formatDate } from '../../lib/format';
import { useDocumentTitle } from '../../lib/use-title';
import { Button } from '../../ui/button';
import { Badge, DataTable, Skeleton, StateBadge, VipBadge } from '../../ui/data';
import { ConfirmDialog, Modal } from '../../ui/overlay';
import { Callout, DefinitionList, PageHeader, Panel } from '../../ui/page';
import { AnonymizeDialog, DOC_LABEL, DocumentModal, GuestModal, MergeModal, NoteModal } from './modals';

const STAY_STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }> = {
  tentative: { label: 'Option', tone: 'warning' }, pending: { label: 'En attente', tone: 'warning' }, confirmed: { label: 'Confirmée', tone: 'info' },
  checked_in: { label: 'En séjour', tone: 'success' }, checked_out: { label: 'Terminé', tone: 'neutral' }, cancelled: { label: 'Annulée', tone: 'danger' }, no_show: { label: 'Absent', tone: 'danger' },
};

/** Le numéro complet n'apparaît que dans cette fenêtre, 30 secondes, et sa consultation est journalisée côté serveur. */
function RevealModal({ guestId, docId, label, onClose }: { guestId: string; docId: string; label: string; onClose: () => void }) {
  const [number, setNumber] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(30);
  useEffect(() => {
    let alive = true;
    revealDocument(guestId, docId).then((r) => alive && setNumber(r.number), (e) => alive && setError(isApiError(e) ? e.message : 'Lecture impossible.'));
    return () => { alive = false; };
  }, [guestId, docId]);
  useEffect(() => {
    if (!number) return;
    const id = setInterval(() => setLeft((l) => l - 1), 1000);
    return () => clearInterval(id);
  }, [number]);
  useEffect(() => { if (left <= 0) onClose(); }, [left, onClose]);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={label} description="Cette consultation est enregistrée dans le journal." footer={<Button variant="secondary" onClick={onClose}>Masquer</Button>}>
      {error ? <Callout tone="danger">{error}</Callout> : number ? (
        <div className="flex flex-col gap-2">
          <p className="num-col text-[22px] font-semibold tracking-wide text-ink" data-testid="document-number">{number}</p>
          <p className="text-[13px] text-ink-2" role="status">Masqué automatiquement dans {left} s.</p>
        </div>
      ) : <Skeleton className="h-8 w-48" />}
    </Modal>
  );
}

export default function GuestDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const can = useCan();
  const q = useGuest(id);
  const delDoc = useDeleteDocument();
  const [modal, setModal] = useState<'edit' | 'merge' | 'anonymize' | 'note' | 'doc' | null>(null);
  const [revealing, setRevealing] = useState<{ id: string; label: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  useDocumentTitle(q.data ? `${q.data.guest.firstName} ${q.data.guest.lastName}` : 'Client');

  if (q.isPending) return <div role="status" className="flex flex-col gap-4"><Skeleton className="h-10 w-1/3" /><Skeleton className="h-48 w-full rounded-[22px]" /><span className="sr-only">Chargement</span></div>;
  if (q.isError || !q.data) return <Panel><p className="text-[14px] text-ink-2">Client introuvable.</p><Link to="/guests" className="text-accent-ink underline">Retour à la liste</Link></Panel>;

  const { guest: g, notes, documents, stays, stats } = q.data;
  const manage = can('guests:manage');
  const anonymized = !!g.anonymizedAt;
  const merged = !!g.mergedIntoId;

  return (
    <>
      <Link to="/guests" className="inline-flex items-center gap-1.5 self-start text-[14px] text-ink-2 hover:text-ink"><ArrowLeft aria-hidden className="size-4" />Tous les clients</Link>
      <PageHeader
        title={`${g.firstName} ${g.lastName}`}
        description={anonymized ? 'Client anonymisé : les données personnelles ont été effacées.' : merged ? 'Cette fiche a été fusionnée dans une autre.' : `Client depuis le ${formatDate(g.createdAt, { long: true })}`}
        actions={
          manage && !anonymized && !merged ? (
            <>
              {g.isVip && <VipBadge />}
              <Button variant="primary" onClick={() => setModal('edit')}><PencilLine aria-hidden className="size-4" />Modifier</Button>
              <Button variant="secondary" onClick={() => setModal('merge')}><Merge aria-hidden className="size-4" />Fusionner</Button>
              <Button variant="ghost" onClick={() => setModal('anonymize')}><ShieldOff aria-hidden className="size-4" />Anonymiser</Button>
            </>
          ) : g.isVip ? <VipBadge /> : undefined
        }
      />
      {merged && <Callout><Link to={`/guests/${g.mergedIntoId}`} className="underline">Ouvrir la fiche conservée</Link></Callout>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Coordonnées" className="lg:col-span-2">
          <DefinitionList items={[
            { label: 'E-mail', value: g.email ?? '—' }, { label: 'Téléphone', value: g.phone ?? '—' },
            { label: 'Date de naissance', value: g.birthDate ? formatDate(`${g.birthDate}T12:00:00Z`, { long: true, timeZone: 'UTC' }) : '—' },
            { label: 'Adresse', value: [g.address, g.city, g.country].filter(Boolean).join(', ') || '—' },
            { label: 'Nationalité', value: g.nationality ?? '—' },
            { label: 'Communications', value: g.marketingConsent ? 'Consentement donné' : 'Pas de consentement' },
          ]} />
          {g.tags.length > 0 && <div className="flex flex-wrap gap-1.5">{g.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>}
          {Object.keys(g.preferences).length > 0 && (
            <div className="flex flex-col gap-1.5"><h3 className="text-[14px] font-medium text-ink">Préférences</h3>
              <ul className="flex flex-col gap-1 text-[14px] text-ink-2">{Object.entries(g.preferences).map(([k, v]) => <li key={k}><span className="font-medium text-ink">{k}</span> : {v}</li>)}</ul></div>
          )}
        </Panel>
        <Panel title="En un coup d'œil">
          <dl className="grid grid-cols-2 gap-4">
            <div><dt className="text-[13px] text-ink-2">Séjours terminés</dt><dd className="num-display text-[28px] leading-none font-semibold text-ink">{stats.stays}</dd></div>
            <div><dt className="text-[13px] text-ink-2">Nuits</dt><dd className="num-display text-[28px] leading-none font-semibold text-ink">{stats.nights}</dd></div>
          </dl>
          <div className="flex flex-col gap-1"><span className="text-[13px] text-ink-2">Total dépensé</span>
            {stats.spentByCurrency.length === 0 ? <span className="text-[14px] text-ink-2">—</span> : stats.spentByCurrency.map((s) => <span key={s.currency} className="num-col text-[17px] font-semibold text-ink">{formatMoney(s.amount, s.currency)}</span>)}</div>
        </Panel>
      </div>

      <Panel title="Séjours">
        <DataTable
          caption="Séjours du client"
          rows={stays}
          rowKey={(r) => r.id}
          columns={[
            { key: 'r', header: 'Réservation', cell: (r) => <Link to={`/reservations/${r.id}`} className="num-col font-medium text-accent-ink hover:underline">{r.reference}</Link> },
            { key: 'd', header: 'Dates', cell: (r) => `${formatDate(`${r.checkIn}T12:00:00Z`, { timeZone: 'UTC' })} → ${formatDate(`${r.checkOut}T12:00:00Z`, { timeZone: 'UTC' })}` },
            { key: 'n', header: 'Nuits', align: 'right', cell: (r) => r.nights },
            { key: 't', header: 'Total', align: 'right', cell: (r) => formatMoney(r.totalAmount, r.currency) },
            { key: 's', header: 'État', cell: (r) => <StateBadge tone={STAY_STATUS[r.status]?.tone ?? 'neutral'}>{STAY_STATUS[r.status]?.label ?? r.status}</StateBadge> },
          ]}
          empty={<p className="px-6 py-8 text-center text-[14px] text-ink-2">Aucun séjour pour le moment.</p>}
        />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Notes" description="Ajout seul : une note ne se modifie pas." actions={manage && !anonymized ? <Button variant="secondary" size="sm" onClick={() => setModal('note')}><Plus aria-hidden className="size-4" />Ajouter</Button> : undefined}>
          {notes.length === 0 ? <p className="text-[14px] text-ink-2">Aucune note.</p> : (
            <ul className="flex flex-col gap-3">{notes.map((n) => <li key={n.id} className="flex flex-col gap-1 rounded-[14px] border border-hairline bg-[var(--glass-data)] p-3.5"><span className="text-[12.5px] font-medium text-ink-2">{n.author ?? 'Équipe'} · {formatDate(n.createdAt, { time: true })}</span><p className="text-[14px] leading-relaxed whitespace-pre-wrap text-ink">{n.body}</p></li>)}</ul>
          )}
        </Panel>
        <Panel title="Pièces d'identité" description="Les numéros sont chiffrés. Leur consultation exige une autorisation et est journalisée." actions={manage && !anonymized && !merged ? <Button variant="secondary" size="sm" onClick={() => setModal('doc')}><Plus aria-hidden className="size-4" />Ajouter</Button> : undefined}>
          {documents.length === 0 ? <p className="text-[14px] text-ink-2">Aucune pièce enregistrée.</p> : (
            <ul className="flex flex-col gap-2">
              {documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-hairline bg-[var(--glass-data)] p-3.5">
                  <span className="flex flex-col"><span className="text-[14px] font-medium text-ink">{DOC_LABEL[d.docType] ?? d.docType}</span><span className="num-col text-[13px] text-ink-2">•••• {d.last4}{d.expiresOn ? ` · expire le ${formatDate(`${d.expiresOn}T12:00:00Z`, { timeZone: 'UTC' })}` : ''}</span></span>
                  <span className="flex gap-2">
                    {can('guests:read_id_document') && <Button size="sm" variant="secondary" onClick={() => setRevealing({ id: d.id, label: DOC_LABEL[d.docType] ?? 'Pièce' })} aria-label={`Afficher le numéro complet : ${DOC_LABEL[d.docType] ?? d.docType}`}><Eye aria-hidden className="size-4" />Afficher</Button>}
                    {manage && <Button size="sm" variant="ghost" onClick={() => setRemoving(d.id)} aria-label={`Supprimer la pièce ${DOC_LABEL[d.docType] ?? d.docType}`}><Trash2 aria-hidden className="size-4" /></Button>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {modal === 'edit' && <GuestModal guest={g} onClose={() => setModal(null)} />}
      {modal === 'merge' && <MergeModal guest={g} onClose={() => setModal(null)} onMerged={(into) => { setModal(null); navigate(`/guests/${into}`); }} />}
      {modal === 'anonymize' && <AnonymizeDialog guest={g} onClose={() => setModal(null)} onDone={() => setModal(null)} />}
      {modal === 'note' && <NoteModal guestId={g.id} onClose={() => setModal(null)} />}
      {modal === 'doc' && <DocumentModal guestId={g.id} onClose={() => setModal(null)} />}
      {revealing && <RevealModal guestId={g.id} docId={revealing.id} label={revealing.label} onClose={() => setRevealing(null)} />}
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} title="Supprimer cette pièce ?" description="Le numéro chiffré est effacé définitivement." confirmLabel="Supprimer la pièce" loading={delDoc.isPending}
        onConfirm={() => removing && delDoc.mutate({ id: g.id, docId: removing }, { onSuccess: () => { setRemoving(null); toast.success('Pièce supprimée.'); }, onError: (e) => { setRemoving(null); toast.error(isApiError(e) ? e.message : 'La suppression a échoué.'); } })} />
    </>
  );
}
