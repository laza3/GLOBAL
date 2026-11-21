import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './helpers.js';

/**
 * Garde-fous STRUCTURELS : ils échouent dès qu'une future migration oublie la RLS, accorde un droit trop large
 * ou crée un objet appartenant à un superuser. Ils protègent l'isolation multi-tenant contre les régressions.
 */
let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.admin.query(sql, params)).rows as T[];

// Tables sans colonne hotel_id sur lesquelles le rôle applicatif a un droit : liste blanche explicite et justifiée
const APP_TABLES_WITHOUT_HOTEL_ID = new Set([
  'hotels', // filtrée par id = app_hotel_id()
  'users', // visible via adhésion, colonnes sensibles masquées
  'plans', // catalogue public + son propre forfait
  'plan_prices',
  'currencies',
  'payment_connectors', // sans les secrets (table séparée)
]);

const PLATFORM_ONLY = [
  'platform_admins',
  'platform_admin_sessions',
  'platform_settings',
  'platform_counters',
  'platform_audit_logs',
  'payment_connector_credentials',
  'sessions',
];

const BUSINESS_TABLES = [
  'guests', 'guest_documents', 'guest_notes', 'rooms', 'room_categories', 'reservations', 'reservation_rooms',
  'room_allocations', 'folios', 'folio_charges', 'invoices', 'invoice_lines', 'payments', 'orders', 'order_items',
  'expenses', 'hk_tasks', 'maintenance_requests', 'memberships', 'users', 'files', 'audit_logs', 'hotel_settings',
];

describe('structure de sécurité', () => {
  it('toutes les tables du schéma public ont la RLS activée', async () => {
    const rows = await q(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity`,
    );
    expect(rows).toEqual([]);
  });

  it('les rôles applicatifs ne sont ni superuser, ni BYPASSRLS, ni propriétaires d\'objets', async () => {
    const roles = await q<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('hmp_app', 'hmp_platform', 'hmp_owner')`,
    );
    expect(roles).toHaveLength(3);
    for (const r of roles) {
      expect(r.rolsuper, `${r.rolname} superuser`).toBe(false);
      expect(r.rolbypassrls, `${r.rolname} bypassrls`).toBe(false);
    }
    const owned = await q(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_roles r ON r.oid = c.relowner
       WHERE n.nspname = 'public' AND r.rolname IN ('hmp_app', 'hmp_platform')`,
    );
    expect(owned).toEqual([]);
  });

  it('les objets du projet appartiennent à hmp_owner ; aucune fonction SECURITY DEFINER n\'est à un superuser', async () => {
    const bad = await q(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_roles r ON r.oid = p.proowner
       WHERE n.nspname IN ('public', 'meta') AND r.rolname <> 'hmp_owner'
         AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')`,
    );
    expect(bad).toEqual([]);
    const definers = await q<{ proname: string; proconfig: string[] | null }>(
      `SELECT p.proname, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prosecdef`,
    );
    expect(definers.length).toBeGreaterThan(0);
    for (const f of definers) {
      // search_path figé : empêche le détournement d'une fonction SECURITY DEFINER par un schéma piégé
      expect(f.proconfig?.some((c) => c.startsWith('search_path=')), `${f.proname} sans search_path figé`).toBe(true);
    }
  });

  it('toute table à hotel_id accessible au rôle applicatif n\'a que des politiques filtrées par app_hotel_id()', async () => {
    const tables = await q<{ relname: string; oid: number }>(
      `SELECT c.relname, c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'hotel_id' AND NOT a.attisdropped
       WHERE n.nspname = 'public' AND c.relkind = 'r'`,
    );
    expect(tables.length).toBeGreaterThan(40);
    for (const t of tables) {
      const [{ allowed }] = await q<{ allowed: boolean }>(
        `SELECT (has_any_column_privilege('hmp_app', $1::oid, 'SELECT') OR has_any_column_privilege('hmp_app', $1::oid, 'INSERT')
              OR has_any_column_privilege('hmp_app', $1::oid, 'UPDATE') OR has_table_privilege('hmp_app', $1::oid, 'DELETE')) AS allowed`,
        [t.oid],
      ) as [{ allowed: boolean }];
      if (!allowed) continue;
      const policies = await q<{ policyname: string; roles: string[]; qual: string | null; with_check: string | null }>(
        `SELECT policyname, roles::text[] AS roles, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = $1`,
        [t.relname],
      );
      const forApp = policies.filter((p) => p.roles.includes('hmp_app') || p.roles.includes('public'));
      expect(forApp.length, `${t.relname} : aucune politique pour hmp_app`).toBeGreaterThan(0);
      for (const p of forApp) {
        expect(`${p.qual ?? ''} ${p.with_check ?? ''}`, `${t.relname}.${p.policyname}`).toContain('app_hotel_id');
      }
    }
  });

  it('les seules tables SANS hotel_id accessibles au rôle applicatif sont celles de la liste blanche', async () => {
    const rows = await q<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'hotel_id' AND NOT a.attisdropped)
         AND (has_any_column_privilege('hmp_app', c.oid, 'SELECT') OR has_any_column_privilege('hmp_app', c.oid, 'INSERT')
              OR has_any_column_privilege('hmp_app', c.oid, 'UPDATE') OR has_table_privilege('hmp_app', c.oid, 'DELETE'))`,
    );
    const names = rows.map((r) => r.relname);
    for (const n of names) expect(APP_TABLES_WITHOUT_HOTEL_ID.has(n), `${n} n'est pas dans la liste blanche`).toBe(true);
  });

  it.each(PLATFORM_ONLY)('le rôle applicatif n\'a AUCUN droit sur %s', async (table) => {
    const [r] = await q<{ any: boolean }>(
      `SELECT (has_any_column_privilege('hmp_app', $1::regclass, 'SELECT') OR has_any_column_privilege('hmp_app', $1::regclass, 'INSERT')
            OR has_any_column_privilege('hmp_app', $1::regclass, 'UPDATE') OR has_table_privilege('hmp_app', $1::regclass, 'DELETE')) AS any`,
      [`public.${table}`],
    );
    expect(r!.any).toBe(false);
  });

  it.each(BUSINESS_TABLES)('le rôle plateforme n\'a AUCUN droit sur les données métier (%s)', async (table) => {
    const [r] = await q<{ any: boolean }>(
      `SELECT (has_any_column_privilege('hmp_platform', $1::regclass, 'SELECT') OR has_any_column_privilege('hmp_platform', $1::regclass, 'INSERT')
            OR has_any_column_privilege('hmp_platform', $1::regclass, 'UPDATE') OR has_table_privilege('hmp_platform', $1::regclass, 'DELETE')) AS any`,
      [`public.${table}`],
    );
    expect(r!.any).toBe(false);
  });

  it('toute clé étrangère vers une table d\'établissement est COMPOSITE avec hotel_id (aucune référence inter-hôtels possible)', async () => {
    const rows = await q<{ conname: string; child: string; parent: string }>(
      `SELECT c.conname, cl.relname AS child, pl.relname AS parent
       FROM pg_constraint c
       JOIN pg_class cl ON cl.oid = c.conrelid
       JOIN pg_class pl ON pl.oid = c.confrelid
       JOIN pg_namespace n ON n.oid = cl.relnamespace
       JOIN pg_attribute ph ON ph.attrelid = c.confrelid AND ph.attname = 'hotel_id' AND NOT ph.attisdropped
       WHERE c.contype = 'f' AND n.nspname = 'public'
         AND NOT (ph.attnum = ANY (c.confkey))`,
    );
    expect(rows.map((r) => `${r.child} -> ${r.parent} (${r.conname})`)).toEqual([]);
  });

  it('le hash de mot de passe et les secrets ne sont jamais lisibles par le rôle applicatif', async () => {
    const [r] = await q<{ hash: boolean; totp: boolean; email: boolean }>(
      `SELECT has_column_privilege('hmp_app', 'public.users', 'password_hash', 'SELECT') AS hash,
              has_column_privilege('hmp_app', 'public.users', 'totp_secret_enc', 'SELECT') AS totp,
              has_column_privilege('hmp_app', 'public.users', 'email', 'SELECT') AS email`,
    );
    expect(r).toEqual({ hash: false, totp: false, email: true });
  });

  it('les journaux et le grand livre des paiements sont en ajout seul pour le rôle applicatif', async () => {
    for (const table of ['audit_logs', 'subscription_events', 'license_events']) {
      const [r] = await q<{ upd: boolean; del: boolean }>(
        `SELECT has_any_column_privilege('hmp_app', $1::regclass, 'UPDATE') AS upd, has_table_privilege('hmp_app', $1::regclass, 'DELETE') AS del`,
        [`public.${table}`],
      );
      expect(r, table).toEqual({ upd: false, del: false });
    }
    const [p] = await q<{ del: boolean }>(`SELECT has_table_privilege('hmp_app', 'public.payments', 'DELETE') AS del`);
    expect(p!.del).toBe(false);
  });

  it('chaque table portant updated_at / version a son trigger', async () => {
    const rows = await q(
      `SELECT c.relname, a.attname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND NOT a.attisdropped AND a.attname IN ('updated_at', 'version')
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
                         AND t.tgname = CASE a.attname WHEN 'updated_at' THEN 'trg_set_updated_at' ELSE 'trg_bump_version' END)`,
    );
    expect(rows).toEqual([]);
  });

  it('le catalogue de moyens de paiement n\'active aucun connecteur par défaut', async () => {
    const rows = await q(`SELECT code FROM payment_connectors WHERE is_enabled OR status = 'connected'`);
    expect(rows).toEqual([]);
  });
});
