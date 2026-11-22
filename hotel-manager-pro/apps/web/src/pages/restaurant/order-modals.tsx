import { formatMoney } from '@hmp/shared';
import { Minus, Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { usePaymentMethods } from '../../api/billing';
import { useAddItems, useCancelOrder, useInHouse, useMenu, useOpenOrder, usePayOrder, usePostToRoom, useTables, type OrderDetail } from '../../api/restaurant';
import { useCurrency } from '../../lib/use-currency';
import { ActionModal } from '../../ui/action-modal';
import { Button } from '../../ui/button';
import { Field, Input, Select, Textarea } from '../../ui/form';
import { Callout } from '../../ui/page';

/** Choix des plats avec quantités : la carte, groupée par catégorie, avec le prix de chaque plat. */
function ProductPicker({ qty, setQty }: { qty: Record<string, number>; setQty: (q: Record<string, number>) => void }) {
  const currency = useCurrency();
  const menu = useMenu();
  if (menu.isPending) return <p className="text-[14px] text-ink-2" role="status">Chargement de la carte…</p>;
  const cats = menu.data?.categories ?? [];
  const products = menu.data?.products ?? [];
  if (products.length === 0) return <Callout tone="info">La carte est vide : ajoutez des plats dans l'onglet « Carte ».</Callout>;
  const groups = [...cats.map((c) => ({ id: c.id as string | null, name: c.name })), { id: null, name: 'Autres' }].map((g) => ({ ...g, items: products.filter((p) => p.categoryId === g.id) })).filter((g) => g.items.length > 0);
  const set = (id: string, n: number) => { const next = { ...qty }; if (n <= 0) delete next[id]; else next[id] = Math.min(n, 100); setQty(next); };
  return (
    <div className="flex max-h-[22rem] flex-col gap-4 overflow-y-auto pr-1" role="group" aria-label="Plats de la carte">
      {groups.map((g) => (
        <section key={g.name} aria-label={g.name} className="flex flex-col gap-1.5">
          <h3 className="text-[13px] font-semibold text-ink-2">{g.name}</h3>
          <ul className="flex flex-col gap-1.5">
            {g.items.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 rounded-[12px] bg-silver-soft px-3 py-2">
                <span className="flex min-w-0 flex-col"><span className="text-[14px] font-medium text-ink">{p.name}</span><span className="num-col text-[13px] text-ink-2">{formatMoney(p.price, currency)}</span></span>
                <span className="flex items-center gap-1.5">
                  <Button size="icon-sm" variant="secondary" onClick={() => set(p.id, (qty[p.id] ?? 0) - 1)} disabled={!qty[p.id]} aria-label={`Retirer un ${p.name}`}><Minus aria-hidden className="size-3.5" /></Button>
                  <span className="num-col w-6 text-center text-[14px] font-medium" aria-live="polite">{qty[p.id] ?? 0}</span>
                  <Button size="icon-sm" variant="secondary" onClick={() => set(p.id, (qty[p.id] ?? 0) + 1)} aria-label={`Ajouter un ${p.name}`}><Plus aria-hidden className="size-3.5" /></Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

const itemsOf = (qty: Record<string, number>) => Object.entries(qty).map(([productId, quantity]) => ({ productId, quantity }));

export function NewOrderModal({ onClose, onOpened }: { onClose: () => void; onOpened: (id: string) => void }) {
  const tables = useTables();
  const open = useOpenOrder();
  const key = useRef(crypto.randomUUID());
  const [tableId, setTableId] = useState('none');
  const [covers, setCovers] = useState('1');
  const [qty, setQty] = useState<Record<string, number>>({});
  const free = (tables.data ?? []).filter((t) => t.isActive && !t.busy);
  return (
    <ActionModal title="Nouvelle commande" description="Choisissez la table et les plats. Les prix sont figés sur l'addition." confirmLabel="Ouvrir la commande" width="40rem" onClose={onClose}
      onSubmit={() => {
        const n = Number(covers);
        if (!Number.isInteger(n) || n < 1 || n > 60) return 'Le nombre de couverts doit être entre 1 et 60.';
        if (itemsOf(qty).length === 0) return 'Ajoutez au moins un plat.';
        return open.mutateAsync({ idempotencyKey: key.current, body: { tableId: tableId === 'none' ? null : tableId, covers: n, items: itemsOf(qty) } }).then((r) => { toast.success(`Commande ${r.number} ouverte.`); onOpened(r.id); });
      }}>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Table" hint="Les tables déjà occupées ne sont pas proposées.">{(c) => <Select {...c} value={tableId} onValueChange={setTableId} options={[{ value: 'none', label: 'Sans table (comptoir)' }, ...free.map((t) => ({ value: t.id, label: `${t.label}${t.area ? ` — ${t.area}` : ''} · ${t.seats} pl.` }))]} />}</Field>
        <Field label="Couverts">{(c) => <Input {...c} inputMode="numeric" value={covers} onChange={(e) => setCovers(e.target.value)} />}</Field>
      </div>
      <ProductPicker qty={qty} setQty={(q) => { setQty(q); key.current = crypto.randomUUID(); }} />
    </ActionModal>
  );
}

export function AddItemsModal({ order, onClose }: { order: OrderDetail; onClose: () => void }) {
  const add = useAddItems();
  const [qty, setQty] = useState<Record<string, number>>({});
  return (
    <ActionModal title={`Ajouter à ${order.number}`} confirmLabel="Ajouter à la commande" width="40rem" onClose={onClose}
      onSubmit={() => (itemsOf(qty).length === 0 ? 'Choisissez au moins un plat.' : add.mutateAsync({ id: order.id, items: itemsOf(qty) }).then(() => void toast.success('Plats ajoutés.')))}>
      <ProductPicker qty={qty} setQty={setQty} />
    </ActionModal>
  );
}

export function PayOrderModal({ order, onClose }: { order: OrderDetail; onClose: () => void }) {
  const methods = usePaymentMethods();
  const pay = usePayOrder();
  const key = useRef(crypto.randomUUID());
  const active = (methods.data ?? []).filter((m) => m.isActive);
  const [code, setCode] = useState('');
  const [reference, setReference] = useState('');
  const method = active.find((m) => m.code === (code || active[0]?.code));
  return (
    <ActionModal title={`Encaisser ${order.number}`} description={`Addition : ${formatMoney(order.total, order.currency)}. Saisissez ce que vous avez reçu — rien n'est prélevé automatiquement.`} confirmLabel="Encaisser" onClose={onClose}
      onSubmit={() => {
        if (!method) return "Aucun moyen d'encaissement actif.";
        if (method.kind !== 'cash' && !reference.trim()) return 'Indiquez la référence de la transaction.';
        return pay.mutateAsync({ id: order.id, idempotencyKey: key.current, body: { methodCode: method.code, amount: order.total, reference: reference.trim() || null } }).then(() => void toast.success('Commande encaissée.'));
      }}>
      <Field label="Moyen d'encaissement" required>{(c) => <Select {...c} value={method?.code ?? ''} onValueChange={setCode} options={active.map((m) => ({ value: m.code, label: m.label }))} />}</Field>
      {method && method.kind !== 'cash' && <Field label="Référence de la transaction" required>{(c) => <Input {...c} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} autoComplete="off" />}</Field>}
    </ActionModal>
  );
}

export function PostToRoomModal({ order, onClose }: { order: OrderDetail; onClose: () => void }) {
  const guests = useInHouse();
  const post = usePostToRoom();
  const [id, setId] = useState('');
  return (
    <ActionModal title={`Imputer ${order.number} à une chambre`} description={`${formatMoney(order.total, order.currency)} seront ajoutés à la note du client et facturés avec son séjour. Une commande ne s'impute qu'une fois.`} confirmLabel="Imputer à la chambre" onClose={onClose}
      onSubmit={() => (!id ? 'Choisissez le client.' : post.mutateAsync({ id: order.id, reservationId: id }).then(() => void toast.success('Commande imputée à la chambre.')))}>
      {guests.data && guests.data.length === 0 ? <Callout tone="info">Aucun client n'est actuellement en séjour.</Callout> : (
        <Field label="Client en séjour" required>{(c) => <Select {...c} value={id} onValueChange={setId} placeholder="Chambre — client" options={(guests.data ?? []).map((g) => ({ value: g.reservationId, label: `Chambre ${g.roomNumber} — ${g.guestName}` }))} />}</Field>
      )}
    </ActionModal>
  );
}

export function CancelOrderModal({ order, onClose }: { order: OrderDetail; onClose: () => void }) {
  const cancel = useCancelOrder();
  const [reason, setReason] = useState('');
  return (
    <ActionModal title={`Annuler ${order.number}`} description="La commande est clôturée sans encaissement. Elle reste visible dans l'historique." confirmLabel="Annuler la commande" onClose={onClose}
      onSubmit={() => (reason.trim().length < 3 ? 'Indiquez le motif (3 caractères au moins).' : cancel.mutateAsync({ id: order.id, reason: reason.trim() }).then(() => void toast.success('Commande annulée.')))}>
      <Field label="Motif" required>{(c) => <Textarea {...c} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />}</Field>
    </ActionModal>
  );
}
