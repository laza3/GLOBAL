import { computeAccessState } from '@hmp/shared';
import { anonTx, tenantTx, type Tx } from '../db';
import { newSessionToken, sha256 } from '../lib/security';
import type { AppDeps, Entitlements, HotelContext } from '../types';

interface SessionRow {
  session_id: string;
  user_id: string;
  user_email: string;
  full_name: string;
  hotel_id: string;
  hotel_name: string;
  hotel_status: string;
  membership_id: string;
  role_key: string;
  role_name: string;
  permissions: string[];
}

/** Crée une session (le jeton clair n'existe que dans la réponse ; la base ne garde que son empreinte). */
export async function createHotelSession(
  tx: Tx,
  input: { userId: string; hotelId: string; ip: string | null; userAgent: string | null; ttlHours: number },
): Promise<{ token: string; tokenHash: string }> {
  const token = newSessionToken();
  const tokenHash = sha256(token);
  await tx.query('SELECT auth_create_session($1, $2, $3, $4, $5, make_interval(hours => $6))', [
    input.userId,
    input.hotelId,
    tokenHash,
    input.ip,
    input.userAgent,
    input.ttlHours,
  ]);
  return { token, tokenHash };
}

/** Identité + permissions + droits d'usage + état d'accès, pour un jeton déjà haché. Null si la session n'est plus valide. */
export async function resolveHotelContext(deps: AppDeps, tokenHash: string): Promise<HotelContext | null> {
  const { db, settings, now } = deps;
  const { rows } = await anonTx(db, (tx) => tx.query<SessionRow>('SELECT * FROM auth_resolve_session($1)', [tokenHash]));
  const s = rows[0];
  if (!s) return null;

  const tenant: HotelContext['tenant'] = (fn) => tenantTx(db, { hotelId: s.hotel_id, userId: s.user_id }, fn);
  const { rows: ents } = await tenant((tx) => tx.query<Entitlements>('SELECT * FROM hotel_entitlements WHERE hotel_id = $1', [s.hotel_id]));
  const raw = ents[0]!;
  const clock = now();
  // L'horloge de l'application fait foi (la vue SQL utilise celle de la base) : une seule source de vérité pour l'état d'accès
  const entitlements: Entitlements = {
    ...raw,
    is_current: raw.source === 'license' ? true : raw.source === 'subscription' ? raw.valid_until !== null && raw.valid_until > clock : false,
    license_support_active: raw.source === 'license' ? raw.license_maintenance_until === null || raw.license_maintenance_until > clock : null,
  };
  const graceDays = await settings.number('billing.grace_days', 7);
  const access = computeAccessState({ hotelStatus: s.hotel_status, entitlements, now: clock, graceDays });

  return {
    sessionTokenHash: tokenHash,
    userId: s.user_id,
    email: s.user_email,
    fullName: s.full_name,
    hotelId: s.hotel_id,
    hotelName: s.hotel_name,
    hotelStatus: s.hotel_status,
    membershipId: s.membership_id,
    roleKey: s.role_key,
    roleName: s.role_name,
    permissions: s.permissions,
    access,
    entitlements,
    tenant,
  };
}

/** Charge utile de GET /me : ce dont l'interface a besoin pour s'afficher et masquer les actions interdites. */
export function toMe(ctx: HotelContext) {
  const e = ctx.entitlements;
  return {
    user: { id: ctx.userId, email: ctx.email, fullName: ctx.fullName },
    hotel: { id: ctx.hotelId, name: ctx.hotelName, status: ctx.hotelStatus },
    role: { key: ctx.roleKey, name: ctx.roleName },
    permissions: ctx.permissions,
    access: { state: ctx.access.state, reason: ctx.access.reason, graceEndsAt: ctx.access.graceEndsAt },
    entitlements: {
      source: e.source,
      planCode: e.plan_code,
      maxRooms: e.max_rooms,
      maxUsers: e.max_users,
      features: e.features,
      isPerpetual: e.is_perpetual,
      validUntil: e.valid_until,
      isCurrent: e.is_current,
      subscriptionStatus: e.subscription_status,
      supportActive: e.license_support_active,
    },
  };
}
