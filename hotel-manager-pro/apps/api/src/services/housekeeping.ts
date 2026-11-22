import type { Tx } from '../db';

export type RoomHk = 'dirty' | 'cleaning' | 'clean' | 'inspected';

/** Une tâche de ménage ouverte par chambre : pas de doublon quand un départ et un changement de chambre se suivent. */
export async function ensureCleaningTask(tx: Tx, hotelId: string, roomId: string, today: string, type: 'checkout_clean' | 'stayover_clean' | 'deep_clean' = 'checkout_clean'): Promise<string | null> {
  const open = await tx.query("SELECT id FROM hk_tasks WHERE room_id = $1 AND status IN ('to_clean', 'in_progress') AND task_type <> 'inspection' LIMIT 1", [roomId]);
  if (open.rowCount) return open.rows[0].id as string;
  // Prioritaire quand une arrivée est prévue aujourd'hui dans cette chambre
  const arriving = await tx.query("SELECT 1 FROM reservation_rooms WHERE room_id = $1 AND status IN ('pending', 'confirmed') AND check_in = $2::date LIMIT 1", [roomId, today]);
  const { rows } = await tx.query<{ id: string }>(
    "INSERT INTO hk_tasks (hotel_id, room_id, task_type, status, priority) VALUES ($1, $2, $3, 'to_clean', $4) RETURNING id",
    [hotelId, roomId, type, arriving.rowCount ? 'high' : 'normal'],
  );
  return rows[0]!.id;
}

/** État de ménage de la chambre après une étape de tâche (une seule source de vérité : la tâche pilote la chambre). */
export const ROOM_AFTER: Record<'start' | 'complete' | 'inspect', RoomHk> = { start: 'cleaning', complete: 'clean', inspect: 'inspected' };
