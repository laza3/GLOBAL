import { useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Lock, Unlock } from 'lucide-react';
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Kpi, Modal, MoneyInput, PageHeader, Select, StatusBadge, Money, Warn } from '../components/ui';
import { useM, useQ } from '../lib/api';
import { useT } from '../lib/i18n';
import { dateTime, money } from '../lib/format';
import { OpenFloatModal } from './Pos';

export function CashPage() {
  const { t } = useT();
  const regs = (useQ('org.registers').data ?? []) as any[];
  const sessions = useQ('cash.sessions', undefined, { refetchInterval: 15000 });
  const [reg, setReg] = useState('');
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [closeId, setCloseId] = useState<string | null>(null);
  const [io, setIo] = useState<null | { sessionId: string; dir: 'IN' | 'OUT' }>(null);
  const [detail, setDetail] = useState<string | null>(null);

  return (
    <>
      <PageHeader title="Sessions de caisse" subtitle="Ouverture, mouvements d’espèces et clôture avec contrôle des écarts" />
      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {regs.filter((r) => r.active).map((r) => <RegisterCard key={r.id} reg={r} onOpen={() => setOpenFor(r.id)} onClose={(id) => setCloseId(id)} onIo={(sessionId, dir) => setIo({ sessionId, dir })} />)}
      </div>
      <Card>
        <div className="flex items-center justify-between px-4 pt-4"><h3 className="font-semibold">{t('Historique')}</h3>
          <Select className="w-44" value={reg} onChange={(e) => setReg(e.target.value)}><option value="">{t('Toutes les caisses')}</option>{regs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></div>
        <DataTable rowKey={(r: any) => r.id} onRowClick={(r: any) => setDetail(r.id)} rows={((sessions.data ?? []) as any[]).filter((s) => !reg || s.registerName === regs.find((r) => r.id === reg)?.name)} columns={[
          { key: 'r', header: 'Caisse', render: (r: any) => r.registerName },
          { key: 'u', header: 'Caissier', render: (r: any) => r.userName },
          { key: 'o', header: 'Ouverture', render: (r: any) => dateTime(r.openedAt) },
          { key: 'c', header: 'Clôture', render: (r: any) => dateTime(r.closedAt) },
          { key: 'v', header: 'Ventes', align: 'right', render: (r: any) => `${r.salesCount} · ${money(r.salesTotal)}` },
          { key: 'd', header: 'Écart', align: 'right', render: (r: any) => (r.status === 'CLOSED' ? <span className={r.difference ? 'font-semibold text-red-500' : 'text-emerald-600'}>{money(r.difference)}</span> : '') },
          { key: 's', header: 'Statut', render: (r: any) => <StatusBadge status={r.status} /> },
        ]} />
      </Card>
      <OpenFloatModal open={!!openFor} registerId={openFor ?? ''} onClose={() => setOpenFor(null)} />
      {closeId && <CloseModal id={closeId} onClose={() => setCloseId(null)} />}
      {io && <IoModal {...io} onClose={() => setIo(null)} />}
      {detail && <SessionDetail id={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function RegisterCard({ reg, onOpen, onClose, onIo }: { reg: any; onOpen: () => void; onClose: (id: string) => void; onIo: (id: string, d: 'IN' | 'OUT') => void }) {
  const { t } = useT();
  const s = useQ('cash.current', { registerId: reg.id }, { refetchInterval: 15000 }).data;
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between"><div><h3 className="font-semibold">{reg.name}</h3><p className="text-xs text-ink-400">{reg.branchName} · {reg.warehouseName}</p></div>{s ? <Badge tone="green">{t('Ouverte')}</Badge> : <Badge>{t('Fermée')}</Badge>}</div>
      {s ? (<>
        <p className="mt-4 text-xs uppercase tracking-wider text-ink-400">{t('Espèces attendues en caisse')}</p>
        <p className="text-3xl font-bold tabular text-ink-900 dark:text-white">{money(s.expectedCash)}</p>
        <p className="mt-1 text-xs text-ink-400">{s.userName} · {t('depuis')} {dateTime(s.openedAt)} · {s.salesCount} {t('vente(s)')} · {money(s.salesTotal)}</p>
        <div className="mt-4 flex flex-wrap gap-2"><Button size="sm" onClick={() => onIo(s.id, 'IN')} icon={<ArrowDownToLine className="size-4" />}>{t('Entrée')}</Button><Button size="sm" onClick={() => onIo(s.id, 'OUT')} icon={<ArrowUpFromLine className="size-4" />}>{t('Sortie')}</Button><Button size="sm" variant="primary" className="ml-auto" onClick={() => onClose(s.id)} icon={<Lock className="size-4" />}>{t('Clôturer')}</Button></div>
      </>) : <div className="mt-6"><Button variant="gold" onClick={onOpen} icon={<Unlock className="size-4" />}>{t('Ouvrir la caisse')}</Button></div>}
    </Card>
  );
}

function CloseModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useT();
  const s = useQ('cash.summary', { sessionId: id }).data;
  const [counted, setCounted] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const m = useM('cash.close', { onSuccess: onClose });
  if (!s) return null;
  const diff = counted == null ? null : counted - s.expectedCash;
  return (
    <Modal open onClose={onClose} title={`${t('Clôture')} — ${s.registerName}`} footer={<><Button onClick={onClose}>{t('Annuler')}</Button><Button variant="primary" loading={m.isPending} disabled={counted == null} onClick={() => m.mutate({ sessionId: id, countedCash: counted!, note: note || undefined }, { onError: setErr })}>{t('Clôturer la caisse')}</Button></>}>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Info l="Fond de caisse" v={money(s.openingFloat)} /><Info l="Ventes (toutes formes)" v={`${s.salesCount} · ${money(s.salesTotal)}`} />
        <Info l="Espèces des ventes" v={money(s.movements.SALE ?? 0)} /><Info l="Remboursements espèces" v={money(s.movements.REFUND ?? 0)} />
        <Info l="Dépenses espèces" v={money(s.movements.EXPENSE ?? 0)} /><Info l="Entrées / sorties manuelles" v={money((s.movements.DEPOSIT ?? 0) + (s.movements.WITHDRAWAL ?? 0))} />
      </div>
      <div className="my-4 rounded-2xl bg-ink-900 p-4 text-white"><p className="text-xs uppercase tracking-wider text-ink-300">{t('Espèces attendues')}</p><p className="text-3xl font-bold tabular text-gold-300">{money(s.expectedCash)}</p></div>
      <Field label="Espèces comptées"><MoneyInput autoFocus value={counted} onChange={setCounted} /></Field>
      {diff != null && <p className={`mt-2 text-sm font-semibold ${diff === 0 ? 'text-emerald-600' : 'text-red-600'}`}>{diff === 0 ? t('Aucun écart') : `${t('Écart')} : ${diff > 0 ? '+' : ''}${money(diff)}`}</p>}
      {diff != null && diff !== 0 && <Field label="Commentaire (obligatoire en cas d’écart)" className="mt-3"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>}
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}
const Info = ({ l, v }: { l: string; v: string }) => { const { t } = useT(); return <div className="rounded-xl bg-ink-50 p-3 dark:bg-white/5"><p className="text-xs text-ink-400">{t(l)}</p><p className="font-semibold tabular">{v}</p></div>; };

function IoModal({ sessionId, dir, onClose }: { sessionId: string; dir: 'IN' | 'OUT'; onClose: () => void }) {
  const { t } = useT();
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const m = useM('cash.inOut', { onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title={dir === 'IN' ? 'Entrée d’espèces' : 'Sortie d’espèces'} size="sm" footer={<><Button onClick={onClose}>{t('Annuler')}</Button><Button variant="primary" loading={m.isPending} disabled={amount <= 0 || !note.trim()} onClick={() => m.mutate({ sessionId, direction: dir, amount, note }, { onError: setErr })}>{t('Enregistrer')}</Button></>}>
      <div className="space-y-3"><Warn>{dir === 'IN' ? t('Apport de l’exploitant : ce n’est pas une vente et n’entre pas dans le chiffre d’affaires.') : t('Prélèvement : ce n’est pas une dépense d’exploitation. Pour une dépense, utilisez Finances → Dépenses.')}</Warn>
        <Field label="Montant"><MoneyInput autoFocus value={amount} onChange={setAmount} /></Field><Field label="Motif"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field><ErrorBox error={err} /></div>
    </Modal>
  );
}

function SessionDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useT();
  const s = useQ('cash.summary', { sessionId: id }).data;
  if (!s) return null;
  return (
    <Modal open onClose={onClose} title={`${s.registerName} — ${dateTime(s.openedAt)}`} size="md">
      <div className="grid grid-cols-2 gap-3 text-sm"><Info l="Caissier" v={s.userName} /><Info l="Statut" v={s.status === 'OPEN' ? t('Ouverte') : t('Clôturée')} /><Info l="Fond de caisse" v={money(s.openingFloat)} /><Info l="Espèces attendues" v={money(s.expectedCash)} />
        {s.status === 'CLOSED' && <><Info l="Espèces comptées" v={money(s.countedCash)} /><Info l="Écart" v={money(s.difference)} /></>}</div>
      <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-ink-400">{t('Encaissements par mode de paiement')}</p>
      <ul className="space-y-1 text-sm">{s.byMethod.map((m: any) => <li key={m.name} className="flex justify-between"><span>{m.name}</span><Money v={m.total} /></li>)}</ul>
      {s.closeNote && <p className="mt-4 rounded-xl bg-gold-50 p-3 text-sm dark:bg-gold-400/10">{s.closeNote}</p>}
    </Modal>
  );
}
