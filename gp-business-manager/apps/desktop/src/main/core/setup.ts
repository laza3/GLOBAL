import { SYSTEM_ROLES } from '@gp/shared';
import type { Db } from './db';
import { assertStrongPassword, hashPassword, seedRoles } from './auth';
import { fail, nowIso, uuid } from './util';

export interface SetupInput {
  companyName: string;
  currency?: string;
  locale?: 'fr' | 'en';
  timezone?: string;
  pricesIncludeTax?: boolean;
  admin: { username: string; displayName: string; password: string };
}

export function isConfigured(db: Db): boolean {
  return !!db.get('SELECT 1 FROM company LIMIT 1');
}

/** Première configuration : entreprise, établissement, magasin, caisse, comptes, modes de paiement, rôles et administrateur. */
export function setupCompany(db: Db, i: SetupInput) {
  if (isConfigured(db)) fail('ALREADY_CONFIGURED', "L'entreprise est déjà configurée");
  assertStrongPassword(i.admin.password);
  const t = nowIso();
  return db.tx(() => {
    db.run(
      `INSERT INTO company (id, name, currency, locale, timezone, prices_include_tax, receipt_footer, created_at) VALUES (?,?,?,?,?,?,?,?)`,
      uuid(), i.companyName, i.currency ?? 'MGA', i.locale ?? 'fr', i.timezone ?? 'Indian/Antananarivo', i.pricesIncludeTax === false ? 0 : 1,
      i.locale === 'en' ? 'Thank you for your visit!' : 'Merci de votre visite !', t,
    );
    seedRoles(db);
    const branchId = uuid(), whId = uuid(), cashAcc = uuid(), mobAcc = uuid(), bankAcc = uuid(), regId = uuid();
    db.run('INSERT INTO branches (id, name, code, created_at, updated_at) VALUES (?,?,?,?,?)', branchId, 'Siège', 'SIEGE', t, t);
    db.run('INSERT INTO warehouses (id, branch_id, name, is_default, created_at, updated_at) VALUES (?,?,?,1,?,?)', whId, branchId, 'Magasin principal', t, t);
    for (const [id, name, type] of [[cashAcc, 'Caisse principale', 'CASH'], [mobAcc, 'Mobile Money', 'MOBILE'], [bankAcc, 'Banque', 'BANK']] as const) {
      db.run('INSERT INTO financial_accounts (id, name, type, created_at, updated_at) VALUES (?,?,?,?,?)', id, name, type, t, t);
    }
    db.run('INSERT INTO cash_registers (id, branch_id, warehouse_id, account_id, name, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', regId, branchId, whId, cashAcc, 'Caisse 1', t, t);

    const methods: [string, string, string, string | null][] = [
      ['CASH', 'Espèces', 'CASH', null],
      ['MVOLA', 'MVola', 'MOBILE', mobAcc],
      ['ORANGE_MONEY', 'Orange Money', 'MOBILE', mobAcc],
      ['AIRTEL_MONEY', 'Airtel Money', 'MOBILE', mobAcc],
      ['CARD', 'Carte bancaire', 'CARD', bankAcc],
      ['TRANSFER', 'Virement', 'BANK', bankAcc],
      ['CHEQUE', 'Chèque', 'CHEQUE', bankAcc],
    ];
    methods.forEach(([code, name, kind, acc], idx) =>
      db.run('INSERT INTO payment_methods (id, code, name, kind, account_id, sort) VALUES (?,?,?,?,?,?)', uuid(), code, name, kind, acc, idx),
    );
    for (const [code, name, dec] of [['pce', 'Pièce', 0], ['kg', 'Kilogramme', 1], ['g', 'Gramme', 1], ['l', 'Litre', 1], ['m', 'Mètre', 1], ['carton', 'Carton', 0], ['boite', 'Boîte', 0], ['sachet', 'Sachet', 0]] as const) {
      db.run('INSERT INTO units (id, code, name, allow_decimal) VALUES (?,?,?,?)', uuid(), code, name, dec);
    }
    db.run('INSERT INTO tax_rates (id, name, rate_bp, is_default) VALUES (?,?,?,0)', uuid(), 'Exonéré (0 %)', 0);
    db.run('INSERT INTO tax_rates (id, name, rate_bp, is_default) VALUES (?,?,?,1)', uuid(), 'TVA 20 %', 2000);
    for (const n of ['Loyer', 'Électricité & eau', 'Salaires', 'Transport', 'Fournitures', 'Marketing', 'Maintenance', 'Impôts & taxes', 'Frais bancaires', 'Autres']) {
      db.run('INSERT INTO expense_categories (id, name) VALUES (?,?)', uuid(), n);
    }
    const adminRole = db.value<string>("SELECT id FROM roles WHERE code = 'ADMIN'")!;
    const adminId = uuid();
    db.run(
      'INSERT INTO users (id, username, display_name, password_hash, role_id, branch_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
      adminId, i.admin.username.trim(), i.admin.displayName, hashPassword(i.admin.password), adminRole, branchId, t, t,
    );
    db.run('INSERT INTO audit_log (id, at, user_id, username, action) VALUES (?,?,?,?,?)', uuid(), t, adminId, i.admin.username, 'setup.company');
    return { adminId, branchId, warehouseId: whId, registerId: regId };
  });
}
void SYSTEM_ROLES;
