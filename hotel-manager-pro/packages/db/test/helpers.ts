import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { withTenant, withPlatform } from '../src/client.js';

const ROLE = { switchRole: true } as const;

function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

export interface TestDb {
  name: string;
  url: string;
  /** Connexion superuser (contourne la RLS) : sert uniquement à préparer / vérifier, jamais à tester les droits. */
  admin: pg.Pool;
  /** Pool de l'API : toutes les requêtes passent par withTenant / withPlatform avec bascule de rôle. */
  app: pg.Pool;
  drop(): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function createTestDb(): Promise<TestDb> {
  const adminUrl = process.env.HMP_TEST_ADMIN_URL!;
  const template = process.env.HMP_TEST_TEMPLATE_DB!;
  const name = `hmp_t_${randomBytes(6).toString('hex')}`;

  const root = new pg.Client({ connectionString: adminUrl });
  await root.connect();
  try {
    // Les copies concurrentes depuis un même modèle se sérialisent : on réessaie brièvement
    for (let attempt = 0; ; attempt++) {
      try {
        await root.query(`CREATE DATABASE ${name} TEMPLATE ${template}`);
        break;
      } catch (error) {
        if (attempt >= 20) throw error;
        await sleep(100 + attempt * 50);
      }
    }
  } finally {
    await root.end();
  }

  const url = withDatabase(adminUrl, name);
  const admin = new pg.Pool({ connectionString: url, max: 5 });
  const app = new pg.Pool({ connectionString: url, max: 20 });
  // Au démontage, DROP DATABASE ... WITH (FORCE) peut couper une connexion encore en cours de fermeture : ce n'est pas une erreur de test
  admin.on('error', () => undefined);
  app.on('error', () => undefined);
  return {
    name,
    url,
    admin,
    app,
    async drop() {
      await app.end();
      await admin.end();
      const cleanup = new pg.Client({ connectionString: adminUrl });
      await cleanup.connect();
      await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await cleanup.end();
    },
  };
}

export interface HotelFixture {
  hotelId: string;
  userId: string;
  roleId: string;
  membershipId: string;
  email: string;
}

let counter = 0;

/**
 * Inscrit un établissement par le VRAI chemin applicatif (rôle hmp_app, RLS active) :
 * hôtel -> réglages -> essai gratuit -> premier utilisateur -> rôle propriétaire -> adhésion.
 */
export async function registerHotel(
  db: TestDb,
  opts: { name?: string; plan?: string | null } = {},
): Promise<HotelFixture> {
  counter += 1;
  const n = `${process.pid}-${counter}-${randomBytes(3).toString('hex')}`;
  const hotelId = randomUUID();
  const userId = randomUUID();
  const roleId = randomUUID();
  const membershipId = randomUUID();
  const email = `owner-${n}@example.test`;

  await withTenant(
    db.app,
    { hotelId, userId },
    async (tx) => {
      await tx.query('INSERT INTO hotels (id, slug, name, country, city) VALUES ($1, $2, $3, $4, $5)', [
        hotelId,
        `hotel-${n}`.toLowerCase(),
        opts.name ?? `Hôtel ${n}`,
        'MG',
        'Antananarivo',
      ]);
      await tx.query('INSERT INTO hotel_settings (hotel_id) VALUES ($1)', [hotelId]);
      if (opts.plan !== null) await tx.query('SELECT start_trial($1)', [opts.plan ?? 'starter']);
      await tx.query('INSERT INTO users (id, email, full_name, password_hash) VALUES ($1, $2, $3, $4)', [
        userId,
        email,
        'Propriétaire Test',
        '$argon2id$test-hash-not-a-real-credential',
      ]);
      await tx.query("INSERT INTO roles (id, hotel_id, key, name, is_system) VALUES ($1, $2, 'owner', 'Propriétaire', true)", [roleId, hotelId]);
      await tx.query("INSERT INTO memberships (id, hotel_id, user_id, role_id, status) VALUES ($1, $2, $3, $4, 'active')", [
        membershipId,
        hotelId,
        userId,
        roleId,
      ]);
    },
    ROLE,
  );
  return { hotelId, userId, roleId, membershipId, email };
}

/** Crée une catégorie et `count` chambres ; renvoie leurs identifiants. */
export async function seedRooms(
  db: TestDb,
  hotel: HotelFixture,
  count = 3,
): Promise<{ categoryId: string; roomIds: string[] }> {
  const categoryId = randomUUID();
  const roomIds = Array.from({ length: count }, () => randomUUID());
  await withTenant(
    db.app,
    { hotelId: hotel.hotelId, userId: hotel.userId },
    async (tx) => {
      await tx.query("INSERT INTO room_categories (id, hotel_id, code, name, base_rate) VALUES ($1, $2, 'STD', 'Standard', 100000)", [
        categoryId,
        hotel.hotelId,
      ]);
      for (const [i, id] of roomIds.entries()) {
        await tx.query('INSERT INTO rooms (id, hotel_id, category_id, number) VALUES ($1, $2, $3, $4)', [
          id,
          hotel.hotelId,
          categoryId,
          String(101 + i),
        ]);
      }
    },
    ROLE,
  );
  return { categoryId, roomIds };
}

export async function seedGuest(db: TestDb, hotel: HotelFixture, email?: string): Promise<string> {
  const id = randomUUID();
  await withTenant(
    db.app,
    { hotelId: hotel.hotelId, userId: hotel.userId },
    (tx) =>
      tx.query('INSERT INTO guests (id, hotel_id, first_name, last_name, email) VALUES ($1, $2, $3, $4, $5)', [
        id,
        hotel.hotelId,
        'Client',
        'Test',
        email ?? `guest-${id}@example.test`,
      ]),
    ROLE,
  );
  return id;
}

/** Crée une réservation (en-tête) avec une ligne chambre ; la contrainte anti-chevauchement s'applique. */
export async function bookRoom(
  db: TestDb,
  hotel: HotelFixture,
  args: { guestId: string; categoryId: string; roomId: string | null; checkIn: string; checkOut: string; status?: string },
): Promise<{ reservationId: string; reservationRoomId: string }> {
  const reservationId = randomUUID();
  const reservationRoomId = randomUUID();
  const status = args.status ?? 'confirmed';
  await withTenant(
    db.app,
    { hotelId: hotel.hotelId, userId: hotel.userId },
    async (tx) => {
      const { rows } = await tx.query<{ next_hotel_counter: string }>("SELECT next_hotel_counter('reservation')");
      await tx.query(
        `INSERT INTO reservations (id, hotel_id, reference, guest_id, status, currency)
         VALUES ($1, $2, $3, $4, $5, 'MGA')`,
        [reservationId, hotel.hotelId, `RES-${rows[0]!.next_hotel_counter}`, args.guestId, status],
      );
      await tx.query(
        `INSERT INTO reservation_rooms (id, hotel_id, reservation_id, category_id, room_id, status, check_in, check_out)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [reservationRoomId, hotel.hotelId, reservationId, args.categoryId, args.roomId, status, args.checkIn, args.checkOut],
      );
    },
    ROLE,
  );
  return { reservationId, reservationRoomId };
}

export async function ensurePaymentMethod(db: TestDb, hotel: HotelFixture, code = 'cash'): Promise<void> {
  await withTenant(
    db.app,
    { hotelId: hotel.hotelId, userId: hotel.userId },
    (tx) =>
      tx.query(
        `INSERT INTO payment_methods (hotel_id, code, label, kind) VALUES ($1, $2, $3, 'cash')
         ON CONFLICT (hotel_id, code) DO NOTHING`,
        [hotel.hotelId, code, 'Espèces'],
      ),
    ROLE,
  );
}

/** Un administrateur de plateforme de test (créé par la connexion d'administration, comme le ferait un seed). */
export async function createPlatformAdmin(db: TestDb): Promise<string> {
  const id = randomUUID();
  await db.admin.query('INSERT INTO platform_admins (id, email, full_name, password_hash) VALUES ($1, $2, $3, $4)', [
    id,
    `admin-${id}@example.test`,
    'Admin Plateforme',
    '$argon2id$test-hash-not-a-real-credential',
  ]);
  return id;
}

/** Exécute une requête et renvoie le code d'erreur PostgreSQL (ou null si elle réussit). */
export async function sqlState(promise: Promise<unknown>): Promise<{ code: string | null; message: string; constraint?: string }> {
  try {
    await promise;
    return { code: null, message: '' };
  } catch (error) {
    const e = error as { code?: string; message: string; constraint?: string };
    return { code: e.code ?? 'UNKNOWN', message: e.message, constraint: e.constraint };
  }
}

export { ROLE, withTenant, withPlatform };
