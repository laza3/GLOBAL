import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Banknote, CircleCheck, CreditCard, Hash, Landmark, Minus, PauseCircle, PlayCircle, Plus, Printer, ScanBarcode, Smartphone, Tag, Trash2, UserRound, Wallet, X, FileText, Percent } from 'lucide-react';
import { computeCart, settlePayments, type CartDiscount, type PaymentKind } from '@gp/shared';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Modal, MoneyInput, Select, SearchInput, Spinner, Warn, cx, useToast } from '../components/ui';
import { call, system, useM, useQ } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useT } from '../lib/i18n';
import { money, parseQty, qty, qtyToInput, todayStr } from '../lib/format';
import { invoiceHtml, receiptHtml } from '../print/templates';

interface Line {
  variantId: string; name: string; sku: string; unitPrice: number; basePrice: number; taxRateBp: number; qtyMilli: number;
  discountBp?: number; discountAmount?: number; allowDecimal: boolean; stockMilli: number; trackStock: boolean; promo: boolean;
}
interface Method { id: string; code: string; name: string; kind: PaymentKind }
const KIND_ICON: Record<string, any> = { CASH: Banknote, CARD: CreditCard, MOBILE: Smartphone, BANK: Landmark, CHEQUE: Hash, OTHER: Wallet };

export function PosPage() {
  const { t } = useT();
  const { company, can } = useAuth();
  const { push } = useToast();
  const searchRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [categoryId, setCategory] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [customer, setCustomer] = useState<{ id: string; name: string; priceTier: string; balance: number; creditLimit: number } | null>(null);
  const [cartDiscount, setCartDiscount] = useState<CartDiscount>(null);
  const [registerId, setRegisterId] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const [custOpen, setCustOpen] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [discOpen, setDiscOpen] = useState<null | { index: number | 'cart' }>(null);
  const [done, setDone] = useState<null | { id: string; number: string; total: number; change: number; credit: number }>(null);
  const [floatOpen, setFloatOpen] = useState(false);

  const registers = useQ('org.registers');
  const regList = (registers.data ?? []) as any[];
  useEffect(() => {
    if (!registerId && regList.length) setRegisterId((regList.find((r) => r.openSessionId) ?? regList[0]).id);
  }, [regList, registerId]);
  const register = regList.find((r) => r.id === registerId);
  const session = useQ('cash.current', { registerId: registerId || undefined }, { enabled: !!registerId });
  const methods = (useQ('ref.paymentMethods').data ?? []) as Method[];
  const categories = (useQ('catalog.categories').data ?? []) as any[];
  const tier = (customer?.priceTier ?? 'RETAIL') as 'RETAIL' | 'WHOLESALE';
  const products = useQ('sellable.search', { q, warehouseId: register?.warehouseId, tier, categoryId: categoryId || undefined, limit: 60 }, { enabled: !!register, placeholderData: (p) => p });

  const pricesIncludeTax = company?.pricesIncludeTax !== false;
  const cart = useMemo(() => computeCart(lines.map((l) => ({ qtyMilli: l.qtyMilli, unitPrice: l.unitPrice, discountBp: l.discountBp, discountAmount: l.discountAmount, taxRateBp: l.taxRateBp })), { pricesIncludeTax, cartDiscount }), [lines, cartDiscount, pricesIncludeTax]);

  const addLine = useCallback((p: any, add = 1000) => {
    setLines((cur) => {
      const i = cur.findIndex((l) => l.variantId === p.variantId);
      if (i >= 0) return cur.map((l, k) => (k === i ? { ...l, qtyMilli: l.qtyMilli + add } : l));
      return [...cur, { variantId: p.variantId, name: p.name, sku: p.sku, unitPrice: p.price, basePrice: p.basePrice, taxRateBp: p.taxRateBp, qtyMilli: add, allowDecimal: p.allowDecimal, stockMilli: p.stockMilli, trackStock: p.trackStock, promo: p.promo }];
    });
  }, []);

  // le prix suit le palier du client (détail / gros) : on réapplique à chaque changement de client
  useEffect(() => {
    if (!lines.length || !register) return;
    (async () => {
      const upd = await Promise.all(lines.map((l) => call('sellable.byCode', { code: l.sku, warehouseId: register.warehouseId, tier })));
      setLines((cur) => cur.map((l) => { const f = upd.find((u) => u?.variantId === l.variantId); return f ? { ...l, unitPrice: f.price, basePrice: f.basePrice, promo: f.promo } : l; }));
    })().catch(() => {});
  }, [tier]); // eslint-disable-line

  // lecteur de codes-barres : une saisie terminée par Entrée est d'abord interprétée comme un code
  const onSearchEnter = async () => {
    const code = q.trim();
    if (!code || !register) return;
    // le champ est vidé AU MOMENT de l'Entrée (avant la recherche asynchrone) : un 2e scan immédiat n'est jamais écrasé
    setQ('');
    const found = await call('sellable.byCode', { code, warehouseId: register.warehouseId, tier });
    if (found) { addLine(found); return; }
    if (products.data?.length === 1) { addLine(products.data[0]); return; }
    setQ((cur) => cur || code); // texte libre (recherche par nom) : on le restitue
    if (!products.data?.length) push('error', t('Aucun article pour « {q} »', { q: code }));
  };

  const hold = useM('held.save', { onSuccess: () => { setLines([]); setCustomer(null); setCartDiscount(null); push('success', t('Panier mis en attente')); } });
  const held = useQ('held.list');
  const clear = () => { setLines([]); setCustomer(null); setCartDiscount(null); setQ(''); searchRef.current?.focus(); };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'F4' && lines.length) { e.preventDefault(); hold.mutate({ payload: { lines, customer, cartDiscount }, label: customer?.name }); }
      if (e.key === 'F3') { e.preventDefault(); setHeldOpen(true); }
      if ((e.key === 'F9' || e.key === 'F12') && lines.length && session.data) { e.preventDefault(); setPayOpen(true); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [lines, customer, cartDiscount, session.data]); // eslint-disable-line

  const setQty = (i: number, milli: number) => setLines((c) => c.map((l, k) => (k === i ? { ...l, qtyMilli: Math.max(0, milli) } : l)).filter((l) => l.qtyMilli > 0));
  const discountsTotal = cart.lineDiscountTotal + cart.cartDiscountTotal;

  if (registers.isLoading) return <div className="grid h-64 place-items-center"><Spinner className="size-7" /></div>;

  return (
    <div className="-m-5 flex h-[calc(100vh-4rem)] flex-col gap-4 p-4 lg:-m-7 lg:flex-row lg:p-5">
      {/* Catalogue */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-60 flex-1">
            <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gold-500" />
            <Input ref={searchRef} autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onSearchEnter()} placeholder={t('Scanner un code-barres ou rechercher un produit… (F2)')} className="h-12 pl-10 text-base" />
          </div>
          {regList.length > 1 && <Select value={registerId} onChange={(e) => { setRegisterId(e.target.value); clear(); }} className="h-12 w-40">{regList.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {[{ id: '', name: t('Tous') }, ...categories.filter((c) => !c.parentId)].map((c) => (
            <button key={c.id} onClick={() => setCategory(c.id)} className={cx('whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition', categoryId === c.id ? 'bg-ink-800 text-white dark:bg-gold-400 dark:text-ink-950' : 'bg-white text-ink-600 hover:bg-ink-100 dark:bg-white/5 dark:text-ink-200')}>{c.name}</button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {!products.data?.length ? <EmptyState icon={<ScanBarcode className="size-6" />} title="Aucun produit trouvé" hint="Créez vos produits dans Produits, ou modifiez la recherche." /> : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {products.data.map((p: any) => {
                const out = p.trackStock && p.stockMilli <= 0;
                return (
                  <button key={p.variantId} onClick={() => addLine(p)} className="group relative flex flex-col rounded-2xl border border-ink-100 bg-white p-3 text-left shadow-card transition hover:-translate-y-0.5 hover:border-gold-300 active:scale-[0.98] dark:border-white/[0.07] dark:bg-ink-900/70">
                    {p.promo && <span className="absolute right-2 top-2 rounded-full bg-gold-400 px-2 py-0.5 text-[10px] font-bold text-ink-950">PROMO</span>}
                    <span className="mb-2 grid aspect-[5/3] place-items-center overflow-hidden rounded-xl bg-ink-50 text-ink-300 dark:bg-white/5">{p.image ? <img src={p.image} alt="" className="size-full object-cover" /> : <Tag className="size-6" />}</span>
                    <span className="line-clamp-2 min-h-10 text-sm font-medium leading-5">{p.name}</span>
                    <span className="mt-1 flex items-end justify-between"><span className="text-base font-semibold tabular text-ink-900 dark:text-white">{money(p.price)}</span>{p.trackStock && <span className={cx('text-xs tabular', out ? 'font-semibold text-red-500' : 'text-ink-400')}>{out ? t('Rupture') : qty(p.stockMilli)}</span>}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Panier */}
      <Card className="flex min-h-0 w-full shrink-0 flex-col lg:w-[26rem] xl:w-[30rem]">
        <div className="flex items-center justify-between gap-2 border-b border-ink-100 px-4 py-3 dark:border-white/[0.07]">
          <button onClick={() => setCustOpen(true)} className="flex min-w-0 items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-ink-50 dark:hover:bg-white/5"><UserRound className="size-4 text-gold-500" /><span className="truncate font-medium">{customer?.name ?? t('Client comptoir')}</span>{customer?.priceTier === 'WHOLESALE' && <Badge tone="gold">{t('Gros')}</Badge>}</button>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setHeldOpen(true)} icon={<PlayCircle className="size-4" />}>{t('Attente')}{(held.data?.length ?? 0) > 0 && <Badge tone="gold">{held.data!.length}</Badge>}</Button>
            <Button size="sm" variant="ghost" disabled={!lines.length} onClick={() => hold.mutate({ payload: { lines, customer, cartDiscount }, label: customer?.name })} icon={<PauseCircle className="size-4" />} title="F4" />
            <Button size="sm" variant="ghost" disabled={!lines.length} onClick={clear} icon={<Trash2 className="size-4" />} title={t('Vider le panier')} />
          </div>
        </div>

        {!session.isLoading && !session.data && (
          <div className="m-3"><Warn><span className="flex-1">{t("La caisse n'est pas ouverte.")}</span>{can('cash.session') && <button onClick={() => setFloatOpen(true)} className="font-semibold underline">{t('Ouvrir la caisse')}</button>}</Warn></div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {!lines.length ? <EmptyState icon={<ScanBarcode className="size-6" />} title="Panier vide" hint="Scannez un produit ou cliquez sur une carte pour l'ajouter." /> : (
            <ul className="space-y-2">
              {lines.map((l, i) => {
                const r = cart.lines[i];
                const over = l.trackStock && l.qtyMilli > l.stockMilli;
                return (
                  <li key={l.variantId} className="rounded-xl bg-ink-50/70 p-2.5 dark:bg-white/[0.04]">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0"><p className="truncate text-sm font-medium">{l.name}</p><p className="text-xs text-ink-400 tabular">{money(l.unitPrice)}{l.promo && <span className="ml-1 text-gold-600">· promo</span>}</p></div>
                      <button onClick={() => setQty(i, 0)} className="rounded-md p-1 text-ink-400 hover:bg-red-50 hover:text-red-500" aria-label={t('Retirer')}><X className="size-4" /></button>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="flex items-center rounded-lg border border-ink-200 bg-white dark:border-white/10 dark:bg-white/5">
                        <button onClick={() => setQty(i, l.qtyMilli - 1000)} className="grid size-8 place-items-center text-ink-500 hover:text-ink-900" aria-label="−"><Minus className="size-3.5" /></button>
                        <QtyBox value={l.qtyMilli} allowDecimal={l.allowDecimal} onChange={(v) => setQty(i, v)} />
                        <button onClick={() => setQty(i, l.qtyMilli + 1000)} className="grid size-8 place-items-center text-ink-500 hover:text-ink-900" aria-label="+"><Plus className="size-3.5" /></button>
                      </div>
                      <button onClick={() => setDiscOpen({ index: i })} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-ink-400 hover:bg-ink-100 dark:hover:bg-white/10" title={t('Remise')}><Percent className="size-3.5" />{r.lineDiscount > 0 ? <span className="font-semibold text-gold-600">−{money(r.lineDiscount)}</span> : t('Remise')}</button>
                      <p className="min-w-20 text-right text-sm font-semibold tabular">{money(r.total)}</p>
                    </div>
                    {over && <p className="mt-1 text-xs font-medium text-red-500">{t('Stock disponible : {n}', { n: qty(l.stockMilli) })}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-ink-100 p-4 dark:border-white/[0.07]">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between text-ink-500"><dt>{t('Sous-total')}</dt><dd className="tabular">{money(cart.subtotal)}</dd></div>
            <div className="flex justify-between text-ink-500"><dt><button onClick={() => lines.length && setDiscOpen({ index: 'cart' })} className="underline decoration-dotted underline-offset-2 hover:text-gold-600">{t('Remises')}</button></dt><dd className="tabular">{discountsTotal > 0 ? '−' + money(discountsTotal) : money(0)}</dd></div>
            {cart.taxTotal > 0 && <div className="flex justify-between text-ink-500"><dt>{t('dont taxe')}</dt><dd className="tabular">{money(cart.taxTotal)}</dd></div>}
          </dl>
          <div className="my-3 flex items-baseline justify-between"><span className="text-sm font-semibold uppercase tracking-wider text-ink-500">{t('Total')}</span><span className="text-3xl font-bold tabular tracking-tight text-ink-900 dark:text-white">{money(cart.total)}</span></div>
          <Button variant="gold" size="lg" className="h-14 w-full text-base" disabled={!lines.length || !session.data} onClick={() => setPayOpen(true)}>{t('Encaisser')} <kbd className="ml-1 rounded bg-black/10 px-1.5 text-xs">F9</kbd></Button>
        </div>
      </Card>

      <CustomerPicker open={custOpen} onClose={() => setCustOpen(false)} onPick={(c) => { setCustomer(c); setCustOpen(false); }} />
      <HeldModal open={heldOpen} onClose={() => setHeldOpen(false)} onResume={(p) => { setLines(p.lines ?? []); setCustomer(p.customer ?? null); setCartDiscount(p.cartDiscount ?? null); setHeldOpen(false); }} />
      <DiscountModal ctx={discOpen} onClose={() => setDiscOpen(null)} lines={lines} cartDiscount={cartDiscount}
        onLine={(i, d) => setLines((c) => c.map((l, k) => (k === i ? { ...l, discountBp: d?.type === 'percent' ? d.bp : undefined, discountAmount: d?.type === 'amount' ? d.amount : undefined } : l)))} onCart={setCartDiscount} />
      {payOpen && session.data && register && (
        <PayModal total={cart.total} customer={customer} methods={methods} onClose={() => setPayOpen(false)}
          build={(payments, extra) => ({ id: crypto.randomUUID(), registerId: register.id, customerId: customer?.id, items: lines.map((l) => ({ variantId: l.variantId, qtyMilli: l.qtyMilli, unitPrice: l.unitPrice !== l.basePrice && !l.promo && !(customer?.priceTier === 'WHOLESALE') ? l.unitPrice : undefined, discountBp: l.discountBp, discountAmount: l.discountAmount })), cartDiscount, payments, ...extra })}
          onDone={(r) => { setPayOpen(false); setDone(r); clear(); }} />
      )}
      <DoneModal done={done} onClose={() => { setDone(null); searchRef.current?.focus(); }} />
      <OpenFloatModal open={floatOpen} registerId={registerId} onClose={() => setFloatOpen(false)} />
    </div>
  );
}

function QtyBox({ value, allowDecimal, onChange }: { value: number; allowDecimal: boolean; onChange: (v: number) => void }) {
  const [txt, setTxt] = useState(qtyToInput(value));
  const f = useRef(false);
  useEffect(() => { if (!f.current) setTxt(qtyToInput(value)); }, [value]);
  return <input value={txt} inputMode="decimal" onFocus={(e) => { f.current = true; e.target.select(); }} onBlur={() => { f.current = false; setTxt(qtyToInput(value)); }}
    onChange={(e) => { setTxt(e.target.value); let v = parseQty(e.target.value); if (!allowDecimal) v = Math.round(v / 1000) * 1000; onChange(v); }} className="h-8 w-14 bg-transparent text-center text-sm font-semibold tabular outline-none" />;
}

function CustomerPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (c: any) => void }) {
  const { t } = useT();
  const [q, setQ] = useState('');
  const { data } = useQ('customers.list', { q, limit: 50 }, { enabled: open });
  return (
    <Modal open={open} onClose={onClose} title="Choisir un client" footer={<Button onClick={() => onPick(null)}>{t('Client comptoir')}</Button>}>
      <SearchInput value={q} onChange={setQ} placeholder="Nom ou téléphone…" autoFocus />
      <ul className="mt-3 max-h-80 divide-y divide-ink-50 overflow-y-auto dark:divide-white/5">
        {(data as any[] | undefined)?.map((c) => (
          <li key={c.id}><button onClick={() => onPick(c)} className="flex w-full items-center justify-between px-2 py-2.5 text-left hover:bg-ink-50 dark:hover:bg-white/5"><span><span className="block text-sm font-medium">{c.name}</span><span className="text-xs text-ink-400">{c.phone}</span></span><span className="text-right text-xs">{c.balance > 0 ? <span className="font-semibold text-red-500">{t('Doit')} {money(c.balance)}</span> : c.balance < 0 ? <span className="font-semibold text-emerald-600">{t('Avance')} {money(-c.balance)}</span> : null}</span></button></li>
        ))}
        {data && !(data as any[]).length && <li className="py-6 text-center text-sm text-ink-400">{t('Aucun client')}</li>}
      </ul>
    </Modal>
  );
}

function HeldModal({ open, onClose, onResume }: { open: boolean; onClose: () => void; onResume: (p: any) => void }) {
  const { t } = useT();
  const { data } = useQ('held.list', undefined, { enabled: open });
  const resume = useM('held.resume', { onSuccess: onResume });
  const discard = useM('held.discard');
  return (
    <Modal open={open} onClose={onClose} title="Paniers en attente">
      {!(data as any[] | undefined)?.length ? <EmptyState title="Aucun panier en attente" /> : (
        <ul className="divide-y divide-ink-50 dark:divide-white/5">
          {(data as any[]).map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-3 py-3">
              <div><p className="text-sm font-medium">{h.label || t('Sans nom')}</p><p className="text-xs text-ink-400">{h.payload.lines?.length ?? 0} {t('article(s)')} · {new Date(h.createdAt).toLocaleTimeString()}</p></div>
              <div className="flex gap-2"><Button size="sm" variant="primary" onClick={() => resume.mutate({ id: h.id })}>{t('Reprendre')}</Button><Button size="sm" variant="ghost" onClick={() => discard.mutate({ id: h.id })} icon={<Trash2 className="size-4" />} /></div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function DiscountModal({ ctx, onClose, lines, cartDiscount, onLine, onCart }: { ctx: null | { index: number | 'cart' }; onClose: () => void; lines: Line[]; cartDiscount: CartDiscount; onLine: (i: number, d: CartDiscount) => void; onCart: (d: CartDiscount) => void }) {
  const { t } = useT();
  const [mode, setMode] = useState<'percent' | 'amount'>('percent');
  const [val, setVal] = useState(0);
  const [pctTxt, setPctTxt] = useState('');
  useEffect(() => { if (ctx) { setVal(0); setPctTxt(''); setMode('percent'); } }, [ctx]);
  if (!ctx) return null;
  const apply = (remove = false) => {
    const d: CartDiscount = remove ? null : mode === 'percent' ? { type: 'percent', bp: Math.round(Number(pctTxt.replace(',', '.')) * 100) } : { type: 'amount', amount: val };
    if (ctx.index === 'cart') onCart(d); else onLine(ctx.index, d);
    onClose();
  };
  const title = ctx.index === 'cart' ? t('Remise sur le ticket') : `${t('Remise')} — ${lines[ctx.index]?.name}`;
  return (
    <Modal open onClose={onClose} title={title} size="sm" footer={<><Button variant="ghost" onClick={() => apply(true)}>{t('Retirer la remise')}</Button><Button variant="primary" onClick={() => apply()}>{t('Appliquer')}</Button></>}>
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-ink-100 p-1 dark:bg-white/5">
        {(['percent', 'amount'] as const).map((m) => <button key={m} onClick={() => setMode(m)} className={cx('rounded-lg py-1.5 text-sm font-medium', mode === m ? 'bg-white shadow-sm dark:bg-ink-700' : 'text-ink-500')}>{m === 'percent' ? '%' : t('Montant')}</button>)}
      </div>
      {mode === 'percent' ? <Field label="Pourcentage"><Input autoFocus inputMode="decimal" value={pctTxt} onChange={(e) => setPctTxt(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apply()} placeholder="10" /></Field> : <Field label="Montant"><MoneyInput autoFocus value={val} onChange={setVal} onKeyDown={(e) => e.key === 'Enter' && apply()} /></Field>}
      {cartDiscount && ctx.index === 'cart' && <p className="mt-2 text-xs text-ink-400">{t('Remise actuelle')} : {cartDiscount.type === 'percent' ? `${cartDiscount.bp / 100} %` : money(cartDiscount.amount)}</p>}
    </Modal>
  );
}

function PayModal({ total, customer, methods, build, onClose, onDone }: { total: number; customer: any; methods: Method[]; build: (p: { methodId: string; amount: number }[], extra: any) => any; onClose: () => void; onDone: (r: any) => void }) {
  const { t } = useT();
  const { can } = useAuth();
  const [pays, setPays] = useState<{ methodId: string; amount: number }[]>([]);
  const [useAdvance, setUseAdvance] = useState(false);
  const [dueDate, setDueDate] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const create = useM('sales.create');
  const advanceAvail = customer && customer.balance < 0 ? -customer.balance : 0;
  const advance = useAdvance ? Math.min(advanceAvail, total) : 0;
  const due = total - advance;
  const kindOf = (id: string) => methods.find((m) => m.id === id)!.kind;

  let settle: ReturnType<typeof settlePayments> | null = null;
  let settleErr = '';
  try { settle = settlePayments(due, pays.filter((p) => p.amount > 0).map((p) => ({ methodId: p.methodId, kind: kindOf(p.methodId), amount: p.amount }))); } catch (e) { settleErr = (e as Error).message; }
  const credit = settle?.creditAmount ?? due;
  const needCustomer = credit > 0 && !customer;
  const creditBlocked = credit > 0 && customer && (!can('sale.credit') || customer.creditLimit <= 0 || Math.max(customer.balance, 0) + credit > customer.creditLimit);
  const addMethod = (m: Method) => setPays((p) => {
    const paid = p.reduce((a, b) => a + b.amount, 0);
    const rest = Math.max(0, due - paid);
    return [...p, { methodId: m.id, amount: rest || 0 }];
  });
  const submit = async () => {
    setErr(null);
    try {
      const r = await create.mutateAsync(build(pays.filter((p) => p.amount > 0), { advanceUsed: advance || undefined, dueDate: credit > 0 && dueDate ? dueDate : undefined }));
      onDone({ id: r.id, number: r.number, total: r.total, change: r.change, credit: r.creditAmount });
    } catch (e) { setErr(e); }
  };
  const canSubmit = !settleErr && !needCustomer && !creditBlocked && (pays.some((p) => p.amount > 0) || advance > 0 || credit > 0);

  return (
    <Modal open onClose={onClose} title="Encaissement" size="lg" footer={<><Button onClick={onClose}>{t('Annuler')}</Button><Button variant="gold" size="lg" loading={create.isPending} disabled={!canSubmit} onClick={submit}>{credit > 0 ? t('Valider (reste à crédit)') : t('Valider la vente')}</Button></>}>
      <div className="grid gap-5 md:grid-cols-[1fr_1.1fr]">
        <div className="space-y-4">
          <div className="rounded-2xl bg-ink-900 p-5 text-white dark:bg-ink-800"><p className="text-xs uppercase tracking-wider text-ink-300">{t('Total à payer')}</p><p className="mt-1 text-4xl font-bold tabular tracking-tight text-gold-300">{money(total)}</p>
            {advance > 0 && <p className="mt-1 text-xs text-ink-300">{t('Avance utilisée')} : −{money(advance)} → {money(due)}</p>}</div>
          <div className="space-y-2 text-sm">
            <Row label="Reçu" value={money(pays.reduce((a, b) => a + b.amount, 0))} />
            {(settle?.change ?? 0) > 0 && <Row label="Rendu monnaie" value={money(settle!.change)} strong tone="gold" />}
            {credit > 0 && !settleErr && <Row label="Reste à crédit" value={money(credit)} strong tone="red" />}
            {credit === 0 && !settleErr && <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-600"><CircleCheck className="size-4" />{t('Paiement complet')}</p>}
          </div>
          {advanceAvail > 0 && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-gold-500" checked={useAdvance} onChange={(e) => setUseAdvance(e.target.checked)} />{t('Utiliser l’avance du client ({a})', { a: money(advanceAvail) })}</label>}
          {credit > 0 && <Field label="Échéance de paiement"><Input type="date" min={todayStr()} value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>}
          {needCustomer && <Warn>{t('Sélectionnez un client pour une vente à crédit ou un paiement partiel.')}</Warn>}
          {creditBlocked && <Warn>{!can('sale.credit') ? t('Vous n’avez pas le droit de vendre à crédit.') : customer.creditLimit <= 0 ? t('Ce client n’a pas de crédit autorisé.') : t('Plafond de crédit dépassé ({l}).', { l: money(customer.creditLimit) })}</Warn>}
          {settleErr && <Warn>{settleErr}</Warn>}
          <ErrorBox error={err} />
        </div>
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">{t('Mode de paiement')}</p>
          <div className="grid grid-cols-2 gap-2">
            {methods.map((m) => { const I = KIND_ICON[m.kind] ?? Wallet; return (
              <button key={m.id} onClick={() => addMethod(m)} className="flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-3 py-3 text-sm font-medium transition hover:border-gold-400 hover:bg-gold-50 active:scale-[0.98] dark:border-white/10 dark:bg-white/5 dark:hover:bg-gold-400/10"><I className="size-4 text-gold-500" />{m.name}</button>); })}
          </div>
          {pays.length > 0 && (
            <ul className="space-y-2">
              {pays.map((p, i) => (
                <li key={i} className="flex items-center gap-2 rounded-xl bg-ink-50 p-2 dark:bg-white/5">
                  <span className="w-28 truncate text-sm font-medium">{methods.find((m) => m.id === p.methodId)?.name}</span>
                  <MoneyInput autoFocus={i === pays.length - 1} value={p.amount} onChange={(v) => setPays((c) => c.map((x, k) => (k === i ? { ...x, amount: v } : x)))} onKeyDown={(e) => e.key === 'Enter' && canSubmit && submit()} />
                  <button onClick={() => setPays((c) => c.filter((_, k) => k !== i))} className="rounded-md p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-500" aria-label={t('Retirer')}><X className="size-4" /></button>
                </li>
              ))}
            </ul>
          )}
          {pays.some((p) => kindOf(p.methodId) === 'CASH') && <div className="flex flex-wrap gap-2">{quickAmounts(due).map((a) => <button key={a} onClick={() => setPays((c) => { const i = c.findIndex((x) => kindOf(x.methodId) === 'CASH'); return c.map((x, k) => (k === i ? { ...x, amount: a } : x)); })} className="rounded-lg bg-ink-100 px-3 py-1.5 text-xs font-semibold tabular hover:bg-gold-100 dark:bg-white/10">{money(a)}</button>)}</div>}
        </div>
      </div>
    </Modal>
  );
}
const Row = ({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'gold' | 'red' }) => {
  const { t } = useT();
  return <div className="flex items-center justify-between"><span className="text-ink-500">{t(label)}</span><span className={cx('tabular', strong && 'text-xl font-bold', tone === 'gold' && 'text-gold-600', tone === 'red' && 'text-red-600')}>{value}</span></div>;
};
function quickAmounts(total: number): number[] {
  const out = new Set<number>([total]);
  const steps = total >= 100_000 ? [10_000, 50_000, 100_000] : total >= 10_000 ? [1000, 5000, 10_000] : [100, 500, 1000];
  for (const s of steps) { const r = Math.ceil(total / s) * s; if (r > 0) out.add(r); }
  return [...out].sort((a, b) => a - b).slice(0, 4);
}

function DoneModal({ done, onClose }: { done: null | { id: string; number: string; total: number; change: number; credit: number }; onClose: () => void }) {
  const { t } = useT();
  const { push } = useToast();
  const co = useQ('company.get');
  const printTicket = async () => {
    try { const s = await call('sales.get', { id: done!.id }); await system('print', { html: receiptHtml(co.data!, s, t) }); } catch (e) { push('error', (e as Error).message); }
  };
  const printInvoice = async () => {
    try {
      const inv: any = await call('sales.invoice', { saleId: done!.id });
      const s = await call('sales.get', { id: done!.id });
      await system('print', { html: invoiceHtml(co.data!, s, { number: inv.number, issuedAt: new Date().toISOString() }, t) });
    } catch (e) { push('error', (e as Error).message); }
  };
  useEffect(() => {
    if (!done) return;
    if (localStorage.getItem('gp.autoprint') === '1') void printTicket();
    const h = (e: KeyboardEvent) => e.key === 'Enter' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [done]); // eslint-disable-line
  if (!done) return null;
  return (
    <Modal open onClose={onClose} title="Vente enregistrée" size="sm" footer={<Button variant="gold" onClick={onClose}>{t('Nouvelle vente')} ↵</Button>}>
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <span className="grid size-14 place-items-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-400/10"><CircleCheck className="size-8" /></span>
        <p className="text-sm text-ink-500">{t('Ticket')} <b className="text-ink-800 dark:text-white">{done.number}</b></p>
        <p className="text-3xl font-bold tabular">{money(done.total)}</p>
        {done.change > 0 && <div className="w-full rounded-2xl bg-gold-50 p-4 dark:bg-gold-400/10"><p className="text-xs uppercase tracking-wider text-gold-700">{t('Rendu monnaie')}</p><p className="text-4xl font-bold tabular text-gold-600">{money(done.change)}</p></div>}
        {done.credit > 0 && <Badge tone="red">{t('Reste à crédit')} : {money(done.credit)}</Badge>}
        <div className="mt-2 flex gap-2"><Button onClick={printTicket} icon={<Printer className="size-4" />}>{t('Ticket')}</Button><Button onClick={printInvoice} icon={<FileText className="size-4" />}>{t('Facture')}</Button></div>
      </div>
    </Modal>
  );
}

export function OpenFloatModal({ open, registerId, onClose }: { open: boolean; registerId: string; onClose: () => void }) {
  const { t } = useT();
  const [float, setFloat] = useState(0);
  const [err, setErr] = useState<unknown>(null);
  const m = useM('cash.open', { onSuccess: onClose });
  return (
    <Modal open={open} onClose={onClose} title="Ouverture de caisse" size="sm" footer={<><Button onClick={onClose}>{t('Annuler')}</Button><Button variant="gold" loading={m.isPending} onClick={() => m.mutate({ registerId, openingFloat: float }, { onError: setErr })}>{t('Ouvrir')}</Button></>}>
      <Field label="Fond de caisse (espèces comptées)"><MoneyInput autoFocus value={float} onChange={setFloat} onKeyDown={(e) => e.key === 'Enter' && m.mutate({ registerId, openingFloat: float }, { onError: setErr })} /></Field>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}
void Spinner;
