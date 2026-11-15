import { describe, expect, it } from 'vitest';
import { Harness } from './helpers';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Indian/Antananarivo' });

describe('catalogue', () => {
  it('refuse les doublons de SKU / code-barres, trace l’historique des prix', async () => {
    const h = await new Harness().boot();
    const a = await h.product('A', { price: 1000, sku: 'SKU-1', barcode: '3760001' });
    await h.fails('products.save', { name: 'B', variants: [{ sku: 'SKU-1', costPrice: 1, price: 2 }] }, 'DUPLICATE_SKU');
    await h.fails('products.save', { name: 'C', variants: [{ costPrice: 1, price: 2, barcodes: ['3760001'] }] }, 'DUPLICATE_BARCODE');
    const prod = await h.call('products.get', { id: a.productId });
    await h.call('products.save', { ...prod, variants: [{ ...prod.variants[0], price: 1200 }] });
    const hist = await h.call('products.get', { id: a.productId });
    expect(hist.variants[0].priceHistory.some((x: any) => x.field === 'price' && x.oldValue === 1000 && x.newValue === 1200)).toBe(true);
    const found = await h.call('sellable.byCode', { code: '3760001' });
    expect(found).toMatchObject({ sku: 'SKU-1', price: 1200 });
    expect(await h.call('sellable.byCode', { code: 'inconnu' })).toBeNull();
  });

  it('applique une promotion datée', async () => {
    const h = await new Harness().boot();
    const r = await h.call('products.save', { name: 'Promo', variants: [{ costPrice: 100, price: 1000, promoPrice: 800, promoStart: '2000-01-01', promoEnd: '2999-12-31', openingQtyMilli: 5000 }] });
    const p = await h.call('products.get', { id: r.id });
    const s = await h.call('sellable.search', { q: 'Promo' });
    expect(s[0]).toMatchObject({ price: 800, promo: true, basePrice: 1000 });
    expect(p.variants[0].promoPrice).toBe(800);
  });
});

describe('stock', () => {
  it('calcule le coût moyen pondéré, valorise, trace chaque mouvement', async () => {
    const h = await new Harness().boot();
    const p = await h.product('Farine', { price: 3000, cost: 2000, qty: 10 });
    await h.call('stock.adjust', { warehouseId: h.ids.warehouse, variantId: p.variantId, type: 'IN', qtyMilli: 10_000, unitCost: 2400 });
    const val = await h.call('stock.valuation');
    expect(val.value).toBe(20 * 2200);
    const mv = await h.call('stock.movements', { variantId: p.variantId });
    expect(mv).toHaveLength(2);
  });

  it('refuse un stock négatif, exige un motif pour les pertes, transfère entre entrepôts', async () => {
    const h = await new Harness().boot();
    const p = await h.product('Sucre', { price: 2500, cost: 1800, qty: 5 });
    await h.fails('stock.adjust', { warehouseId: h.ids.warehouse, variantId: p.variantId, type: 'OUT', qtyMilli: 9000, reason: 'test' }, 'INSUFFICIENT_STOCK');
    await h.fails('stock.adjust', { warehouseId: h.ids.warehouse, variantId: p.variantId, type: 'LOSS', qtyMilli: 1000 }, 'REASON_REQUIRED');
    await h.call('stock.adjust', { warehouseId: h.ids.warehouse, variantId: p.variantId, type: 'DAMAGED', qtyMilli: 1000, reason: 'Sac déchiré' });
    const br = await h.call('org.branches');
    const w2 = (await h.call('org.saveWarehouse', { branchId: br[0].id, name: 'Dépôt' })).id;
    const t = await h.call('stock.transfer', { fromWarehouseId: h.ids.warehouse, toWarehouseId: w2, items: [{ variantId: p.variantId, qtyMilli: 3000 }] });
    expect(t.number).toMatch(/^TR-/);
    expect(h.stock(p.variantId)).toBe(1000);
    expect(h.stock(p.variantId, w2)).toBe(3000);
    await h.fails('stock.transfer', { fromWarehouseId: h.ids.warehouse, toWarehouseId: w2, items: [{ variantId: p.variantId, qtyMilli: 5000 }] }, 'INSUFFICIENT_STOCK');
    expect(h.stock(p.variantId)).toBe(1000);
  });

  it('valide un inventaire en générant les écarts', async () => {
    const h = await new Harness().boot();
    const p = await h.product('Lait', { price: 1500, cost: 1000, qty: 10 });
    const inv = await h.call('inventory.create', { warehouseId: h.ids.warehouse });
    await h.call('inventory.count', { inventoryId: inv.id, variantId: p.variantId, countedMilli: 7000 });
    const r = await h.call('inventory.validate', { id: inv.id });
    expect(r.adjusted).toBe(1);
    expect(h.stock(p.variantId)).toBe(7000);
    await h.fails('inventory.validate', { id: inv.id }, 'LOCKED');
  });

  it('consomme les lots selon FEFO (premier expiré, premier sorti)', async () => {
    const h = await new Harness().boot();
    const p = await h.product('Yaourt', { price: 800, cost: 500, lots: true });
    const w = h.ids.warehouse;
    await h.call('stock.adjust', { warehouseId: w, variantId: p.variantId, type: 'IN', qtyMilli: 5000, lotNo: 'L-TARD', expiryDate: '2030-06-01', unitCost: 500 });
    await h.call('stock.adjust', { warehouseId: w, variantId: p.variantId, type: 'IN', qtyMilli: 5000, lotNo: 'L-TOT', expiryDate: '2029-01-01', unitCost: 500 });
    await h.openCash();
    await h.call('sales.create', { registerId: h.ids.register, items: [{ variantId: p.variantId, qtyMilli: 6000 }], payments: [{ methodId: h.ids.pm_CASH, amount: 4800 }] });
    const lots = h.db.all<any>('SELECT lot_no, qty_milli FROM stock_lots ORDER BY lot_no');
    expect(lots).toEqual([{ lot_no: 'L-TARD', qty_milli: 4000 }, { lot_no: 'L-TOT', qty_milli: 0 }]);
    const exp = await h.call('stock.expiring', { days: 3650 });
    expect(exp.length).toBe(1);
  });
});

describe('achats & fournisseurs', () => {
  it('réceptionne partiellement, valorise au coût d’approche, crée la dette et gère les paiements partiels', async () => {
    const h = await new Harness().boot();
    const p = await h.product('Thé', { price: 5000, cost: 0 });
    const sup = (await h.call('suppliers.save', { name: 'Import SA' })).id;
    const po = await h.call('purchases.create', { supplierId: sup, warehouseId: h.ids.warehouse, items: [{ variantId: p.variantId, qtyMilli: 100_000, unitCost: 2000 }], shippingCost: 20_000, dueDate: '2030-01-31' });
    expect(po.total).toBe(200_000);
    const full = await h.call('purchases.get', { id: po.id });
    const rec = await h.call('purchases.receive', { purchaseId: po.id, items: [{ purchaseItemId: full.items[0].id, qtyMilli: 40_000 }] });
    expect(rec.total).toBe(80_000);
    expect(h.stock(p.variantId)).toBe(40_000);
    expect((await h.call('purchases.get', { id: po.id })).status).toBe('PARTIAL');
    // frais d'approche : 20 000 × 40 % = 8 000 sur 40 pièces = 200 / pièce
    expect(h.db.value<number>('SELECT avg_cost FROM stock WHERE variant_id = ?', p.variantId)).toBe(2200);
    expect((await h.call('suppliers.get', { id: sup })).balance).toBe(80_000);
    await h.fails('purchases.receive', { purchaseId: po.id, items: [{ purchaseItemId: full.items[0].id, qtyMilli: 70_000 }] }, 'OVER_RECEIPT');
    await h.fails('suppliers.pay', { supplierId: sup, methodId: h.ids.pm_TRANSFER, amount: 90_000 }, 'OVERPAYMENT');
    await h.call('ref.paymentMethods');
    await h.call('finance.ownerMovement', { accountId: (await h.call('finance.accounts')).find((a: any) => a.type === 'BANK').id, kind: 'CAPITAL_CONTRIBUTION', amount: 500_000 });
    await h.call('suppliers.pay', { supplierId: sup, methodId: h.ids.pm_TRANSFER, amount: 30_000 });
    expect((await h.call('suppliers.get', { id: sup })).balance).toBe(50_000);
    const pay = await h.call('finance.payables');
    expect(pay[0]).toMatchObject({ total: 80_000, paidTotal: 30_000, due: 50_000 });
    await h.call('purchases.receive', { purchaseId: po.id, items: [{ purchaseItemId: full.items[0].id, qtyMilli: 60_000 }] });
    expect((await h.call('purchases.get', { id: po.id })).status).toBe('RECEIVED');
    await h.fails('purchases.cancel', { id: po.id }, 'LOCKED');
  });
});

describe('caisse', () => {
  it('exige un commentaire en cas d’écart, interdit la double ouverture, bloque les ventes après clôture', async () => {
    const h = await new Harness().boot();
    const s = await h.openCash(5000);
    await h.fails('cash.open', { registerId: h.ids.register, openingFloat: 0 }, 'SESSION_OPEN');
    await h.fails('cash.close', { sessionId: s.id, countedCash: 4000 }, 'NOTE_REQUIRED');
    const r = await h.call('cash.close', { sessionId: s.id, countedCash: 4000, note: 'Erreur de rendu' });
    expect(r).toMatchObject({ expectedCash: 5000, difference: -1000 });
    const p = await h.product('X', { price: 100, qty: 5 });
    await h.fails('sales.create', { registerId: h.ids.register, items: [{ variantId: p.variantId, qtyMilli: 1000 }], payments: [{ methodId: h.ids.pm_CASH, amount: 100 }] }, 'NO_SESSION');
  });

  it('répercute l’écart de clôture sur le solde du compte espèces (le compte reflète la réalité)', async () => {
    const h = await new Harness().boot();
    const s = await h.openCash(0);
    const p = await h.product('Y', { price: 5000, cost: 3000, qty: 10 });
    await h.call('sales.create', { registerId: h.ids.register, items: [{ variantId: p.variantId, qtyMilli: 2000 }], payments: [{ methodId: h.ids.pm_CASH, amount: 10_000 }] });
    const cashBal = async () => (await h.call('finance.accounts')).find((a: any) => a.id === h.ids.account).balance;
    expect(await cashBal()).toBe(10_000);
    await h.call('cash.close', { sessionId: s.id, countedCash: 9_000, note: 'Manque 1 000' }); // manque : −1 000
    expect(await cashBal()).toBe(9_000);
    const tx = await h.call('finance.transactions', { kind: 'ADJUSTMENT' });
    expect(tx).toHaveLength(1);
    expect(tx[0]).toMatchObject({ amount: -1000 });
    // un écart nul ne crée aucune écriture
    const s2 = await h.openCash(0);
    await h.call('cash.close', { sessionId: s2.id, countedCash: 0 });
    expect(await h.call('finance.transactions', { kind: 'ADJUSTMENT' })).toHaveLength(1);
  });
});

describe('finances & tableau de bord', () => {
  it('sépare CA, encaissements, apports, remboursements, dépenses et virements (aucun double comptage)', async () => {
    const h = await new Harness().boot();
    await h.openCash(0);
    const p = await h.product('Article', { price: 10_000, cost: 6000, qty: 50 });
    const accounts = await h.call('finance.accounts');
    const cash = accounts.find((a: any) => a.type === 'CASH');
    const bank = accounts.find((a: any) => a.type === 'BANK');
    const cats = await h.call('ref.expenseCategories');

    await h.call('finance.ownerMovement', { accountId: cash.id, kind: 'CAPITAL_CONTRIBUTION', amount: 100_000, note: 'Apport' });
    await h.call('sales.create', { registerId: h.ids.register, items: [{ variantId: p.variantId, qtyMilli: 5000 }], payments: [{ methodId: h.ids.pm_CASH, amount: 50_000 }] });
    const { id: cid } = await h.call('customers.save', { name: 'Crédit', creditLimit: 100_000 });
    await h.call('sales.create', { registerId: h.ids.register, customerId: cid, items: [{ variantId: p.variantId, qtyMilli: 2000 }], payments: [] });
    await h.call('finance.createExpense', { accountId: cash.id, categoryId: cats[0].id, amount: 15_000, description: 'Loyer' });
    await h.call('finance.transfer', { fromAccountId: cash.id, toAccountId: bank.id, amount: 60_000 });
    await h.fails('finance.createExpense', { accountId: bank.id, amount: 9_999_999, description: 'Trop' }, 'INSUFFICIENT_FUNDS');

    const d = await h.call('dashboard.get', { from: today(), to: today() });
    expect(d.revenue).toBe(70_000); // CA = ventes (y compris à crédit), pas les apports
    expect(d.grossProfit).toBe(70_000 - 7000 * 6000 / 1000);
    expect(d.finance.expenses).toBe(15_000);
    expect(d.finance.cashflow).toMatchObject({ saleReceipts: 50_000, capitalContributions: 100_000, expenses: 15_000, transfersNet: 0, netChange: 135_000 });
    expect(d.finance.treasury).toBe(135_000);
    expect(d.finance.customerDebt).toBe(20_000);
    expect(d.finance.unpaidInvoices).toMatchObject({ count: 1, amount: 20_000 });
    expect(d.stockValue).toBe(43_000 * 6000 / 1000);
    expect(d.sales.today).toMatchObject({ count: 2, total: 70_000 });
    expect(d.topProducts[0]).toMatchObject({ qtyMilli: 7000, revenue: 70_000 });
    expect(d.series.at(-1)).toMatchObject({ revenue: 70_000, sales: 2, expenses: 15_000 });
    // somme des soldes = somme des écritures
    const accs = await h.call('finance.accounts');
    expect(accs.reduce((s: number, a: any) => s + a.balance, 0)).toBe(135_000);
  });

  it('masque les données financières sans permission', async () => {
    const h = await new Harness().boot();
    const roles = await h.call('roles.list');
    const role = (await h.call('roles.save', { name: 'Voir ventes', permissions: ['dashboard.view', 'sale.view'] })).id;
    await h.call('users.create', { username: 'viewer', displayName: 'Viewer', password: 'Passw0rd!x', roleId: role });
    const t = (await h.app.call('auth.login', { username: 'viewer', password: 'Passw0rd!x' }) as any).data.token;
    const d = await h.call('dashboard.get', {}, t);
    expect(d.finance).toBeNull();
    expect(roles.length).toBeGreaterThan(3);
  });

  it('exporte les rapports en CSV sûr (anti-injection de formule) et XLSX', async () => {
    const h = await new Harness().boot();
    await h.openCash();
    const p = await h.product('=CMD()', { price: 100, qty: 5 });
    await h.call('sales.create', { registerId: h.ids.register, items: [{ variantId: p.variantId, qtyMilli: 1000 }], payments: [{ methodId: h.ids.pm_CASH, amount: 100 }] });
    const rep = await h.call('reports.run', { type: 'sales_by_product', from: today(), to: today() });
    expect(rep.rows).toHaveLength(1);
    const { reportToCsv, reportToXlsx } = await import('../src/main/core/reports');
    const ctx = h.app.sessions.resolve(h.token);
    const csv = reportToCsv(ctx, rep);
    expect(csv).toContain("'=CMD()");
    const buf = await reportToXlsx(ctx, rep);
    expect(buf.subarray(0, 2).toString()).toBe('PK');
  });
});
