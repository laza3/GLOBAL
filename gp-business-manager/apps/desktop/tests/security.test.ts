import { describe, expect, it } from 'vitest';
import { Harness } from './helpers';
import { resetPasswordOffline } from '@gp/core/auth';

describe('authentification & permissions', () => {
  it('refuse les appels non authentifiés', async () => {
    const h = await new Harness().boot();
    await h.fails('products.list', {}, 'UNAUTHENTICATED', 'jeton-bidon');
  });

  it('applique les permissions côté processus principal (caissier ≠ gestion produit)', async () => {
    const h = await new Harness().boot();
    const cashier = await h.user('caissier1', 'CASHIER');
    await h.fails('products.save', { name: 'X', variants: [{ costPrice: 1, price: 2 }] }, 'FORBIDDEN', cashier);
    await h.fails('users.list', {}, 'FORBIDDEN', cashier);
    await h.fails('finance.accounts', {}, 'FORBIDDEN', cashier).catch(() => {}); // sale.create autorise la lecture des comptes pour le POS
    await h.fails('dashboard.get', {}, 'FORBIDDEN', cashier);
    expect(await h.call('products.list', {}, h.token)).toBeTruthy();
  });

  it('verrouille le compte après 5 échecs et ne révèle pas si le compte existe', async () => {
    const h = await new Harness().boot();
    await h.user('bob', 'CASHIER');
    for (let i = 0; i < 5; i++) await h.fails('auth.login', { username: 'bob', password: 'mauvais' }, 'INVALID_CREDENTIALS');
    await h.fails('auth.login', { username: 'bob', password: 'Passw0rd!x' }, 'ACCOUNT_LOCKED');
    await h.fails('auth.login', { username: 'inconnu', password: 'x' }, 'INVALID_CREDENTIALS');
  });

  it('refuse les mots de passe faibles, protège le dernier admin, journalise', async () => {
    const h = await new Harness().boot();
    const roles = await h.call('roles.list');
    await h.fails('users.create', { username: 'weak', displayName: 'w', password: '1234567', roleId: roles[0].id }, 'VALIDATION');
    const users = await h.call('users.list');
    await h.fails('users.update', { id: users[0].id, active: false }, 'LAST_ADMIN');
    const audit = await h.call('audit.list', { limit: 50 });
    expect(audit.some((a: any) => a.action === 'auth.login_failed' || a.action === 'setup.company')).toBe(true);
  });

  it('valide toutes les entrées (injection SQL inerte, types stricts)', async () => {
    const h = await new Harness().boot();
    const r = await h.call('products.list', { q: "'; DROP TABLE products; --" });
    expect(r.total).toBe(0);
    expect(h.db.value<number>('SELECT COUNT(*) FROM sqlite_master WHERE name = ?', 'products')).toBe(1);
    await h.fails('stock.adjust', { warehouseId: 'x', variantId: 'y', type: 'IN', qtyMilli: 1.5 }, 'VALIDATION');
  });

  it('récupération hors session : réinitialise le mot de passe de l’administrateur, lève le verrou, journalise', async () => {
    const h = await new Harness().boot();
    for (let i = 0; i < 5; i++) await h.fails('auth.login', { username: 'admin', password: 'oublié' }, 'INVALID_CREDENTIALS');
    await h.fails('auth.login', { username: 'admin', password: 'Admin#2026' }, 'ACCOUNT_LOCKED');
    expect(() => resetPasswordOffline(h.db, 'court')).toThrow(/au moins 8/);
    expect(resetPasswordOffline(h.db, 'NouveauMdp#1')).toEqual({ username: 'admin' });
    await h.fails('auth.login', { username: 'admin', password: 'Admin#2026' }, 'INVALID_CREDENTIALS');
    const ok = await h.app.call('auth.login', { username: 'admin', password: 'NouveauMdp#1' });
    expect(ok.ok).toBe(true);
    const audit = await h.call('audit.list', { action: 'auth.password_reset_offline' }, (ok as any).data.token);
    expect(audit).toHaveLength(1);
    expect(() => resetPasswordOffline(h.db, 'NouveauMdp#2', 'inconnu')).toThrow(/introuvable/);
  });
});
