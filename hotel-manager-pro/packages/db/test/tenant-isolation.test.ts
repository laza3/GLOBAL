import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withoutTenant } from '../src/client.js';
import {
  ROLE, bookRoom, createTestDb, createPlatformAdmin, registerHotel, seedGuest, seedRooms, sqlState, withPlatform, withTenant,
  type HotelFixture, type TestDb,
} from './helpers.js';

let db: TestDb;
let A: HotelFixture;
let B: HotelFixture;
let roomsA: { categoryId: string; roomIds: string[] };
let roomsB: { categoryId: string; roomIds: string[] };
let guestA: string;
let guestB: string;

const asA = <T>(fn: (tx: pg.PoolClient) => Promise<T>) => withTenant(db.app, { hotelId: A.hotelId, userId: A.userId }, fn, ROLE);
const asB = <T>(fn: (tx: pg.PoolClient) => Promise<T>) => withTenant(db.app, { hotelId: B.hotelId, userId: B.userId }, fn, ROLE);

beforeAll(async () => {
  db = await createTestDb();
  A = await registerHotel(db, { name: 'Hôtel A' });
  B = await registerHotel(db, { name: 'Hôtel B' });
  roomsA = await seedRooms(db, A, 3);
  roomsB = await seedRooms(db, B, 3);
  guestA = await seedGuest(db, A);
  guestB = await seedGuest(db, B);
  await bookRoom(db, A, { guestId: guestA, categoryId: roomsA.categoryId, roomId: roomsA.roomIds[0]!, checkIn: '2030-01-10', checkOut: '2030-01-12' });
  await bookRoom(db, B, { guestId: guestB, categoryId: roomsB.categoryId, roomId: roomsB.roomIds[0]!, checkIn: '2030-01-10', checkOut: '2030-01-12' });
});
afterAll(async () => {
  await db.drop();
});

const TENANT_TABLES = ['rooms', 'room_categories', 'guests', 'reservations', 'reservation_rooms', 'room_allocations', 'memberships', 'roles', 'hotel_settings'];

describe('inscription d\'un établissement par le chemin applicatif', () => {
  it('crée hôtel, réglages, essai gratuit, propriétaire et adhésion sous la RLS', async () => {
    const rows = await asA(async (tx) => ({
      hotel: (await tx.query('SELECT name, status FROM hotels')).rows,
      sub: (await tx.query('SELECT status, trial_ends_at FROM subscriptions')).rows,
      members: (await tx.query('SELECT status FROM memberships')).rows,
    }));
    expect(rows.hotel).toEqual([{ name: 'Hôtel A', status: 'onboarding' }]);
    expect(rows.sub).toHaveLength(1);
    expect(rows.sub[0].status).toBe('trialing');
    expect(rows.members).toEqual([{ status: 'active' }]);
  });
});

describe('isolation des lectures', () => {
  it.each(TENANT_TABLES)('sans contexte d\'établissement, %s ne renvoie aucune ligne (échec fermé)', async (table) => {
    const { rows } = await withoutTenant(db.app, (tx) => tx.query(`SELECT count(*)::int AS n FROM ${table}`), ROLE);
    expect(rows[0].n).toBe(0);
  });

  it('un établissement ne voit que ses propres chambres, clients et réservations', async () => {
    const a = await asA(async (tx) => ({
      rooms: (await tx.query('SELECT hotel_id FROM rooms')).rows,
      guests: (await tx.query('SELECT hotel_id FROM guests')).rows,
      reservations: (await tx.query('SELECT hotel_id FROM reservations')).rows,
    }));
    for (const rows of Object.values(a)) {
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.hotel_id === A.hotelId)).toBe(true);
    }
    expect(a.rooms).toHaveLength(3);
  });

  it('lire directement l\'identifiant d\'une ligne d\'un autre hôtel ne renvoie rien', async () => {
    const { rows } = await asA((tx) => tx.query('SELECT id FROM rooms WHERE id = $1', [roomsB.roomIds[0]]));
    expect(rows).toEqual([]);
    const g = await asA((tx) => tx.query('SELECT id FROM guests WHERE id = $1', [guestB]));
    expect(g.rows).toEqual([]);
  });

  it('un établissement ne voit pas les adhésions, rôles ni utilisateurs d\'un autre', async () => {
    const r = await asA(async (tx) => ({
      users: (await tx.query('SELECT id FROM users')).rows.map((u) => u.id),
      memberships: (await tx.query('SELECT user_id FROM memberships')).rows.map((m) => m.user_id),
    }));
    expect(r.users).toEqual([A.userId]);
    expect(r.memberships).toEqual([A.userId]);
  });

  it('un établissement ne voit que sa propre ligne hotels', async () => {
    const { rows } = await asA((tx) => tx.query('SELECT id FROM hotels'));
    expect(rows.map((h) => h.id)).toEqual([A.hotelId]);
  });
});

describe('isolation des écritures', () => {
  it('modifier ou supprimer une ligne d\'un autre hôtel n\'affecte aucune ligne', async () => {
    const upd = await asA((tx) => tx.query("UPDATE rooms SET name = 'piraté' WHERE id = $1", [roomsB.roomIds[0]]));
    expect(upd.rowCount).toBe(0);
    const del = await asA((tx) => tx.query('DELETE FROM rooms WHERE id = $1', [roomsB.roomIds[1]]));
    expect(del.rowCount).toBe(0);
    const { rows } = await db.admin.query('SELECT name FROM rooms WHERE id = $1', [roomsB.roomIds[0]]);
    expect(rows[0].name).toBeNull();
    const still = await db.admin.query('SELECT 1 FROM rooms WHERE id = $1', [roomsB.roomIds[1]]);
    expect(still.rowCount).toBe(1);
  });

  it('insérer une ligne au nom d\'un autre hôtel est refusé par la politique', async () => {
    const r = await sqlState(
      asA((tx) => tx.query('INSERT INTO rooms (hotel_id, category_id, number) VALUES ($1, $2, $3)', [B.hotelId, roomsB.categoryId, '999'])),
    );
    expect(r.code).toBe('42501');
    expect(r.message).toMatch(/row-level security/);
  });

  it('déplacer une ligne vers un autre hôtel (UPDATE hotel_id) est refusé', async () => {
    const r = await sqlState(asA((tx) => tx.query('UPDATE rooms SET hotel_id = $1 WHERE id = $2', [B.hotelId, roomsA.roomIds[0]])));
    expect(r.code).toBe('42501');
  });
});

describe('clés étrangères composites : aucune référence inter-hôtels possible, même sans RLS', () => {
  it('une chambre ne peut pas être rattachée à la catégorie d\'un autre hôtel', async () => {
    // Connexion superuser : la RLS est contournée, seule la base elle-même protège
    const r = await sqlState(
      db.admin.query('INSERT INTO rooms (hotel_id, category_id, number) VALUES ($1, $2, $3)', [B.hotelId, roomsA.categoryId, 'X1']),
    );
    expect(r.code).toBe('23503');
  });

  it('une réservation ne peut pas pointer vers le client d\'un autre hôtel', async () => {
    const r = await sqlState(
      db.admin.query(
        `INSERT INTO reservations (hotel_id, reference, guest_id, currency) VALUES ($1, 'CROSS-1', $2, 'MGA')`,
        [B.hotelId, guestA],
      ),
    );
    expect(r.code).toBe('23503');
  });

  it('une adhésion ne peut pas utiliser le rôle d\'un autre hôtel (élévation de privilèges)', async () => {
    const r = await sqlState(
      db.admin.query(`INSERT INTO memberships (hotel_id, user_id, role_id) VALUES ($1, $2, $3)`, [B.hotelId, A.userId, A.roleId]),
    );
    expect(r.code).toBe('23503');
  });

  it('une chambre d\'un autre hôtel ne peut pas être réservée', async () => {
    const reservationId = randomUUID();
    await db.admin.query(`INSERT INTO reservations (id, hotel_id, reference, guest_id, currency) VALUES ($1, $2, 'OK-1', $3, 'MGA')`, [reservationId, B.hotelId, guestB]);
    const r = await sqlState(
      db.admin.query(
        `INSERT INTO reservation_rooms (hotel_id, reservation_id, category_id, room_id, check_in, check_out)
         VALUES ($1, $2, $3, $4, '2031-01-01', '2031-01-03')`,
        [B.hotelId, reservationId, roomsB.categoryId, roomsA.roomIds[0]],
      ),
    );
    expect(r.code).toBe('23503');
  });
});

describe('étanchéité du contexte', () => {
  it('le contexte ne fuit pas vers la transaction suivante d\'une connexion réutilisée', async () => {
    const single = new pg.Pool({ connectionString: db.url, max: 1 });
    try {
      const during = await withTenant(single, { hotelId: A.hotelId }, (tx) => tx.query('SELECT count(*)::int AS n FROM rooms'), ROLE);
      expect(during.rows[0].n).toBe(3);
      // même connexion physique, plus de contexte : plus aucune ligne
      const after = await withoutTenant(single, (tx) => tx.query('SELECT count(*)::int AS n FROM rooms'), ROLE);
      expect(after.rows[0].n).toBe(0);
    } finally {
      await single.end();
    }
  });

  it('un identifiant de contexte invalide est refusé avant d\'atteindre la base', async () => {
    await expect(withTenant(db.app, { hotelId: "x'; DROP TABLE rooms; --" }, async () => 1, ROLE)).rejects.toThrow(/UUID/);
  });
});

describe('utilisateurs et authentification', () => {
  it('le hash du mot de passe n\'est pas lisible par le rôle applicatif', async () => {
    const r = await sqlState(asA((tx) => tx.query('SELECT password_hash FROM users')));
    expect(r.code).toBe('42501');
    const star = await sqlState(asA((tx) => tx.query('SELECT * FROM users')));
    expect(star.code).toBe('42501');
  });

  it('la connexion passe par auth_find_user, sans contexte d\'établissement', async () => {
    const { rows } = await withoutTenant(db.app, (tx) => tx.query('SELECT * FROM auth_find_user($1)', [A.email.toUpperCase()]), ROLE);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(A.userId);
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$/);
    const none = await withoutTenant(db.app, (tx) => tx.query('SELECT * FROM auth_find_user($1)', ['inconnu@example.test']), ROLE);
    expect(none.rows).toEqual([]);
  });

  it('les sessions et les administrateurs de plateforme sont inaccessibles aux établissements', async () => {
    for (const table of ['sessions', 'platform_admins', 'platform_settings', 'payment_connector_credentials']) {
      const r = await sqlState(asA((tx) => tx.query(`SELECT 1 FROM ${table}`)));
      expect(r.code, table).toBe('42501');
    }
  });
});

describe('statut du compte et abonnement : décisions réservées à la plateforme', () => {
  it('un établissement ne peut pas changer son propre statut ni se réactiver', async () => {
    const r = await sqlState(asA((tx) => tx.query("UPDATE hotels SET status = 'active'")));
    expect(r.code).toBe('42501');
  });

  it('un établissement peut modifier son profil mais pas celui d\'un autre', async () => {
    const own = await asA((tx) => tx.query("UPDATE hotels SET city = 'Nosy Be' WHERE id = $1", [A.hotelId]));
    expect(own.rowCount).toBe(1);
    const other = await asA((tx) => tx.query("UPDATE hotels SET city = 'Piraté' WHERE id = $1", [B.hotelId]));
    expect(other.rowCount).toBe(0);
  });

  it('un établissement ne peut pas créer ni modifier un abonnement, une licence ou une facture SaaS', async () => {
    const attempts = [
      "INSERT INTO subscriptions (hotel_id, plan_id, status, billing_interval, currency, price_amount, current_period_start, current_period_end) SELECT id, id, 'active', 'month', 'MGA', 0, now(), now() + interval '1 year' FROM plans LIMIT 1",
      "UPDATE subscriptions SET status = 'active', current_period_end = now() + interval '10 years'",
      "INSERT INTO licenses (hotel_id, key_hash, key_prefix, edition_code, status, activated_at) VALUES (gen_random_uuid(), 'h', 'p', 'enterprise', 'active', now())",
      "INSERT INTO saas_invoices (hotel_id, currency) VALUES (gen_random_uuid(), 'MGA')",
    ];
    for (const sql of attempts) {
      const r = await sqlState(asA((tx) => tx.query(sql)));
      expect(r.code, sql).toBe('42501');
    }
  });

  it('l\'essai gratuit ne peut être démarré qu\'une fois', async () => {
    const r = await sqlState(asA((tx) => tx.query('SELECT start_trial($1)', ['business'])));
    expect(r.code).toBe('HM001');
    expect(r.message).toBe('trial_already_used');
  });

  it('le journal d\'audit de l\'établissement est en ajout seul', async () => {
    await asA((tx) => tx.query("INSERT INTO audit_logs (hotel_id, actor_user_id, action) VALUES ($1, $2, 'test.action')", [A.hotelId, A.userId]));
    const upd = await sqlState(asA((tx) => tx.query("UPDATE audit_logs SET action = 'falsifié'")));
    const del = await sqlState(asA((tx) => tx.query('DELETE FROM audit_logs')));
    expect(upd.code).toBe('42501');
    expect(del.code).toBe('42501');
  });
});

describe('console plateforme : voit les hôtels, jamais leurs données métier', () => {
  const plat = <T>(fn: (tx: pg.PoolClient) => Promise<T>) => withPlatform(db.app, fn, ROLE);

  it.each(['guests', 'reservations', 'rooms', 'payments', 'invoices', 'folios', 'memberships', 'users', 'audit_logs'])(
    'le rôle plateforme ne peut pas lire %s',
    async (table) => {
      const r = await sqlState(plat((tx) => tx.query(`SELECT 1 FROM ${table} LIMIT 1`)));
      expect(r.code).toBe('42501');
    },
  );

  it('l\'annuaire expose les hôtels avec des agrégats, sans donnée client', async () => {
    const { rows } = await plat((tx) => tx.query('SELECT * FROM platform_hotel_directory ORDER BY name'));
    const a = rows.find((r) => r.hotel_id === A.hotelId);
    expect(a).toMatchObject({ name: 'Hôtel A', rooms_count: '3', users_count: '1', owner_email: A.email, plan_code: 'starter', is_current: true });
    expect(Object.keys(a)).not.toContain('guest_id');
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('la plateforme peut suspendre un établissement (et lui seul), l\'établissement le voit mais ne peut pas l\'annuler', async () => {
    await createPlatformAdmin(db);
    await plat((tx) =>
      tx.query("UPDATE hotels SET status = 'suspended', suspended_at = now(), suspension_reason = 'Impayé' WHERE id = $1", [B.hotelId]),
    );
    const seen = await asB((tx) => tx.query('SELECT status, suspension_reason FROM hotels'));
    expect(seen.rows[0]).toEqual({ status: 'suspended', suspension_reason: 'Impayé' });
    const undo = await sqlState(asB((tx) => tx.query("UPDATE hotels SET status = 'active'")));
    expect(undo.code).toBe('42501');
    const noDate = await sqlState(plat((tx) => tx.query("UPDATE hotels SET status = 'suspended', suspended_at = NULL WHERE id = $1", [A.hotelId])));
    expect(noDate.code).toBe('23514');
  });

  it('la plateforme ne peut pas modifier le profil d\'un hôtel', async () => {
    const r = await sqlState(plat((tx) => tx.query("UPDATE hotels SET name = 'Renommé' WHERE id = $1", [A.hotelId])));
    expect(r.code).toBe('42501');
  });

  it('le journal d\'audit de la plateforme est en ajout seul', async () => {
    await plat((tx) => tx.query("INSERT INTO platform_audit_logs (action, hotel_id) VALUES ('hotel.suspend', $1)", [B.hotelId]));
    const upd = await sqlState(plat((tx) => tx.query("UPDATE platform_audit_logs SET action = 'x'")));
    const del = await sqlState(plat((tx) => tx.query('DELETE FROM platform_audit_logs')));
    expect(upd.code).toBe('42501');
    expect(del.code).toBe('42501');
  });
});
