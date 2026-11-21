import { randomUUID } from 'node:crypto';
import { SYSTEM_ROLES } from '@hmp/shared';
import { tenantTx } from '../db';
import { AppError, fromDbError } from '../errors';
import { hashPassword } from '../lib/security';
import type { AppDeps } from '../types';
import { createHotelSession } from './session';

export interface RegisterInput {
  hotelName: string;
  country: string;
  city?: string;
  phone?: string;
  currency: string;
  timezone: string;
  locale: string;
  ownerName: string;
  email: string;
  password: string;
  planCode?: string;
}

const RESERVED = new Set(['admin', 'api', 'app', 'www', 'platform', 'support', 'login', 'register', 'static', 'assets', 'billing']);

export function slugify(name: string, city?: string): string {
  const base = [name, city].filter(Boolean).join(' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');
  const slug = base.length >= 3 ? base : `${base}-hotel`.replace(/^-/, '');
  return RESERVED.has(slug) ? `${slug}-hotel` : slug;
}

/** Moyens d'encaissement proposés par défaut : ENREGISTREMENT MANUEL à la réception (aucune connexion à un prestataire). */
const DEFAULT_PAYMENT_METHODS: Array<[string, string, string]> = [
  ['cash', 'Espèces', 'cash'],
  ['mvola', 'MVola', 'mobile_money'],
  ['orange_money', 'Orange Money', 'mobile_money'],
  ['airtel_money', 'Airtel Money', 'mobile_money'],
  ['card', 'Carte bancaire', 'card'],
  ['bank_transfer', 'Virement bancaire', 'bank_transfer'],
];

/**
 * Inscription indépendante d'un établissement : UNE transaction, sous le rôle applicatif, avec pour contexte les
 * identifiants que l'on s'apprête à créer. Les politiques `id = app_hotel_id()` / `id = app_user_id()` n'autorisent
 * alors que la création de CET hôtel et de CET utilisateur.
 *
 *   hôtel → réglages → essai gratuit → propriétaire → rôles et permissions → adhésion → moyens d'encaissement → session
 */
export async function registerHotel(
  deps: AppDeps,
  input: RegisterInput,
  meta: { ip: string | null; userAgent: string | null },
): Promise<{ token: string; tokenHash: string; hotelId: string; userId: string; trialStarted: boolean; slug: string }> {
  const passwordHash = await hashPassword(input.password);
  const hotelId = randomUUID();
  const userId = randomUUID();
  const baseSlug = slugify(input.hotelName, input.city);

  for (let attempt = 0; attempt < 4; attempt++) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug.slice(0, 44)}-${randomUUID().slice(0, 4)}`;
    try {
      const result = await tenantTx(deps.db, { hotelId, userId }, async (tx) => {
        await tx.query(
          'INSERT INTO hotels (id, slug, name, country, city, phone, email) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [hotelId, slug, input.hotelName, input.country, input.city ?? null, input.phone ?? null, input.email],
        );
        await tx.query('INSERT INTO hotel_settings (hotel_id, default_currency, locale, timezone) VALUES ($1, $2, $3, $4)', [
          hotelId, input.currency, input.locale, input.timezone,
        ]);

        // Essai gratuit : si la plateforme l'a désactivé, l'inscription aboutit quand même (le propriétaire choisira une formule)
        let trialStarted = false;
        await tx.query('SAVEPOINT trial');
        try {
          await tx.query('SELECT start_trial($1)', [input.planCode ?? null]);
          trialStarted = true;
        } catch (e) {
          if (fromDbError(e)?.code === 'trial_disabled') await tx.query('ROLLBACK TO SAVEPOINT trial');
          else throw e;
        }

        await tx.query('INSERT INTO users (id, email, full_name, password_hash) VALUES ($1, $2, $3, $4)', [
          userId, input.email, input.ownerName, passwordHash,
        ]);

        let ownerRoleId = '';
        for (const role of SYSTEM_ROLES) {
          const roleId = randomUUID();
          if (role.key === 'owner') ownerRoleId = roleId;
          await tx.query('INSERT INTO roles (id, hotel_id, key, name, description, is_system) VALUES ($1, $2, $3, $4, $5, true)', [
            roleId, hotelId, role.key, role.name, role.description,
          ]);
          await tx.query('INSERT INTO role_permissions (hotel_id, role_id, permission) SELECT $1, $2, unnest($3::text[])', [
            hotelId, roleId, [...role.permissions],
          ]);
        }
        await tx.query("INSERT INTO memberships (hotel_id, user_id, role_id, status, joined_at, job_title) VALUES ($1, $2, $3, 'active', now(), 'Propriétaire')", [
          hotelId, userId, ownerRoleId,
        ]);

        for (const [i, [code, label, kind]] of DEFAULT_PAYMENT_METHODS.entries()) {
          await tx.query('INSERT INTO payment_methods (hotel_id, code, label, kind, sort_order) VALUES ($1, $2, $3, $4, $5)', [hotelId, code, label, kind, i]);
        }

        await tx.query(
          "INSERT INTO audit_logs (hotel_id, actor_user_id, action, entity_type, entity_id, summary, ip, user_agent) VALUES ($1, $2, 'hotel.registered', 'hotel', $1, $3, $4, $5)",
          [hotelId, userId, `Inscription de « ${input.hotelName} »`, meta.ip, meta.userAgent],
        );

        const session = await createHotelSession(tx, { userId, hotelId, ip: meta.ip, userAgent: meta.userAgent, ttlHours: deps.config.SESSION_TTL_HOURS });
        return { ...session, trialStarted };
      });
      return { ...result, hotelId, userId, slug };
    } catch (error) {
      const e = error as { code?: string; constraint?: string };
      if (e.code === '23505' && e.constraint === 'users_email_key') throw new AppError('email_already_registered');
      if (e.code === '23505' && e.constraint === 'hotels_slug_key') continue; // nom déjà pris : on suffixe et on réessaie
      throw error;
    }
  }
  throw new AppError('slug_taken');
}
