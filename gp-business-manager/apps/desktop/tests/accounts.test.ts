import { describe, expect, it } from 'vitest';
import { Harness } from './helpers';
import { ensureSystemRoles } from '../src/main/core/auth';

async function twoBranches(h: Harness) {
  const b1 = (await h.call('org.branches'))[0].id as string;
  const b2 = (await h.call('org.saveBranch', { name: 'Boutique Nord' })).id as string;
  const w2 = (await h.call('org.saveWarehouse', { branchId: b2, name: 'Stock Nord' })).id as string;
  const r2 = (await h.call('org.saveRegister', { branchId: b2, warehouseId: w2, name: 'Caisse Nord' })).id as string;
  return { b1, b2, w2, r2 };
}

describe('profils et comptes (administrateur, gérant, responsable des ventes, vendeuse)', () => {
  it('propose les quatre profils avec leur description', async () => {
    const h = await new Harness().boot();
    const roles = await h.call('roles.list');
    const by = (c: string) => roles.find((r: any) => r.code === c);
    expect(by('ADMIN').name).toBe('Administrateur');
    expect(by('MANAGER').name).toBe('Gérant');
    expect(by('SALES_MANAGER').name).toBe('Responsable des ventes');
    expect(by('CASHIER').name).toBe('Vendeur / Vendeuse');
    for (const c of ['ADMIN', 'MANAGER', 'SALES_MANAGER', 'CASHIER']) expect(by(c).description.length).toBeGreaterThan(20);
    expect(by('SALES_MANAGER').permissions).toContain('sale.discount');
    expect(by('SALES_MANAGER').permissions).not.toContain('finance.view');
  });

  it('l’administrateur crée les comptes ; seul lui peut le faire', async () => {
    const h = await new Harness().boot();
    const roles = await h.call('roles.list');
    const id = (c: string) => roles.find((r: any) => r.code === c).id;
    await h.call('users.create', { username: 'gerant1', displayName: 'Le Gérant', password: 'Temp0raire!', roleId: id('MANAGER'), mustChangePassword: false });
    await h.call('users.create', { username: 'resp.ventes', displayName: 'Resp Ventes', password: 'Temp0raire!', roleId: id('SALES_MANAGER') });
    const manager = (await h.app.call('auth.login', { username: 'gerant1', password: 'Temp0raire!' }) as any).data.token;
    // le gérant ne peut pas gérer les comptes
    await h.fails('users.create', { username: 'x.y.z', displayName: 'X', password: 'Temp0raire!', roleId: id('CASHIER') }, 'FORBIDDEN', manager);
    const list = await h.call('users.list');
    expect(list.map((u: any) => u.roleCode).sort()).toEqual(['ADMIN', 'MANAGER', 'SALES_MANAGER']);
  });

  it('mot de passe temporaire : tout est bloqué jusqu’au changement, puis l’accès s’ouvre', async () => {
    const h = await new Harness().boot();
    const roles = await h.call('roles.list');
    await h.call('users.create', { username: 'vendeuse1', displayName: 'Vendeuse', password: 'Temp0raire!', roleId: roles.find((r: any) => r.code === 'CASHIER').id });
    const t = (await h.app.call('auth.login', { username: 'vendeuse1', password: 'Temp0raire!' }) as any).data.token;
    expect((await h.call('auth.me', undefined, t)).mustChangePassword).toBe(true);
    await h.fails('products.list', {}, 'PASSWORD_CHANGE_REQUIRED', t);
    await h.fails('auth.changePassword', { oldPassword: 'Temp0raire!', newPassword: 'Temp0raire!' }, 'SAME_PASSWORD', t);
    await h.call('auth.changePassword', { oldPassword: 'Temp0raire!', newPassword: 'MonVraiMdp#7' }, t);
    expect((await h.call('auth.me', undefined, t)).mustChangePassword).toBe(false);
    expect(await h.call('products.list', {}, t)).toBeTruthy();
    // si l'administrateur réinitialise ensuite le mot de passe, le changement est de nouveau exigé
    const uid = (await h.call('users.list')).find((u: any) => u.username === 'vendeuse1').id;
    await h.call('users.update', { id: uid, password: 'AutreTemp#9' });
    const t2 = (await h.app.call('auth.login', { username: 'vendeuse1', password: 'AutreTemp#9' }) as any).data.token;
    await h.fails('products.list', {}, 'PASSWORD_CHANGE_REQUIRED', t2);
  });

  it('une vendeuse rattachée à une boutique ne voit et ne vend que dans sa boutique', async () => {
    const h = await new Harness().boot();
    const { b1, b2, w2, r2 } = await twoBranches(h);
    const p = await h.product('T-shirt', { price: 20_000, cost: 8_000, qty: 10 });
    await h.call('stock.adjust', { warehouseId: w2, variantId: p.variantId, type: 'IN', qtyMilli: 5000 });
    const roles = await h.call('roles.list');
    await h.call('users.create', { username: 'vend.nord', displayName: 'Vendeuse Nord', password: 'Temp0raire!', roleId: roles.find((r: any) => r.code === 'CASHIER').id, branchId: b2, mustChangePassword: false });
    const v = (await h.app.call('auth.login', { username: 'vend.nord', password: 'Temp0raire!' }) as any).data.token;

    // elle ne voit que sa boutique, son entrepôt et sa caisse
    expect((await h.call('org.branches', undefined, v)).map((b: any) => b.id)).toEqual([b2]);
    expect((await h.call('org.warehouses', undefined, v)).map((w: any) => w.id)).toEqual([w2]);
    expect((await h.call('org.registers', undefined, v)).map((r: any) => r.id)).toEqual([r2]);
    // l'administrateur voit tout
    expect((await h.call('org.branches')).length).toBe(2);

    // elle ne peut pas ouvrir/vendre sur la caisse d'une autre boutique
    await h.fails('cash.open', { registerId: h.ids.register, openingFloat: 0 }, 'BRANCH_FORBIDDEN', v);
    await h.call('cash.open', { registerId: r2, openingFloat: 1000 }, v);
    await h.fails('sales.create', { registerId: h.ids.register, items: [{ variantId: p.variantId, qtyMilli: 1000 }], payments: [] }, 'BRANCH_FORBIDDEN', v);
    const s = await h.call('sales.create', { registerId: r2, items: [{ variantId: p.variantId, qtyMilli: 1000 }], payments: [{ methodId: h.ids.pm_CASH, amount: 20_000 }] }, v);
    expect(s.total).toBe(20_000);
    expect(h.stock(p.variantId, w2)).toBe(4000);      // sorti du stock Nord
    expect(h.stock(p.variantId, h.ids.warehouse)).toBe(10_000); // le stock du siège n'a pas bougé

    // stock : seulement sa boutique ; pas d'action sur l'entrepôt du siège
    const levels = await h.call('stock.levels', {}, v);
    expect(new Set(levels.map((l: any) => l.warehouseId))).toEqual(new Set([w2]));
    await h.fails('stock.adjust', { warehouseId: h.ids.warehouse, variantId: p.variantId, type: 'IN', qtyMilli: 1000 }, 'FORBIDDEN', v); // pas la permission
    // une vente du siège n'apparaît pas dans sa liste, et lui est inaccessible
    await h.openCash(0);
    const hq = await h.call('sales.create', { registerId: h.ids.register, items: [{ variantId: p.variantId, qtyMilli: 1000 }], payments: [{ methodId: h.ids.pm_CASH, amount: 20_000 }] });
    expect((await h.call('sales.list', {}, v)).rows.map((r: any) => r.id)).toEqual([s.id]);
    await h.fails('sales.get', { id: hq.id }, 'NOT_FOUND', v);
    expect((await h.call('sales.list', {})).total).toBe(2);
    void b1;
  });

  it('le responsable des ventes et le gérant voient toutes les boutiques même s’ils sont rattachés à l’une', async () => {
    const h = await new Harness().boot();
    const { b2 } = await twoBranches(h);
    const roles = await h.call('roles.list');
    await h.call('users.create', { username: 'resp.v', displayName: 'Resp', password: 'Temp0raire!', roleId: roles.find((r: any) => r.code === 'SALES_MANAGER').id, branchId: b2, mustChangePassword: false });
    const t = (await h.app.call('auth.login', { username: 'resp.v', password: 'Temp0raire!' }) as any).data.token;
    expect((await h.call('org.branches', undefined, t)).length).toBe(2);
  });

  it('mise à jour d’une base existante : nouveaux rôles ajoutés, « Caissier » renommé, droits personnalisés conservés', async () => {
    const h = await new Harness().boot();
    // simule une base de la version 0.1 / 0.2 : pas de rôle « Responsable des ventes », ancien nom, droit retiré à la main
    h.db.run("DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE code = 'SALES_MANAGER')");
    h.db.run("DELETE FROM roles WHERE code = 'SALES_MANAGER'");
    h.db.run("UPDATE roles SET name = 'Caissier' WHERE code = 'CASHIER'");
    h.db.run("DELETE FROM role_permissions WHERE permission = 'branch.all'");
    h.db.run("DELETE FROM role_permissions WHERE permission = 'customer.manage' AND role_id = (SELECT id FROM roles WHERE code = 'CASHIER')");
    ensureSystemRoles(h.db);
    const roles = await h.call('roles.list');
    expect(roles.find((r: any) => r.code === 'SALES_MANAGER').permissions).toContain('branch.all');
    expect(roles.find((r: any) => r.code === 'CASHIER').name).toBe('Vendeur / Vendeuse');
    expect(roles.find((r: any) => r.code === 'ADMIN').permissions).toContain('branch.all');
    expect(roles.find((r: any) => r.code === 'CASHIER').permissions).not.toContain('customer.manage'); // personnalisation respectée
    ensureSystemRoles(h.db); // idempotent
    expect((await h.call('roles.list')).filter((r: any) => r.code === 'SALES_MANAGER')).toHaveLength(1);
  });
});
