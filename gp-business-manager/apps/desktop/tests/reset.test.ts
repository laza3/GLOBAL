import { describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Harness } from './helpers';
import { assertCanFactoryReset, deleteBackupFiles, resetBusinessData, RESET_PHRASE } from '../src/main/core/reset';

const ctxOf = (h: Harness, token = h.token) => h.app.sessions.resolve(token);

describe('réinitialisation des données de gestion', () => {
  it('refuse tout profil autre qu’administrateur (même un gérant) et le journalise', async () => {
    const h = await new Harness().boot();
    const mgr = await h.user('gerant.x', 'MANAGER');
    expect(() => assertCanFactoryReset(ctxOf(h, mgr), 'Passw0rd!x', RESET_PHRASE)).toThrow(/Seul un administrateur/);
    const cash = await h.user('vend.x', 'CASHIER');
    expect(() => assertCanFactoryReset(ctxOf(h, cash), 'Passw0rd!x', RESET_PHRASE)).toThrow(/Seul un administrateur/);
    expect((await h.call('audit.list', { action: 'security.forbidden' })).length).toBeGreaterThanOrEqual(2);
  });

  it('exige la phrase exacte ET le bon mot de passe ; 5 mots de passe faux verrouillent le compte', async () => {
    const h = await new Harness().boot();
    const ctx = ctxOf(h);
    expect(() => assertCanFactoryReset(ctx, 'Admin#2026', 'effacer')).toThrow(/Recopiez/);
    for (let i = 0; i < 4; i++) expect(() => assertCanFactoryReset(ctx, 'mauvais', RESET_PHRASE)).toThrow(/incorrect/);
    expect(() => assertCanFactoryReset(ctx, 'mauvais', RESET_PHRASE)).toThrow(/incorrect/); // 5e échec : verrouillage
    expect(() => assertCanFactoryReset(ctx, 'Admin#2026', RESET_PHRASE)).toThrow(/verrouillé/);
  });

  it('accepte avec le bon mot de passe et la phrase (insensible à la casse), puis journalise', async () => {
    const h = await new Harness().boot();
    expect(() => assertCanFactoryReset(ctxOf(h), 'Admin#2026', ' tout effacer ')).not.toThrow();
    expect((await h.call('audit.list', { action: 'app.reset_business_data' })).length).toBe(1);
  });

  it('efface TOUT le contenu de gestion mais conserve comptes, rôles, paramètres et structure ; la numérotation repart de 1', async () => {
    const h = await new Harness().boot();
    await h.user('vendeuse.k', 'CASHIER'); // un compte qui doit survivre
    const triggersBefore = h.db.value<number>("SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger'");
    // contenu de toute nature
    const p = await h.product('Robe', { price: 30_000, cost: 15_000, qty: 10 });
    const sup = (await h.call('suppliers.save', { name: 'Import SA' })).id;
    const cus = (await h.call('customers.save', { name: 'Mme Rasoa', creditLimit: 100_000 })).id;
    await h.call('finance.ownerMovement', { accountId: h.ids.account, kind: 'CAPITAL_CONTRIBUTION', amount: 50_000 });
    await h.openCash(1000);
    await h.call('sales.create', { registerId: h.ids.register, customerId: cus, items: [{ variantId: p.variantId, qtyMilli: 2000 }], payments: [{ methodId: h.ids.pm_CASH, amount: 10_000 }] });
    const po = await h.call('purchases.create', { supplierId: sup, warehouseId: h.ids.warehouse, items: [{ variantId: p.variantId, qtyMilli: 5000, unitCost: 15_000 }] });
    expect(po.number).toMatch(/^BC-/);
    await h.call('finance.createExpense', { accountId: h.ids.account, amount: 1000, description: 'Loyer' });
    const usersBefore = h.db.value<number>('SELECT COUNT(*) FROM users');
    const rolesBefore = h.db.value<number>('SELECT COUNT(*) FROM roles');

    resetBusinessData(h.db);

    for (const t of ['sales', 'sale_items', 'payments', 'financial_transactions', 'cash_sessions', 'cash_movements', 'purchases', 'purchase_items', 'expenses', 'customers', 'suppliers', 'customer_ledger', 'supplier_ledger', 'products', 'product_variants', 'stock', 'stock_movements', 'invoices', 'doc_sequences', 'outbox'])
      expect(h.db.value<number>(`SELECT COUNT(*) FROM ${t}`), t).toBe(0);
    // conservés
    expect(h.db.value<number>('SELECT COUNT(*) FROM users')).toBe(usersBefore);
    expect(h.db.value<number>('SELECT COUNT(*) FROM roles')).toBe(rolesBefore);
    expect(h.db.value<string>('SELECT name FROM company')).toBe('Boutique Test');
    expect(h.db.value<number>('SELECT COUNT(*) FROM payment_methods')).toBeGreaterThan(3);
    expect(h.db.value<number>('SELECT COUNT(*) FROM cash_registers')).toBe(1);
    expect(h.db.value<number>('SELECT COUNT(*) FROM audit_log')).toBeGreaterThan(0);
    expect((await h.call('finance.accounts')).every((a: any) => a.balance === 0)).toBe(true);
    // les triggers d'immuabilité sont rétablis, à l'identique
    expect(h.db.value<number>("SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger'")).toBe(triggersBefore);

    // le logiciel repart « comme neuf » : les mêmes comptes se connectent, la numérotation repart de 1
    const t = (await h.app.call('auth.login', { username: 'vendeuse.k', password: 'Passw0rd!x' }) as any).data.token;
    expect(t).toBeTruthy();
    await h.openCash(0);
    const p2 = await h.product('Nouveau', { price: 1000, qty: 5 });
    const s = await h.call('sales.create', { registerId: h.ids.register, items: [{ variantId: p2.variantId, qtyMilli: 1000 }], payments: [{ methodId: h.ids.pm_CASH, amount: 1000 }] });
    expect(s.number).toMatch(/-000001$/);
    expect(() => h.db.run('DELETE FROM sales')).toThrow(/IMMUTABLE/);
    expect(() => h.db.run('DELETE FROM financial_transactions')).toThrow(/IMMUTABLE/);
  });

  it('supprime au choix les fichiers de sauvegarde', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gp-bk-'));
    writeFileSync(join(dir, 'auto-2026-11-15.db'), 'x'); writeFileSync(join(dir, 'a.gpbak'), 'y');
    expect(deleteBackupFiles(dir)).toBe(2);
    expect(readdirSync(dir)).toHaveLength(0);
    expect(deleteBackupFiles(join(dir, 'inexistant'))).toBe(0);
  });
});
