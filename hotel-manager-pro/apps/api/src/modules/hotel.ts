import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../errors';
import { auditHotel } from '../lib/audit';
import { buildUpdate } from '../lib/sql';

const profileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  legalName: z.string().trim().max(160).nullable(),
  taxId: z.string().trim().max(60).nullable(),
  country: z.string().regex(/^[A-Z]{2}$/, 'Code pays à 2 lettres, ex. MG'),
  city: z.string().trim().max(80).nullable(),
  address: z.string().trim().max(240).nullable(),
  phone: z.string().trim().max(30).nullable(),
  email: z.email().max(254).nullable(),
  website: z.url().max(200).nullable(),
}).partial();

const settingsSchema = z.object({
  defaultCurrency: z.enum(['MGA', 'EUR', 'USD']),
  locale: z.enum(['fr', 'en', 'mg']),
  timezone: z.string().max(64),
  checkInTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Format HH:MM'),
  checkOutTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Format HH:MM'),
  invoicePrefix: z.string().regex(/^[A-Z0-9-]{1,10}$/, '1 à 10 caractères : A-Z, 0-9, tiret'),
  reservationPrefix: z.string().regex(/^[A-Z0-9-]{1,10}$/, '1 à 10 caractères : A-Z, 0-9, tiret'),
  invoiceHeader: z.string().trim().max(500).nullable(),
  invoiceFooter: z.string().trim().max(500).nullable(),
}).partial();

const PROFILE_COLUMNS: Record<string, string> = {
  name: 'name', legalName: 'legal_name', taxId: 'tax_id', country: 'country', city: 'city', address: 'address', phone: 'phone', email: 'email', website: 'website',
};
const SETTINGS_COLUMNS: Record<string, string> = {
  defaultCurrency: 'default_currency', locale: 'locale', timezone: 'timezone', checkInTime: 'check_in_time', checkOutTime: 'check_out_time',
  invoicePrefix: 'invoice_prefix', reservationPrefix: 'reservation_prefix', invoiceHeader: 'invoice_header', invoiceFooter: 'invoice_footer',
};

const updateBy = (table: string, columns: Record<string, string>, patch: Record<string, unknown>, whereCol: string, whereVal: string) =>
  buildUpdate(table, columns, patch, { column: whereCol, value: whereVal });

export default async function hotelRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  // Profil et configuration restent accessibles même sans abonnement actif : on peut toujours finir de se configurer
  const open = (permission: 'settings:read' | 'settings:manage') => app.hotelAuth({ permission, lapsedOk: true });

  r.get('/hotel', { preValidation: open('settings:read'), schema: { tags: ['Établissement'], summary: 'Profil et réglages de l\'établissement' } }, async (req) => {
    const me = req.hotel!;
    const { rows } = await me.tenant((tx) =>
      tx.query(
        `SELECT h.id, h.slug, h.name, h.legal_name AS "legalName", h.tax_id AS "taxId", h.country, h.city, h.address, h.phone, h.email, h.website, h.status,
                s.default_currency AS "defaultCurrency", s.locale, s.timezone, to_char(s.check_in_time, 'HH24:MI') AS "checkInTime",
                to_char(s.check_out_time, 'HH24:MI') AS "checkOutTime", s.invoice_prefix AS "invoicePrefix", s.reservation_prefix AS "reservationPrefix",
                s.invoice_header AS "invoiceHeader", s.invoice_footer AS "invoiceFooter"
         FROM hotels h JOIN hotel_settings s ON s.hotel_id = h.id WHERE h.id = $1`,
        [me.hotelId],
      ),
    );
    return rows[0];
  });

  r.get('/hotel/usage', { preValidation: open('settings:read'), schema: { tags: ['Établissement'], summary: 'Utilisation des quotas (chambres, utilisateurs) face aux limites de la formule' } }, async (req) => {
    const me = req.hotel!;
    const { rooms, users } = await me.tenant(async (tx) => ({
      rooms: (await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM rooms WHERE NOT is_archived')).rows[0]!.n,
      users: (await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM memberships WHERE status IN ('active', 'invited')")).rows[0]!.n,
    }));
    return { rooms: { count: rooms, max: me.entitlements.max_rooms }, users: { count: users, max: me.entitlements.max_users } };
  });

  r.patch('/hotel', {
    preValidation: open('settings:manage'),
    schema: { tags: ['Établissement'], summary: 'Modifier le profil de l\'établissement', body: profileSchema },
  }, async (req) => {
    const me = req.hotel!;
    const u = updateBy('hotels', PROFILE_COLUMNS, req.body, 'id', me.hotelId);
    await me.tenant(async (tx) => {
      await tx.query(u.sql, u.args);
      await auditHotel(tx, me, 'hotel.profile_updated', { type: 'hotel', id: me.hotelId }, `Profil modifié : ${u.keys.join(', ')}`, { after: req.body, ip: req.ip, requestId: req.id });
    });
    return { updated: u.keys };
  });

  r.patch('/hotel/settings', {
    preValidation: open('settings:manage'),
    schema: { tags: ['Établissement'], summary: 'Modifier les réglages (devise, langue, fuseau, horaires, numérotation)', body: settingsSchema },
  }, async (req) => {
    const me = req.hotel!;
    const patch = req.body;
    // La devise de facturation ne change plus une fois la configuration terminée : des folios et des factures en dépendent
    if (patch.defaultCurrency !== undefined && me.hotelStatus !== 'onboarding') {
      const { rows } = await me.tenant((tx) => tx.query('SELECT default_currency FROM hotel_settings WHERE hotel_id = $1', [me.hotelId]));
      if (rows[0].default_currency !== patch.defaultCurrency) throw new AppError('currency_locked');
    }
    const u = updateBy('hotel_settings', SETTINGS_COLUMNS, patch, 'hotel_id', me.hotelId);
    await me.tenant(async (tx) => {
      await tx.query(u.sql, u.args);
      await auditHotel(tx, me, 'hotel.settings_updated', { type: 'hotel_settings', id: me.hotelId }, `Réglages modifiés : ${u.keys.join(', ')}`, { after: patch, ip: req.ip, requestId: req.id });
    });
    return { updated: u.keys };
  });

  r.post('/hotel/onboarding/complete', {
    preValidation: open('settings:manage'),
    schema: { tags: ['Établissement'], summary: 'Terminer la configuration initiale (passe le compte en « actif »)' },
  }, async (req) => {
    const me = req.hotel!;
    await me.tenant(async (tx) => {
      await tx.query('SELECT complete_onboarding()');
      await auditHotel(tx, me, 'hotel.onboarding_completed', { type: 'hotel', id: me.hotelId }, 'Configuration initiale terminée', { ip: req.ip, requestId: req.id });
    });
    const { rows } = await me.tenant((tx) => tx.query('SELECT status FROM hotels WHERE id = $1', [me.hotelId]));
    return { status: rows[0].status };
  });
}
