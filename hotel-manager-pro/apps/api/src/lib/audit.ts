import type { Tx } from '../db';
import type { HotelContext } from '../types';

/** Journal d'audit de l'établissement (ajout seul), écrit DANS la transaction de l'action qu'il trace. */
export async function auditHotel(
  tx: Tx,
  me: Pick<HotelContext, 'hotelId' | 'userId' | 'membershipId'>,
  action: string,
  entity: { type: string; id?: string | null },
  summary: string,
  meta: { ip?: string | null; before?: unknown; after?: unknown; requestId?: string } = {},
): Promise<void> {
  await tx.query(
    `INSERT INTO audit_logs (hotel_id, actor_user_id, actor_membership_id, action, entity_type, entity_id, summary, before_data, after_data, ip, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      me.hotelId, me.userId, me.membershipId, action, entity.type, entity.id ?? null, summary,
      meta.before === undefined ? null : JSON.stringify(meta.before), meta.after === undefined ? null : JSON.stringify(meta.after),
      meta.ip ?? null, meta.requestId ?? null,
    ],
  );
}

/** Journal d'audit de la plateforme (actions de la console : suspension, validation de paiement, changement de tarif…). */
export async function auditPlatform(
  tx: Tx,
  adminId: string,
  action: string,
  target: { type: string; id?: string | null; hotelId?: string | null },
  details: Record<string, unknown> = {},
  ip?: string | null,
): Promise<void> {
  await tx.query(
    'INSERT INTO platform_audit_logs (admin_id, action, target_type, target_id, hotel_id, details, ip) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [adminId, action, target.type, target.id ?? null, target.hotelId ?? null, JSON.stringify(details), ip ?? null],
  );
}
