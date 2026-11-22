import { dialCodeFor, isDateString, normalizePhone } from '@hmp/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../db';
import { AppError } from '../errors';
import { auditHotel } from '../lib/audit';
import { toCsv } from '../lib/csv';
import { decrypt, encrypt } from '../lib/crypto';
import { buildUpdate, withUnique } from '../lib/sql';

const id = z.object({ id: z.uuid() });
const date = z.string().refine(isDateString, 'Date invalide (format AAAA-MM-JJ).');
const country = z.string().regex(/^[A-Z]{2}$/, 'Code pays à 2 lettres, ex. MG.');

const fields = {
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.email().max(254).nullable(),
  phone: z.string().trim().max(30).nullable(),
  birthDate: date.nullable(),
  address: z.string().trim().max(240).nullable(),
  city: z.string().trim().max(80).nullable(),
  country: country.nullable(),
  nationality: country.nullable(),
  isVip: z.boolean(),
  tags: z.array(z.string().trim().min(1).max(30)).max(20),
  preferences: z.record(z.string().trim().min(1).max(40), z.string().trim().max(200)).refine((o) => Object.keys(o).length <= 20, 'Vingt préférences au plus.'),
  marketingConsent: z.boolean(),
};
const COLUMNS: Record<string, string> = {
  firstName: 'first_name', lastName: 'last_name', email: 'email', phone: 'phone', birthDate: 'birth_date', address: 'address', city: 'city', country: 'country',
  nationality: 'nationality', isVip: 'is_vip', tags: 'tags', preferences: 'preferences', marketingConsent: 'marketing_consent',
};
const UNIQUE = { guests_email_uq: 'guest_email_taken' } as const;

const SELECT = `g.id, g.first_name AS "firstName", g.last_name AS "lastName", g.email, g.phone, to_char(g.birth_date, 'YYYY-MM-DD') AS "birthDate", g.address, g.city,
  g.country, g.nationality, g.is_vip AS "isVip", g.tags, g.preferences, g.marketing_consent AS "marketingConsent", g.version, g.created_at AS "createdAt"`;

/** La fiche et celles qui y ont été fusionnées (doublons) : l'historique d'un client les réunit toutes. */
async function family(tx: Tx, guestId: string): Promise<string[]> {
  const { rows } = await tx.query<{ id: string }>(
    'WITH RECURSIVE f(id) AS (SELECT id FROM guests WHERE id = $1 UNION SELECT g.id FROM guests g JOIN f ON g.merged_into_id = f.id) SELECT id FROM f',
    [guestId],
  );
  return rows.map((r) => r.id);
}

async function dialCode(tx: Tx, hotelId: string): Promise<string> {
  const { rows } = await tx.query<{ country: string }>('SELECT country FROM hotels WHERE id = $1', [hotelId]);
  return dialCodeFor(rows[0]?.country);
}

interface Candidate { id: string; firstName: string; lastName: string; email: string | null; phone: string | null; reason: 'email' | 'phone' | 'name' }

/** Doublons probables : même e-mail, même téléphone normalisé, ou même nom (et même date de naissance si elle est connue). */
async function findDuplicates(tx: Tx, hotelId: string, input: { firstName?: string; lastName?: string; email?: string | null; phone?: string | null; birthDate?: string | null }, excludeId?: string): Promise<Candidate[]> {
  const norm = input.phone ? normalizePhone(input.phone, await dialCode(tx, hotelId)) : null;
  const { rows } = await tx.query<Candidate>(
    `SELECT g.id, g.first_name AS "firstName", g.last_name AS "lastName", g.email, g.phone,
            CASE WHEN $1::citext IS NOT NULL AND g.email = $1::citext THEN 'email'
                 WHEN $2::text IS NOT NULL AND g.phone_normalized = $2 THEN 'phone'
                 ELSE 'name' END AS reason
     FROM guests g
     WHERE g.merged_into_id IS NULL AND g.anonymized_at IS NULL AND ($5::uuid IS NULL OR g.id <> $5)
       AND (($1::citext IS NOT NULL AND g.email = $1::citext)
         OR ($2::text IS NOT NULL AND g.phone_normalized = $2)
         OR ($3::text IS NOT NULL AND $4::text IS NOT NULL AND lower(g.first_name) = lower($3) AND lower(g.last_name) = lower($4)
             AND ($6::date IS NULL OR g.birth_date IS NULL OR g.birth_date = $6::date)))
     ORDER BY CASE WHEN $1::citext IS NOT NULL AND g.email = $1::citext THEN 0 WHEN $2::text IS NOT NULL AND g.phone_normalized = $2 THEN 1 ELSE 2 END, g.last_name LIMIT 5`,
    [input.email ?? null, norm, input.firstName ?? null, input.lastName ?? null, excludeId ?? null, input.birthDate ?? null],
  );
  return rows;
}

export default async function guestsRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const read = app.hotelAuth({ permission: 'guests:read' });
  const manage = app.hotelAuth({ permission: 'guests:manage' });
  const reveal = app.hotelAuth({ permission: 'guests:read_id_document' });
  const exportAuth = app.hotelAuth({ permission: 'guests:export' });
  const tags = ['Clients'];
  const { config } = app.deps;

  /* ------------------------------------------------------------------ Recherche */
  r.get('/guests', {
    preValidation: read,
    schema: {
      tags,
      summary: 'Rechercher des clients (nom, e-mail, téléphone)',
      querystring: z.object({
        q: z.string().trim().max(80).optional(),
        vip: z.enum(['true']).optional(),
        tag: z.string().trim().max(30).optional(),
        sort: z.enum(['name', 'recent']).default('name'),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
      }),
    },
  }, async (req) => {
    const { q, vip, tag, sort, page, pageSize } = req.query;
    const digits = q ? q.replace(/\D/g, '') : '';
    return req.hotel!.tenant(async (tx) => {
      const where = `g.merged_into_id IS NULL AND g.anonymized_at IS NULL
        AND ($1::text IS NULL OR g.first_name ILIKE '%' || $1 || '%' OR g.last_name ILIKE '%' || $1 || '%' OR (g.first_name || ' ' || g.last_name) ILIKE '%' || $1 || '%'
             OR g.email::text ILIKE '%' || $1 || '%' OR ($2::text IS NOT NULL AND g.phone_normalized LIKE '%' || $2 || '%'))
        AND ($3::boolean IS NOT TRUE OR g.is_vip) AND ($4::text IS NULL OR $4 = ANY (g.tags))`;
      const local = digits.replace(/^0+/, ''); // « 034 00 000 00 » se cherche comme « 340000000 » (l'indicatif pays est stocké)
      const args = [q || null, local.length >= 4 ? local : null, vip === 'true', tag ?? null];
      const { rows: total } = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM guests g WHERE ${where}`, args);
      const { rows } = await tx.query(
        `SELECT g.id, g.first_name AS "firstName", g.last_name AS "lastName", g.email, g.phone, g.city, g.country, g.is_vip AS "isVip", g.tags,
                (SELECT count(*)::int FROM reservations r WHERE r.guest_id = g.id AND r.status IN ('checked_in', 'checked_out')) AS "staysCount",
                g.created_at AS "createdAt"
         FROM guests g WHERE ${where}
         ORDER BY ${sort === 'recent' ? 'g.created_at DESC' : 'lower(g.last_name), lower(g.first_name)'}, g.id
         LIMIT $5 OFFSET $6`,
        [...args, pageSize, (page - 1) * pageSize],
      );
      return { items: rows, total: total[0]!.n, page, pageSize };
    });
  });

  r.get('/guests/duplicates', {
    preValidation: read,
    schema: { tags, summary: 'Clients qui ressemblent à une saisie (avant de créer une fiche)', querystring: z.object({
      firstName: z.string().trim().max(80).optional(), lastName: z.string().trim().max(80).optional(), email: z.string().trim().max(254).optional(),
      phone: z.string().trim().max(30).optional(), birthDate: date.optional(), excludeId: z.uuid().optional(),
    }) },
  }, async (req) => {
    const me = req.hotel!;
    const { excludeId, email, phone, ...rest } = req.query;
    return { candidates: await me.tenant((tx) => findDuplicates(tx, me.hotelId, { ...rest, email: email || null, phone: phone || null }, excludeId)) };
  });

  /* ------------------------------------------------------------------ Création */
  r.post('/guests', {
    preValidation: manage,
    schema: {
      tags,
      summary: 'Créer un client (refuse un e-mail déjà pris ; signale les doublons probables sauf confirmation)',
      body: z.object(fields).partial({ email: true, phone: true, birthDate: true, address: true, city: true, country: true, nationality: true, isVip: true, tags: true, preferences: true, marketingConsent: true })
        .extend({ confirmDuplicate: z.boolean().optional() }),
    },
  }, async (req, reply) => {
    const me = req.hotel!;
    const { confirmDuplicate, ...b } = req.body;
    const created = await me.tenant((tx) =>
      withUnique(UNIQUE, async () => {
        if (b.birthDate && b.birthDate > new Date().toISOString().slice(0, 10)) throw new AppError('validation_error', [{ path: 'birthDate', message: 'La date de naissance ne peut pas être dans le futur.' }]);
        if (!confirmDuplicate) {
          const dup = await findDuplicates(tx, me.hotelId, b);
          if (dup.length) throw new AppError('possible_duplicate', dup);
        }
        const norm = b.phone ? normalizePhone(b.phone, await dialCode(tx, me.hotelId)) : null;
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO guests (hotel_id, first_name, last_name, email, phone, phone_normalized, birth_date, address, city, country, nationality, is_vip, tags, preferences, marketing_consent)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
          [me.hotelId, b.firstName, b.lastName, b.email ?? null, b.phone ?? null, norm, b.birthDate ?? null, b.address ?? null, b.city ?? null, b.country ?? null, b.nationality ?? null, b.isVip ?? false, b.tags ?? [], JSON.stringify(b.preferences ?? {}), b.marketingConsent ?? false],
        );
        await auditHotel(tx, me, 'guest.created', { type: 'guest', id: rows[0]!.id }, `Client ${b.firstName} ${b.lastName} créé`, { ip: req.ip, requestId: req.id });
        return rows[0]!;
      }),
    );
    return reply.code(201).send(created);
  });

  /* ------------------------------------------------------------------ Export (avant /guests/:id pour ne pas être pris pour un identifiant) */
  r.get('/guests/export.csv', { preValidation: exportAuth, schema: { tags, summary: 'Exporter les clients en CSV (Excel) — journalisé' } }, async (req, reply) => {
    const me = req.hotel!;
    const rows = await me.tenant(async (tx) => {
      const { rows: list } = await tx.query(
        `SELECT first_name, last_name, email, phone, to_char(birth_date, 'YYYY-MM-DD') AS birth_date, address, city, country, nationality, is_vip, tags, marketing_consent, created_at
         FROM guests WHERE merged_into_id IS NULL AND anonymized_at IS NULL ORDER BY lower(last_name), lower(first_name)`,
      );
      await auditHotel(tx, me, 'guest.exported', { type: 'guest' }, `Export CSV de ${list.length} clients`, { ip: req.ip, requestId: req.id });
      return list;
    });
    const csv = toCsv(
      ['Prénom', 'Nom', 'E-mail', 'Téléphone', 'Date de naissance', 'Adresse', 'Ville', 'Pays', 'Nationalité', 'VIP', 'Étiquettes', 'Consentement marketing', 'Créé le'],
      rows.map((g) => [g.first_name, g.last_name, g.email, g.phone, g.birth_date, g.address, g.city, g.country, g.nationality, g.is_vip ? 'oui' : 'non', (g.tags as string[]).join(', '), g.marketing_consent ? 'oui' : 'non', g.created_at]),
    );
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="clients-${new Date().toISOString().slice(0, 10)}.csv"`).send(csv);
  });

  /* ------------------------------------------------------------------ Fiche */
  r.get('/guests/:id', { preValidation: read, schema: { tags, summary: 'Fiche client : coordonnées, notes, pièces (masquées), séjours et statistiques', params: id } }, async (req) => {
    const me = req.hotel!;
    return me.tenant(async (tx) => {
      const { rows } = await tx.query(`SELECT ${SELECT}, g.merged_into_id AS "mergedIntoId", g.anonymized_at AS "anonymizedAt" FROM guests g WHERE g.id = $1`, [req.params.id]);
      if (!rows[0]) throw new AppError('guest_not_found');
      const ids = await family(tx, req.params.id);
      const { rows: notes } = await tx.query(
        `SELECT n.id, n.body, n.created_at AS "createdAt", u.full_name AS author FROM guest_notes n
         LEFT JOIN memberships m ON m.id = n.author_membership_id LEFT JOIN users u ON u.id = m.user_id
         WHERE n.guest_id = ANY ($1) ORDER BY n.created_at DESC`,
        [ids],
      );
      const { rows: documents } = await tx.query(
        `SELECT id, doc_type AS "docType", number_last4 AS last4, issuing_country AS "issuingCountry", to_char(expires_on, 'YYYY-MM-DD') AS "expiresOn", created_at AS "createdAt"
         FROM guest_documents WHERE guest_id = ANY ($1) ORDER BY created_at DESC`,
        [ids],
      );
      const { rows: stays } = await tx.query(
        `SELECT r.id, r.reference, r.status, r.currency, r.total_amount AS "totalAmount", to_char(min(rr.check_in), 'YYYY-MM-DD') AS "checkIn",
                to_char(max(rr.check_out), 'YYYY-MM-DD') AS "checkOut", sum(rr.nights)::int AS nights
         FROM reservations r JOIN reservation_rooms rr ON rr.reservation_id = r.id
         WHERE r.guest_id = ANY ($1) GROUP BY r.id ORDER BY min(rr.check_in) DESC LIMIT 50`,
        [ids],
      );
      const done = stays.filter((s) => s.status === 'checked_out');
      const spent = new Map<string, number>();
      for (const s of done) spent.set(s.currency, (spent.get(s.currency) ?? 0) + s.totalAmount);
      return {
        guest: rows[0],
        notes,
        documents,
        stays,
        stats: { stays: done.length, nights: done.reduce((n, s) => n + s.nights, 0), spentByCurrency: [...spent].map(([currency, amount]) => ({ currency, amount })) },
        mergedCount: ids.length - 1,
      };
    });
  });

  r.patch('/guests/:id', {
    preValidation: manage,
    schema: { tags, summary: 'Modifier une fiche (contrôle de version)', params: id, body: z.object(fields).partial().extend({ version: z.number().int().min(1) }) },
  }, async (req) => {
    const me = req.hotel!;
    const { version, ...patch } = req.body;
    let updated: string[] = [];
    if (patch.birthDate && patch.birthDate > new Date().toISOString().slice(0, 10)) throw new AppError('validation_error', [{ path: 'birthDate', message: 'La date de naissance ne peut pas être dans le futur.' }]);
    await me.tenant((tx) =>
      withUnique(UNIQUE, async () => {
        const cur = await tx.query<{ anonymized_at: Date | null; merged_into_id: string | null }>('SELECT anonymized_at, merged_into_id FROM guests WHERE id = $1', [req.params.id]);
        if (!cur.rows[0]) throw new AppError('guest_not_found');
        if (cur.rows[0].anonymized_at || cur.rows[0].merged_into_id) throw new AppError('invalid_state');
        // Un seul UPDATE (la version n'est incrémentée qu'une fois) : le téléphone normalisé suit le téléphone saisi
        const extra: Record<string, unknown> = {};
        if (patch.phone !== undefined) extra.phoneNormalized = patch.phone ? normalizePhone(patch.phone, await dialCode(tx, me.hotelId)) : null;
        if (patch.preferences) extra.preferences = JSON.stringify(patch.preferences);
        const u = buildUpdate('guests', { ...COLUMNS, phoneNormalized: 'phone_normalized' }, { ...patch, ...extra }, { column: 'id', value: req.params.id, version });
        const res = await tx.query(u.sql, u.args);
        if (!res.rowCount) throw new AppError('version_conflict');
        updated = u.keys.filter((k) => k !== 'phoneNormalized');
        await auditHotel(tx, me, 'guest.updated', { type: 'guest', id: req.params.id }, `Fiche client modifiée : ${updated.join(', ')}`, { ip: req.ip, requestId: req.id });
      }),
    );
    return { updated };
  });

  /* ------------------------------------------------------------------ Notes (ajout seul) */
  r.post('/guests/:id/notes', { preValidation: manage, schema: { tags, summary: 'Ajouter une note (jamais modifiable)', params: id, body: z.object({ body: z.string().trim().min(1).max(2000) }) } }, async (req, reply) => {
    const me = req.hotel!;
    await me.tenant(async (tx) => {
      const g = await tx.query('SELECT 1 FROM guests WHERE id = $1 AND anonymized_at IS NULL', [req.params.id]);
      if (!g.rowCount) throw new AppError('guest_not_found');
      await tx.query('INSERT INTO guest_notes (hotel_id, guest_id, author_membership_id, body) VALUES ($1, $2, $3, $4)', [me.hotelId, req.params.id, me.membershipId, req.body.body]);
    });
    return reply.code(201).send({ ok: true });
  });

  /* ------------------------------------------------------------------ Pièces d'identité : numéro chiffré, lecture permissionnée et journalisée */
  r.post('/guests/:id/documents', {
    preValidation: manage,
    schema: { tags, summary: 'Enregistrer une pièce d\'identité (le numéro est chiffré)', params: id, body: z.object({
      docType: z.enum(['national_id', 'passport', 'driver_license', 'residence_permit', 'other']),
      number: z.string().trim().min(3).max(40), issuingCountry: country.nullable().optional(), expiresOn: date.nullable().optional(),
    }) },
  }, async (req, reply) => {
    const me = req.hotel!;
    const b = req.body;
    const doc = await me.tenant(async (tx) => {
      const g = await tx.query('SELECT 1 FROM guests WHERE id = $1 AND anonymized_at IS NULL AND merged_into_id IS NULL', [req.params.id]);
      if (!g.rowCount) throw new AppError('guest_not_found');
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO guest_documents (hotel_id, guest_id, doc_type, number_enc, key_version, number_last4, issuing_country, expires_on)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [me.hotelId, req.params.id, b.docType, encrypt(b.number, config.encryptionKey), config.encryptionKeyVersion, b.number.slice(-4).toUpperCase(), b.issuingCountry ?? null, b.expiresOn ?? null],
      );
      await auditHotel(tx, me, 'guest.document_added', { type: 'guest', id: req.params.id }, `Pièce d'identité ajoutée (${b.docType})`, { ip: req.ip, requestId: req.id });
      return rows[0]!;
    });
    return reply.code(201).send(doc);
  });

  r.get('/guests/:id/documents/:docId/reveal', {
    preValidation: reveal,
    schema: { tags, summary: 'Lire le numéro complet d\'une pièce (permission dédiée ; chaque lecture est journalisée)', params: z.object({ id: z.uuid(), docId: z.uuid() }) },
  }, async (req, reply) => {
    const me = req.hotel!;
    const number = await me.tenant(async (tx) => {
      const { rows } = await tx.query<{ number_enc: Buffer; doc_type: string }>('SELECT number_enc, doc_type FROM guest_documents WHERE id = $1 AND guest_id = $2', [req.params.docId, req.params.id]);
      if (!rows[0]) throw new AppError('not_found');
      await auditHotel(tx, me, 'guest.document_revealed', { type: 'guest', id: req.params.id }, `Numéro de pièce consulté (${rows[0].doc_type})`, { ip: req.ip, requestId: req.id });
      return decrypt(rows[0].number_enc, config.encryptionKey);
    });
    return reply.header('cache-control', 'no-store').send({ number });
  });

  r.delete('/guests/:id/documents/:docId', { preValidation: manage, schema: { tags, summary: 'Supprimer une pièce d\'identité', params: z.object({ id: z.uuid(), docId: z.uuid() }) } }, async (req, reply) => {
    const me = req.hotel!;
    await me.tenant(async (tx) => {
      const res = await tx.query('DELETE FROM guest_documents WHERE id = $1 AND guest_id = $2', [req.params.docId, req.params.id]);
      if (!res.rowCount) throw new AppError('not_found');
      await auditHotel(tx, me, 'guest.document_deleted', { type: 'guest', id: req.params.id }, 'Pièce d\'identité supprimée', { ip: req.ip, requestId: req.id });
    });
    return reply.code(204).send();
  });

  /* ------------------------------------------------------------------ Fusion et anonymisation */
  r.post('/guests/:id/merge', {
    preValidation: manage,
    schema: { tags, summary: 'Fusionner un doublon dans une autre fiche (l\'historique est réuni, rien n\'est supprimé)', params: id, body: z.object({ intoId: z.uuid() }) },
  }, async (req) => {
    const me = req.hotel!;
    if (req.params.id === req.body.intoId) throw new AppError('invalid_state');
    await me.tenant(async (tx) => {
      const { rows } = await tx.query<{ id: string; merged_into_id: string | null; anonymized_at: Date | null }>('SELECT id, merged_into_id, anonymized_at FROM guests WHERE id = ANY ($1)', [[req.params.id, req.body.intoId]]);
      if (rows.length !== 2) throw new AppError('guest_not_found');
      if (rows.some((g) => g.merged_into_id || g.anonymized_at)) throw new AppError('invalid_state');
      // la fiche absorbée ne doit pas être celle dans laquelle on fusionne (pas de cycle)
      const fam = await family(tx, req.params.id);
      if (fam.includes(req.body.intoId)) throw new AppError('invalid_state');
      await tx.query('UPDATE guests SET merged_into_id = $2 WHERE id = $1', [req.params.id, req.body.intoId]);
      await auditHotel(tx, me, 'guest.merged', { type: 'guest', id: req.params.id }, `Fiche fusionnée dans ${req.body.intoId}`, { ip: req.ip, requestId: req.id });
    });
    return { mergedInto: req.body.intoId };
  });

  r.post('/guests/:id/anonymize', {
    preValidation: manage,
    schema: { tags, summary: 'Anonymiser un client (droit à l\'effacement) : définitif, refusé tant qu\'un séjour est en cours ou à venir', params: id, body: z.object({ confirm: z.literal(true) }) },
  }, async (req) => {
    const me = req.hotel!;
    await me.tenant(async (tx) => {
      await tx.query('SELECT anonymize_guest($1)', [req.params.id]);
      await auditHotel(tx, me, 'guest.anonymized', { type: 'guest', id: req.params.id }, 'Client anonymisé', { ip: req.ip, requestId: req.id });
    });
    return { anonymized: true };
  });
}
