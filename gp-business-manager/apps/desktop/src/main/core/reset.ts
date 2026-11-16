import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { verifyPassword } from './auth';
import type { Db } from './db';
import { AppError, audit, nowIso, type Ctx } from './util';

/** Phrase à recopier pour confirmer la réinitialisation complète. */
export const RESET_PHRASE = 'TOUT EFFACER';

/**
 * Autorise (ou non) la réinitialisation des données de gestion.
 * Conditions cumulatives : profil Administrateur + phrase de confirmation exacte + mot de passe de l'administrateur connecté.
 * Un mot de passe erroné compte comme un échec de connexion (verrouillage du compte après 5 essais).
 */
export function assertCanFactoryReset(ctx: Ctx, password: string, phrase: string): void {
  if (ctx.user.roleCode !== 'ADMIN') {
    audit(ctx, 'security.forbidden', undefined, undefined, { method: 'factoryReset' });
    throw new AppError('FORBIDDEN', 'Seul un administrateur peut réinitialiser le logiciel.');
  }
  if (phrase.trim().toUpperCase() !== RESET_PHRASE) throw new AppError('CONFIRM_MISMATCH', `Recopiez exactement « ${RESET_PHRASE} » pour confirmer.`);
  const u = ctx.db.get<{ password_hash: string; failed_logins: number; locked_until: string | null }>('SELECT password_hash, failed_logins, locked_until FROM users WHERE id = ?', ctx.user.id);
  if (!u) throw new AppError('FORBIDDEN', 'Compte introuvable.');
  if (u.locked_until && new Date(u.locked_until) > new Date()) throw new AppError('ACCOUNT_LOCKED', 'Compte verrouillé temporairement après plusieurs échecs.');
  if (!verifyPassword(password, u.password_hash)) {
    const failed = u.failed_logins + 1;
    ctx.db.run('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', failed >= 5 ? 0 : failed, failed >= 5 ? new Date(Date.now() + 5 * 60_000).toISOString() : null, ctx.user.id);
    audit(ctx, 'security.reset_denied', 'user', ctx.user.id, { reason: 'bad_password', at: nowIso() });
    throw new AppError('INVALID_CREDENTIALS', 'Mot de passe incorrect.');
  }
  audit(ctx, 'app.reset_business_data', 'app', undefined, {});
}

/** Tables du CONTENU de gestion, dans l'ordre de suppression (enfants avant parents). */
const BUSINESS_TABLES = [
  'payment_allocations', 'sale_return_items', 'credit_notes', 'sale_returns', 'invoices', 'payments', 'sale_items', 'sales', 'held_carts',
  'cash_movements', 'cash_sessions', 'goods_receipt_items', 'goods_receipts', 'purchase_items', 'purchases', 'expenses', 'financial_transactions',
  'customer_ledger', 'supplier_ledger', 'stock_transfer_items', 'stock_transfers', 'inventory_lines', 'inventories', 'stock_movements', 'stock_lots', 'stock',
  'price_history', 'barcodes', 'product_variants', 'products', 'brands', 'customers', 'suppliers', 'outbox', 'sync_log', 'doc_sequences',
];

/**
 * Remet à zéro le CONTENU de gestion : produits, stocks, clients, fournisseurs, ventes, achats, caisses, dépenses, trésorerie,
 * numérotation. CONSERVÉS : comptes utilisateurs et rôles, paramètres de l'entreprise, boutiques/entrepôts/caisses/comptes
 * financiers (structure, soldes d'ouverture remis à 0), modes de paiement, taxes, unités, catégories de dépenses et journal d'activité.
 * Tout se fait dans UNE transaction (tout ou rien). Les triggers d'immuabilité sont suspendus le temps de l'effacement puis recréés à l'identique.
 */
export function resetBusinessData(db: Db): { tables: number } {
  return db.tx(() => {
    const triggers = db.all<{ name: string; sql: string }>(
      `SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name IN (${BUSINESS_TABLES.map(() => '?').join(',')})`, ...BUSINESS_TABLES);
    for (const t of triggers) db.raw.exec(`DROP TRIGGER "${t.name}"`);
    db.raw.exec('PRAGMA defer_foreign_keys = ON');
    for (const tbl of BUSINESS_TABLES) db.raw.exec(`DELETE FROM ${tbl}`);
    db.raw.exec('DELETE FROM categories WHERE parent_id IS NOT NULL; DELETE FROM categories;');
    db.raw.exec('UPDATE financial_accounts SET opening_balance = 0');
    for (const t of triggers) db.raw.exec(t.sql); // immuabilité rétablie à l'identique
    return { tables: BUSINESS_TABLES.length + 1 };
  });
}

/** Supprime les fichiers de sauvegarde d'un dossier. */
export function deleteBackupFiles(backupDir: string): number {
  if (!existsSync(backupDir)) return 0;
  const files = readdirSync(backupDir);
  for (const f of files) rmSync(join(backupDir, f), { force: true });
  return files.length;
}
