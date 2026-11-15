import { describe, expect, it } from 'vitest';
import { Harness } from './helpers';

const sumFT = (h: Harness, kind?: string) =>
  h.db.value<number>(`SELECT COALESCE(SUM(amount),0) FROM financial_transactions ${kind ? `WHERE kind = '${kind}'` : ''}`)!;

async function shop() {
  const h = await new Harness().boot();
  await h.openCash(10_000);
  return h;
}

describe('vente POS', () => {
  it('encaisse en espèces avec rendu de monnaie et met à jour stock, caisse et trésorerie atomiquement', async () => {
    const h = await shop();
    const p = await h.product('Riz 1kg', { price: 4500, cost: 3000, qty: 50, tax: h.ids.tax0 });
    const r = await h.call('sales.create', { registerId: h.ids.register, items: [{ variantId: p.variantId, qtyMilli: 2000 }], payments: [{ methodId: h.ids.pm_CASH, amount: 10_000 }] });
    expect(r).toMatchObject({ total: 9000, paidTotal: 9000, change: 1000, creditAmount: 0 });
    expect(h.stock(p.variantId)).toBe(48_000);
    expect(sumFT(h, 'SALE_RECEIPT')).toBe(9000);
    const cash = await h.call('cash.current');
    expect(cash.expectedCash).toBe(10_000 + 9000);
    const sale = await h.call('sales.get', { id: r.id });
    expect(sale.items[0].unitPrice).toBe(4500);
    expect(sale.payments[0]).toMatchObject({ amount: 9000, tendered: 10_000 });
    expect(h.db.value<number>('SELECT unit_cost FROM sale_items')).toBe(3000);
  });

  it('ignore le prix envoyé par le client sans permission de dérogation et plafonne la remise du caissier', async () => {
    const h = await shop();
    const p = await h.product('Savon', { price: 1000, cost: 500, qty: 10 });
    const cashier = await h.user('caissier2', 'CASHIER');
    // le caissier ne peut pas ouvrir une session sur la caisse déjà ouverte par l'admin ; il vend sur la session existante
    await h.fails('sales.create', { registerId: h.ids.register, items: [{ variantId: p.variantId, qtyMilli: 1000, unitPrice: 1 }], payments: [{ methodId: h.ids.pm_CASH, amount: 1000 }] }, 'FORBIDDEN', cashier);
    await h.fails('sales.create', { registerId: h.ids.register, items: [{ variantId: p.variantId, qtyMilli: 1000, discountBp: 5000 }], payments: [{ methodId: h.ids.pm_CASH, amount: 500 }] }, 'DISCOUNT_LIMIT', cashier);
    const ok = await h.call('sales.create', { registerId: h.ids.register, items: [{ variantId: p.variantId, qtyMilli: 1000, discountBp: 1000 }], payments: [{ methodId: h.ids.pm_CASH, amount: 900 }] }, cashier);
    expect(ok.total).toBe(900);
  });

  it('est tout-ou-rien : stock insuffisant => aucune vente, aucun mouvement, aucun paiement', async () => {
    const h = await shop();
    const a = await h.product('A', { price: 100, qty: 5 });
    const b = await h.product('B', { price: 100, qty: 1 });
    await h.fails('sales.create', { registerId: h.ids.register, items: [{ variantId: a.variantId, qtyMilli: 2000 }, { variantId: b.variantId, qtyMilli: 3000 }], payments: [{ methodId: h.ids.pm_CASH, amount: 500 }] }, 'INSUFFICIENT_STOCK');
    expect(h.db.value<number>('SELECT COUNT(*) FROM sales')).toBe(0);
    expect(h.db.value<number>('SELECT COUNT(*) FROM payments')).toBe(0);
    expect(h.stock(a.variantId)).toBe(5000);
    expect(h.db.value<number>("SELECT COUNT(*) FROM stock_movements WHERE type = 'SALE'")).toBe(0);
  });

  it('est idempotente : rejouer le même identifiant ne duplique rien', async () => {
    const h = await shop();
    const p = await h.product('Eau', { price: 500, qty: 10 });
    const body = { id: crypto.randomUUID(), registerId: h.ids.register, items: [{ variantId: p.variantId, qtyMilli: 1000 }], payments: [{ methodId: h.ids.pm_CASH, amount: 500 }] };
    const a = await h.call('sales.create', body);
    const b = await h.call('sales.create', body);
    expect(b.duplicate).toBe(true);
    expect(b.number).toBe(a.number);
    expect(h.stock(p.variantId)).toBe(9000);
    expect(sumFT(h, 'SALE_RECEIPT')).toBe(500);
  });

  it('exige une caisse ouverte', async () => {
    const h = await new Harness().boot();
    const p = await h.product('Eau', { price: 500, qty: 10 });
    await h.fails('sales.create', { registerId: h.ids.register, items: [{ variantId: p.variantId, qtyMilli: 1000 }], payments: [{ methodId: h.ids.pm_CASH, amount: 500 }] }, 'NO_SESSION');
  });

  it('gère paiements multiples (espèces + mobile money) sans double comptage', async () => {
    const h = await shop();
    const p = await h.product('Téléphone', { price: 100_000, cost: 70_000, qty: 3 });
    const r = await h.call('sales.create', { registerId: h.ids.register, items: [{ variantId: p.variantId, qtyMilli: 1000 }], payments: [{ methodId: h.ids.pm_MVOLA, amount: 60_000 }, { methodId: h.ids.pm_CASH, amount: 50_000 }] });
    expect(r.change).toBe(10_000);
    expect(sumFT(h, 'SALE_RECEIPT')).toBe(100_000);
    const accounts = await h.call('finance.accounts');
    const cashAcc = accounts.find((a: any) => a.type === 'CASH');
    const mobAcc = accounts.find((a: any) => a.type === 'MOBILE');
    expect(cashAcc.balance).toBe(40_000);
    expect(mobAcc.balance).toBe(60_000);
  });

  it('vend à crédit dans la limite du plafond, puis encaisse la dette (FIFO) et crée une avance sur l’excédent', async () => {
    const h = await shop();
    const p = await h.product('Ciment', { price: 30_000, cost: 22_000, qty: 100 });
    const { id: cid } = await h.call('customers.save', { name: 'Rakoto', creditLimit: 100_000 });
    await h.fails('sales.create', { registerId: h.ids.register, items: [{ variantId: p.variantId, qtyMilli: 1000 }], payments: [] }, 'CUSTOMER_REQUIRED');
    await h.fails('sales.create', { registerId: h.ids.register, customerId: cid, items: [{ variantId: p.variantId, qtyMilli: 4000 }], payments: [] }, 'CREDIT_LIMIT');
    const s1 = await h.call('sales.create', { registerId: h.ids.register, customerId: cid, items: [{ variantId: p.variantId, qtyMilli: 2000 }], payments: [{ methodId: h.ids.pm_CASH, amount: 20_000 }] });
    expect(s1).toMatchObject({ total: 60_000, paidTotal: 20_000, creditAmount: 40_000 });
    expect((await h.call('customers.get', { id: cid })).balance).toBe(40_000);
    expect(sumFT(h, 'SALE_RECEIPT')).toBe(20_000); // la créance n'est PAS un encaissement
    const pay = await h.call('customers.receivePayment', { customerId: cid, methodId: h.ids.pm_CASH, amount: 50_000 });
    expect(pay).toMatchObject({ appliedToDebt: 40_000, advance: 10_000 });
    const c = await h.call('customers.get', { id: cid });
    expect(c.balance).toBe(-10_000);
    expect((await h.call('sales.get', { id: s1.id })).paymentStatus).toBe('PAID');
    // l'avance est utilisable sur une vente suivante
    const s2 = await h.call('sales.create', { registerId: h.ids.register, customerId: cid, items: [{ variantId: p.variantId, qtyMilli: 1000 }], advanceUsed: 10_000, payments: [{ methodId: h.ids.pm_CASH, amount: 20_000 }] });
    expect(s2.paidTotal).toBe(30_000);
    expect((await h.call('customers.get', { id: cid })).balance).toBe(0);
  });

  it('applique les prix de gros aux clients grossistes et les promotions en cours', async () => {
    const h = await shop();
    const p = await h.product('Huile', { price: 5000, wholesale: 4200, cost: 3500, qty: 100 });
    const { id: cid } = await h.call('customers.save', { name: 'Grossiste', priceTier: 'WHOLESALE' });
    const r = await h.call('sales.create', { registerId: h.ids.register, customerId: cid, items: [{ variantId: p.variantId, qtyMilli: 10_000 }], payments: [{ methodId: h.ids.pm_CASH, amount: 42_000 }] });
    expect(r.total).toBe(42_000);
  });

  it('calcule la taxe incluse dans le prix', async () => {
    const h = await shop();
    const p = await h.product('Ordinateur', { price: 1_200_000, cost: 900_000, qty: 2, tax: h.ids.tax20 });
    const r = await h.call('sales.create', { registerId: h.ids.register, items: [{ variantId: p.variantId, qtyMilli: 1000 }], payments: [{ methodId: h.ids.pm_CASH, amount: 1_200_000 }] });
    const s = await h.call('sales.get', { id: r.id });
    expect(s).toMatchObject({ total: 1_200_000, netTotal: 1_000_000, taxTotal: 200_000 });
  });
});

describe('retours et remboursements', () => {
  it('rembourse en espèces, remet en stock et reste cohérent sur plusieurs retours partiels', async () => {
    const h = await shop();
    const p = await h.product('Chemise', { price: 20_000, cost: 12_000, qty: 10 });
    const s = await h.call('sales.create', { registerId: h.ids.register, items: [{ variantId: p.variantId, qtyMilli: 3000 }], payments: [{ methodId: h.ids.pm_CASH, amount: 60_000 }] });
    const sale = await h.call('sales.get', { id: s.id });
    const item = sale.items[0].id;
    const r1 = await h.call('sales.return', { saleId: s.id, items: [{ saleItemId: item, qtyMilli: 1000 }], refundMethodId: h.ids.pm_CASH, reason: 'Taille' });
    expect(r1).toMatchObject({ total: 20_000, refunded: 20_000 });
    expect(h.stock(p.variantId)).toBe(8000);
    await h.fails('sales.return', { saleId: s.id, items: [{ saleItemId: item, qtyMilli: 3000 }], refundMethodId: h.ids.pm_CASH }, 'OVER_RETURN');
    const r2 = await h.call('sales.return', { saleId: s.id, items: [{ saleItemId: item, qtyMilli: 2000 }], refundMethodId: h.ids.pm_CASH });
    expect(r1.total + r2.total).toBe(60_000);
    expect(sumFT(h, 'REFUND')).toBe(-60_000);
    expect(sumFT(h)).toBe(0); // recette - remboursements = 0
    expect((await h.call('cash.current')).expectedCash).toBe(10_000);
    const d = await h.call('dashboard.get', {});
    expect(d.revenue).toBe(0);
    expect(d.grossProfit).toBe(0);
  });

  it('un retour sur vente à crédit réduit la créance avant de rembourser', async () => {
    const h = await shop();
    const p = await h.product('Tissu', { price: 10_000, cost: 6000, qty: 20 });
    const { id: cid } = await h.call('customers.save', { name: 'Client A', creditLimit: 500_000 });
    const s = await h.call('sales.create', { registerId: h.ids.register, customerId: cid, items: [{ variantId: p.variantId, qtyMilli: 5000 }], payments: [{ methodId: h.ids.pm_CASH, amount: 20_000 }] });
    expect(s.creditAmount).toBe(30_000);
    const item = (await h.call('sales.get', { id: s.id })).items[0].id;
    const r = await h.call('sales.return', { saleId: s.id, items: [{ saleItemId: item, qtyMilli: 4000 }], refundMethodId: h.ids.pm_CASH });
    // total retourné 40 000 ; la vente valait 50 000 et 20 000 ont été payés : il reste 10 000 dû, donc 10 000 remboursés + 30 000 d'annulation de créance
    expect(r).toMatchObject({ total: 40_000, refunded: 10_000, receivableReduction: 30_000 });
    expect((await h.call('customers.get', { id: cid })).balance).toBe(0);
  });
});

describe('immuabilité des opérations validées', () => {
  it('interdit toute modification ou suppression directe des écritures financières', async () => {
    const h = await shop();
    const p = await h.product('Stylo', { price: 500, qty: 10 });
    const s = await h.call('sales.create', { registerId: h.ids.register, items: [{ variantId: p.variantId, qtyMilli: 1000 }], payments: [{ methodId: h.ids.pm_CASH, amount: 500 }] });
    expect(() => h.db.run('DELETE FROM sales WHERE id = ?', s.id)).toThrow(/IMMUTABLE/);
    expect(() => h.db.run('UPDATE sales SET total = 1 WHERE id = ?', s.id)).toThrow(/IMMUTABLE/);
    expect(() => h.db.run('DELETE FROM financial_transactions')).toThrow(/IMMUTABLE/);
    expect(() => h.db.run('UPDATE payments SET amount = 1')).toThrow(/IMMUTABLE/);
    expect(() => h.db.run('DELETE FROM stock_movements')).toThrow(/IMMUTABLE/);
    expect(() => h.db.run('DELETE FROM audit_log')).toThrow(/IMMUTABLE/);
  });
});
