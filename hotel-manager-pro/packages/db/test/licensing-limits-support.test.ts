import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROLE, createPlatformAdmin, createTestDb, registerHotel, seedRooms, sqlState, withPlatform, withTenant, type HotelFixture, type TestDb } from './helpers.js';

let db: TestDb;
let admin: string;

const plat = <T>(fn: (tx: pg.PoolClient) => Promise<T>) => withPlatform(db.app, fn, ROLE);
const asHotel = <T>(h: HotelFixture, fn: (tx: pg.PoolClient) => Promise<T>) => withTenant(db.app, { hotelId: h.hotelId, userId: h.userId }, fn, ROLE);

interface Ent { source: string; plan_code: string | null; max_rooms: number | null; max_users: number | null; features: Record<string, boolean>; is_perpetual: boolean; valid_until: Date | null; is_current: boolean; subscription_status: string | null; license_support_active: boolean | null }
const ent = async (h: HotelFixture) => (await db.admin.query('SELECT * FROM hotel_entitlements WHERE hotel_id = $1', [h.hotelId])).rows[0] as Ent;

const newLicense = (h: HotelFixture, o: { status?: string; maxRooms?: number | null; maxUsers?: number | null; maintenance?: string | null; features?: object; edition?: string } = {}) =>
  plat(async (tx) => (await tx.query(
    `INSERT INTO licenses (hotel_id, key_hash, key_prefix, edition_code, status, activated_at, max_rooms, max_users, features, maintenance_until, created_by_admin_id)
     VALUES ($1, $2, 'HMP-XXXX', $3, $4, CASE WHEN $4 = 'active' THEN now() END, $5, $6, $7::jsonb, $8, $9) RETURNING id`,
    [h.hotelId, createHash('sha256').update(randomUUID()).digest('hex'), o.edition ?? 'perpetuelle-pro', o.status ?? 'active',
     o.maxRooms === undefined ? null : o.maxRooms, o.maxUsers === undefined ? null : o.maxUsers,
     JSON.stringify(o.features ?? { reservations: true, restaurant: true, finances: true }), o.maintenance === undefined ? null : o.maintenance, admin])).rows[0].id as string);

const expireSubscription = (h: HotelFixture) => plat((tx) => tx.query(
  `UPDATE subscriptions SET status = 'active', trial_ends_at = NULL, current_period_start = now() - interval '40 days', current_period_end = now() - interval '10 days' WHERE hotel_id = $1`, [h.hotelId]));

beforeAll(async () => {
  db = await createTestDb();
  admin = await createPlatformAdmin(db);
});
afterAll(async () => {
  await db.drop();
});

describe('droits d\'usage effectifs (licence > abonnement > aucun)', () => {
  it('un établissement sans abonnement n\'a aucun droit', async () => {
    const h = await registerHotel(db, { plan: null });
    expect(await ent(h)).toMatchObject({ source: 'none', max_rooms: 0, max_users: 0, features: {}, is_current: false, plan_code: null });
  });

  it('un essai Starter donne ses limites et ses fonctionnalités, avec une échéance', async () => {
    const h = await registerHotel(db, { plan: 'starter' });
    const e = await ent(h);
    expect(e).toMatchObject({ source: 'subscription', plan_code: 'starter', max_rooms: 10, max_users: 3, is_current: true, subscription_status: 'trialing', is_perpetual: false });
    expect(e.features.reservations).toBe(true);
    expect(e.features.restaurant).toBeUndefined();
    expect(e.valid_until!.getTime()).toBeGreaterThan(Date.now());
  });

  it('une échéance dépassée n\'ouvre plus de droits, même si l\'état n\'a pas encore été basculé', async () => {
    const h = await registerHotel(db, { plan: 'business' });
    await expireSubscription(h);
    expect(await ent(h)).toMatchObject({ source: 'subscription', subscription_status: 'active', is_current: false });
    // un abonnement résilié ne donne plus aucun droit
    await plat((tx) => tx.query("UPDATE subscriptions SET status = 'cancelled', ended_at = now() WHERE hotel_id = $1", [h.hotelId]));
    expect(await ent(h)).toMatchObject({ source: 'none', max_rooms: 0 });
  });

  it('un impayé non encore résilié (past_due) conserve ses droits jusqu\'à l\'échéance', async () => {
    const h = await registerHotel(db, { plan: 'business' });
    await plat((tx) => tx.query(`UPDATE subscriptions SET status = 'past_due', trial_ends_at = NULL, current_period_end = now() + interval '3 days' WHERE hotel_id = $1`, [h.hotelId]));
    expect(await ent(h)).toMatchObject({ source: 'subscription', subscription_status: 'past_due', is_current: true });
  });

  it('une licence définitive prime sur l\'abonnement et ne dépend d\'aucune échéance', async () => {
    const h = await registerHotel(db, { plan: 'starter' });
    await expireSubscription(h);
    expect((await ent(h)).is_current).toBe(false);
    const lic = await newLicense(h, { maxRooms: 200, maxUsers: null, features: { reservations: true, restaurant: true, finances: true } });
    const e = await ent(h);
    expect(e).toMatchObject({ source: 'license', plan_code: 'perpetuelle-pro', max_rooms: 200, max_users: null, is_perpetual: true, valid_until: null, is_current: true });
    expect(e.features.finances).toBe(true);
    // révoquée -> retour aux droits de l'abonnement (ici périmé)
    await plat((tx) => tx.query("UPDATE licenses SET status = 'revoked', revoked_at = now(), revoked_reason = 'Impayé de maintenance' WHERE id = $1", [lic]));
    expect(await ent(h)).toMatchObject({ source: 'subscription', is_current: false });
  });

  it('une licence suspendue ou en attente n\'est pas appliquée', async () => {
    const h = await registerHotel(db, { plan: 'starter' });
    await newLicense(h, { status: 'pending' });
    await newLicense(h, { status: 'suspended' });
    expect((await ent(h)).source).toBe('subscription');
  });

  it('distingue le droit d\'usage perpétuel de la couverture de maintenance (mises à jour et support)', async () => {
    const lapsed = await registerHotel(db, { plan: null });
    await newLicense(lapsed, { maintenance: "2020-01-01T00:00:00Z" });
    expect(await ent(lapsed)).toMatchObject({ source: 'license', is_current: true, license_support_active: false });
    const covered = await registerHotel(db, { plan: null });
    await newLicense(covered, { maintenance: new Date(Date.now() + 365 * 864e5).toISOString() });
    expect((await ent(covered)).license_support_active).toBe(true);
    const lifetime = await registerHotel(db, { plan: null });
    await newLicense(lifetime, { maintenance: null });
    expect((await ent(lifetime)).license_support_active).toBe(true);
  });
});

describe('licences : intégrité et confidentialité', () => {
  it('une seule licence active par établissement ; les clés (empreintes) sont uniques', async () => {
    const h = await registerHotel(db, { plan: null });
    await newLicense(h);
    expect((await sqlState(newLicense(h))).code).toBe('23505');
    await newLicense(h, { status: 'suspended' }); // les autres statuts ne sont pas limités
    const dup = createHash('sha256').update('meme-cle').digest('hex');
    const insert = (hotel: HotelFixture, status: string) => plat((tx) => tx.query(
      `INSERT INTO licenses (hotel_id, key_hash, key_prefix, edition_code, status) VALUES ($1, $2, 'HMP', 'x', $3)`, [hotel.hotelId, dup, status]));
    const h2 = await registerHotel(db, { plan: null });
    await insert(h2, 'pending');
    expect((await sqlState(insert(h, 'pending'))).code).toBe('23505');
  });

  it('une licence active exige une date d\'activation ; révoquée, un motif', async () => {
    const h = await registerHotel(db, { plan: null });
    const ins = (status: string, extra = '') => plat((tx) => tx.query(
      `INSERT INTO licenses (hotel_id, key_hash, key_prefix, edition_code, status ${extra ? ', ' + extra.split('=')[0] : ''}) VALUES ($1, $2, 'p', 'e', $3 ${extra ? ', ' + extra.split('=')[1] : ''})`,
      [h.hotelId, randomUUID(), status]));
    expect((await sqlState(ins('active'))).code).toBe('23514');
    expect((await sqlState(ins('revoked'))).code).toBe('23514');
  });

  it('l\'hôtel lit sa licence (jamais celle d\'un autre) et ne peut ni la créer ni la modifier', async () => {
    const a = await registerHotel(db, { plan: null });
    const b = await registerHotel(db, { plan: null });
    await newLicense(a);
    await newLicense(b);
    const seen = (await asHotel(a, (tx) => tx.query('SELECT hotel_id FROM licenses'))).rows;
    expect(seen).toHaveLength(1);
    expect(seen[0].hotel_id).toBe(a.hotelId);
    for (const sql of ["UPDATE licenses SET max_rooms = NULL, maintenance_until = NULL", 'DELETE FROM licenses', "UPDATE licenses SET status = 'active'"]) {
      expect((await sqlState(asHotel(a, (tx) => tx.query(sql)))).code, sql).toBe('42501');
    }
  });

  it('une licence ne peut référencer la facture d\'un autre établissement', async () => {
    const a = await registerHotel(db, { plan: null });
    const b = await registerHotel(db, { plan: null });
    const inv = randomUUID();
    await plat((tx) => tx.query(`INSERT INTO saas_invoices (id, hotel_id, currency) VALUES ($1, $2, 'MGA')`, [inv, b.hotelId]));
    const r = await sqlState(plat((tx) => tx.query(
      `INSERT INTO licenses (hotel_id, key_hash, key_prefix, edition_code, saas_invoice_id) VALUES ($1, $2, 'p', 'e', $3)`, [a.hotelId, randomUUID(), inv])));
    expect(r.code).toBe('23503');
  });

  it('le journal des licences est en ajout seul', async () => {
    const h = await registerHotel(db, { plan: null });
    const lic = await newLicense(h);
    await plat((tx) => tx.query(`INSERT INTO license_events (hotel_id, license_id, event_type, admin_id) VALUES ($1, $2, 'issued', $3)`, [h.hotelId, lic, admin]));
    expect((await sqlState(plat((tx) => tx.query("UPDATE license_events SET event_type = 'revoked'")))).code).toBe('42501');
    expect((await sqlState(plat((tx) => tx.query('DELETE FROM license_events')))).code).toBe('42501');
  });
});

describe('limites imposées par la base (contourner l\'API ne suffit pas)', () => {
  const addRoom = (h: HotelFixture, categoryId: string, n: string | number) =>
    asHotel(h, (tx) => tx.query('INSERT INTO rooms (hotel_id, category_id, number) VALUES ($1, $2, $3)', [h.hotelId, categoryId, String(n)]));
  const roomCount = async (h: HotelFixture) => (await db.admin.query('SELECT count(*)::int AS n FROM rooms WHERE hotel_id = $1 AND NOT is_archived', [h.hotelId])).rows[0].n as number;

  it('Starter : 10 chambres maximum, la 11e est refusée avec la limite en détail', async () => {
    const h = await registerHotel(db, { plan: 'starter' });
    const { categoryId } = await seedRooms(db, h, 10);
    const r = await sqlState(addRoom(h, categoryId, 'X11'));
    expect(r.code).toBe('HM001');
    expect(r.message).toBe('room_limit_reached');
    expect(await roomCount(h)).toBe(10);
  });

  it('archiver libère une place ; désarchiver au-delà de la limite est refusé', async () => {
    const h = await registerHotel(db, { plan: 'starter' });
    const { categoryId, roomIds } = await seedRooms(db, h, 10);
    await asHotel(h, (tx) => tx.query('UPDATE rooms SET is_archived = true WHERE id = $1', [roomIds[0]]));
    await addRoom(h, categoryId, 'NEW');
    const r = await sqlState(asHotel(h, (tx) => tx.query('UPDATE rooms SET is_archived = false WHERE id = $1', [roomIds[0]])));
    expect(r.message).toBe('room_limit_reached');
  });

  it('15 créations simultanées sur un hôtel vide ne dépassent jamais la limite de 10', async () => {
    const h = await registerHotel(db, { plan: 'starter' });
    const { categoryId } = await seedRooms(db, h, 0);
    const results = await Promise.allSettled(Array.from({ length: 15 }, (_, i) => addRoom(h, categoryId, `C${i}`)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
    expect(await roomCount(h)).toBe(10);
  });

  it('les limites sont par établissement : un hôtel plein n\'empêche pas un autre', async () => {
    const full = await registerHotel(db, { plan: 'starter' });
    await seedRooms(db, full, 10);
    const other = await registerHotel(db, { plan: 'starter' });
    await seedRooms(db, other, 10);
    expect(await roomCount(other)).toBe(10);
  });

  it('une licence illimitée (NULL) lève la limite ; sans abonnement ni licence, aucune chambre', async () => {
    const h = await registerHotel(db, { plan: 'starter' });
    const { categoryId } = await seedRooms(db, h, 10);
    await newLicense(h, { maxRooms: null });
    await addRoom(h, categoryId, 'LIC-11');
    expect(await roomCount(h)).toBe(11);
    const none = await registerHotel(db, { plan: null });
    const { rows } = await asHotel(none, (tx) => tx.query("INSERT INTO room_categories (hotel_id, code, name) VALUES ($1, 'S', 'Std') RETURNING id", [none.hotelId]));
    expect((await sqlState(addRoom(none, rows[0].id, '1'))).message).toBe('room_limit_reached');
  });

  it('une rétrogradation ne supprime rien mais interdit d\'en ajouter ; une montée en gamme débloque', async () => {
    const h = await registerHotel(db, { plan: 'business' });
    const { categoryId, roomIds } = await seedRooms(db, h, 12);
    await plat((tx) => tx.query("UPDATE subscriptions SET plan_id = (SELECT id FROM plans WHERE code = 'starter') WHERE hotel_id = $1", [h.hotelId]));
    expect(await roomCount(h)).toBe(12);
    await asHotel(h, (tx) => tx.query("UPDATE rooms SET name = 'Rénovée' WHERE id = $1", [roomIds[0]])); // l'existant reste modifiable
    expect((await sqlState(addRoom(h, categoryId, 'EXTRA'))).message).toBe('room_limit_reached');
    await plat((tx) => tx.query("UPDATE subscriptions SET plan_id = (SELECT id FROM plans WHERE code = 'premium') WHERE hotel_id = $1", [h.hotelId]));
    await addRoom(h, categoryId, 'EXTRA');
    expect(await roomCount(h)).toBe(13);
  });

  describe('utilisateurs', () => {
    const addMember = async (h: HotelFixture, status = 'active') => {
      const uid = randomUUID();
      await db.admin.query('INSERT INTO users (id, email, full_name, password_hash) VALUES ($1, $2, $3, $4)', [uid, `u-${uid}@example.test`, 'Employé', '$argon2id$x']);
      return asHotel(h, (tx) => tx.query('INSERT INTO memberships (hotel_id, user_id, role_id, status) VALUES ($1, $2, $3, $4) RETURNING id', [h.hotelId, uid, h.roleId, status]));
    };

    it('Starter : 3 utilisateurs (propriétaire inclus) ; le 4e est refusé, une invitation compte', async () => {
      const h = await registerHotel(db, { plan: 'starter' });
      await addMember(h);
      await addMember(h, 'invited');
      const r = await sqlState(addMember(h));
      expect(r.message).toBe('user_limit_reached');
    });

    it('désactiver un compte libère une place ; le réactiver est soumis à la limite', async () => {
      const h = await registerHotel(db, { plan: 'starter' });
      const m1 = (await addMember(h)).rows[0].id;
      await addMember(h);
      await asHotel(h, (tx) => tx.query("UPDATE memberships SET status = 'disabled' WHERE id = $1", [m1]));
      await addMember(h);
      expect((await sqlState(asHotel(h, (tx) => tx.query("UPDATE memberships SET status = 'active' WHERE id = $1", [m1])))).message).toBe('user_limit_reached');
    });

    it('des ajouts simultanés ne dépassent pas la limite', async () => {
      const h = await registerHotel(db, { plan: 'starter' });
      const results = await Promise.allSettled(Array.from({ length: 6 }, () => addMember(h)));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2); // propriétaire + 2 = 3
      const { rows } = await db.admin.query("SELECT count(*)::int AS n FROM memberships WHERE hotel_id = $1 AND status IN ('active', 'invited')", [h.hotelId]);
      expect(rows[0].n).toBe(3);
    });
  });
});

describe('support : un hôtel ne voit jamais les notes internes ni les tickets des autres', () => {
  const open = (h: HotelFixture, subject = 'Impossible d\'émettre une facture') =>
    asHotel(h, async (tx) => (await tx.query(
      `INSERT INTO support_tickets (hotel_id, subject, category, priority, created_by_user_id) VALUES ($1, $2, 'technical', 'high', $3) RETURNING id, number`,
      [h.hotelId, subject, h.userId])).rows[0] as { id: string; number: string });
  const say = (h: HotelFixture, ticketId: string, body = 'Bonjour, voici le détail.') =>
    asHotel(h, (tx) => tx.query(`INSERT INTO support_messages (ticket_id, hotel_id, author_kind, author_user_id, body) VALUES ($1, $2, 'hotel_user', $3, $4)`, [ticketId, h.hotelId, h.userId, body]));

  it('l\'hôtel ouvre un ticket numéroté ; statut et affectation ne sont pas de son ressort', async () => {
    const h = await registerHotel(db, { plan: 'starter' });
    const t = await open(h);
    expect(t.number).toMatch(/^SUP-\d{6}$/);
    expect((await sqlState(asHotel(h, (tx) => tx.query(
      `INSERT INTO support_tickets (hotel_id, subject, status) VALUES ($1, 'Ticket déjà résolu', 'resolved')`, [h.hotelId])))).code).toBe('42501');
    expect((await sqlState(asHotel(h, (tx) => tx.query(
      `INSERT INTO support_tickets (hotel_id, subject, assigned_admin_id) VALUES ($1, 'Auto-affecté', $2)`, [h.hotelId, admin])))).code).toBe('42501');
    expect((await sqlState(asHotel(h, (tx) => tx.query("UPDATE support_tickets SET status = 'closed'")))).code).toBe('42501');
    const b = await registerHotel(db, { plan: 'starter' });
    const t2 = await open(b);
    expect(Number(t2.number.slice(4))).toBeGreaterThan(Number(t.number.slice(4)));
  });

  it('la plateforme répond publiquement et en note interne ; l\'hôtel ne voit que le public', async () => {
    const h = await registerHotel(db, { plan: 'starter' });
    const t = await open(h);
    await say(h, t.id, 'Le bouton Émettre ne répond pas.');
    await plat(async (tx) => {
      await tx.query(`INSERT INTO support_messages (ticket_id, hotel_id, author_kind, author_admin_id, body) VALUES ($1, $2, 'platform_admin', $3, 'Nous regardons.')`, [t.id, h.hotelId, admin]);
      await tx.query(`INSERT INTO support_messages (ticket_id, hotel_id, author_kind, author_admin_id, body, is_internal) VALUES ($1, $2, 'platform_admin', $3, 'Client en retard de paiement, rester prudent.', true)`, [t.id, h.hotelId, admin]);
      await tx.query("UPDATE support_tickets SET status = 'in_progress', assigned_admin_id = $2, first_response_at = now() WHERE id = $1", [t.id, admin]);
    });
    const visible = (await asHotel(h, (tx) => tx.query('SELECT body, is_internal FROM support_messages ORDER BY created_at'))).rows;
    expect(visible.map((m) => m.body)).toEqual(['Le bouton Émettre ne répond pas.', 'Nous regardons.']);
    expect(visible.every((m) => m.is_internal === false)).toBe(true);
    expect((await plat((tx) => tx.query('SELECT 1 FROM support_messages WHERE ticket_id = $1', [t.id]))).rowCount).toBe(3);
    expect((await asHotel(h, (tx) => tx.query('SELECT status FROM support_tickets WHERE id = $1', [t.id]))).rows[0].status).toBe('in_progress');
  });

  it('l\'hôtel ne peut ni écrire une note interne, ni se faire passer pour la plateforme ou un autre utilisateur', async () => {
    const h = await registerHotel(db, { plan: 'starter' });
    const t = await open(h);
    expect((await sqlState(asHotel(h, (tx) => tx.query(
      `INSERT INTO support_messages (ticket_id, hotel_id, author_kind, author_user_id, body, is_internal) VALUES ($1, $2, 'hotel_user', $3, 'x', true)`, [t.id, h.hotelId, h.userId])))).code).toBe('42501');
    expect((await sqlState(asHotel(h, (tx) => tx.query(
      `INSERT INTO support_messages (ticket_id, hotel_id, author_kind, author_admin_id, body) VALUES ($1, $2, 'platform_admin', $3, 'Réponse officielle')`, [t.id, h.hotelId, admin])))).code).toBe('42501');
    expect((await sqlState(asHotel(h, (tx) => tx.query(
      `INSERT INTO support_messages (ticket_id, hotel_id, author_kind, author_user_id, body) VALUES ($1, $2, 'hotel_user', $3, 'Usurpation')`, [t.id, h.hotelId, randomUUID()])))).code).toBe('42501');
  });

  it('un hôtel ne voit pas les tickets d\'un autre et ne peut pas poster dans son ticket', async () => {
    const a = await registerHotel(db, { plan: 'starter' });
    const b = await registerHotel(db, { plan: 'starter' });
    const ta = await open(a);
    await say(a, ta.id);
    expect((await asHotel(b, (tx) => tx.query('SELECT 1 FROM support_tickets'))).rowCount).toBe(0);
    expect((await asHotel(b, (tx) => tx.query('SELECT 1 FROM support_messages'))).rowCount).toBe(0);
    // B tente de rattacher un message (signé de son propre hôtel) au ticket de A : la clé composite l'interdit
    const r = await sqlState(say(b, ta.id, 'Message intrus'));
    expect(r.code).toBe('23503');
  });
});
