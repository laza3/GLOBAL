import { isDateString } from '@hmp/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../errors';
import { auditHotel } from '../lib/audit';
import { serialRows } from '../lib/query';
import { buildUpdate } from '../lib/sql';
import { ROOM_AFTER } from '../services/housekeeping';
import { expireTentatives, hotelClock } from '../services/reservations';

const date = z.string().refine(isDateString, 'Date invalide (format AAAA-MM-JJ).');
const PRIORITY = z.enum(['low', 'normal', 'high', 'urgent']);
const page = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) };

const TASK_SELECT = `SELECT t.id, t.room_id AS "roomId", ro.number AS "roomNumber", ro.floor, c.name AS "categoryName", t.task_type AS "taskType", t.status, t.priority,
         t.assigned_membership_id AS "assignedId", u.full_name AS "assignedName", t.due_at AS "dueAt", t.started_at AS "startedAt", t.completed_at AS "completedAt", t.notes, t.created_at AS "createdAt"
  FROM hk_tasks t
  JOIN rooms ro ON ro.id = t.room_id AND ro.hotel_id = t.hotel_id
  JOIN room_categories c ON c.id = ro.category_id AND c.hotel_id = ro.hotel_id
  LEFT JOIN memberships m ON m.id = t.assigned_membership_id AND m.hotel_id = t.hotel_id
  LEFT JOIN users u ON u.id = m.user_id`;

const MAINT_SELECT = `SELECT q.id, q.room_id AS "roomId", ro.number AS "roomNumber", q.title, q.description, q.priority, q.status, q.assigned_membership_id AS "assignedId", ua.full_name AS "assignedName",
         ur.full_name AS "reportedByName", q.allocation_id AS "allocationId", q.cost_amount AS "costAmount", q.reported_at AS "reportedAt", q.resolved_at AS "resolvedAt",
         to_char(a.starts_on, 'YYYY-MM-DD') AS "blockStartsOn", to_char(a.ends_on, 'YYYY-MM-DD') AS "blockEndsOn"
  FROM maintenance_requests q
  LEFT JOIN rooms ro ON ro.id = q.room_id AND ro.hotel_id = q.hotel_id
  LEFT JOIN memberships ma ON ma.id = q.assigned_membership_id AND ma.hotel_id = q.hotel_id LEFT JOIN users ua ON ua.id = ma.user_id
  LEFT JOIN memberships mr ON mr.id = q.reported_by_membership_id AND mr.hotel_id = q.hotel_id LEFT JOIN users ur ON ur.id = mr.user_id
  LEFT JOIN room_allocations a ON a.id = q.allocation_id AND a.hotel_id = q.hotel_id`;

export default async function housekeepingRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const feature = 'housekeeping';
  const read = app.hotelAuth({ permission: 'housekeeping:read', feature });
  const manage = app.hotelAuth({ permission: 'housekeeping:manage', feature });
  const work = app.hotelAuth({ permission: 'housekeeping:update_task', feature });
  const tags = ['Housekeeping'];

  /* ------------------------------------------------------------------ Tableau des chambres */
  r.get('/housekeeping/board', {
    preValidation: read,
    schema: { tags, summary: 'Chambres avec leur état de ménage, leur tâche ouverte et ce qui les attend aujourd\'hui', querystring: z.object({ mine: z.enum(['true']).optional() }) },
  }, async (req) => {
    const me = req.hotel!;
    return me.tenant(async (tx) => {
      const clock = await hotelClock(tx, app.deps.now());
      await expireTentatives(tx);
      const { rows } = await tx.query(
        `SELECT s.room_id AS id, s.number, s.name, s.floor, s.category_id AS "categoryId", c.name AS "categoryName", s.housekeeping_status AS "housekeepingStatus", s.display_status AS "displayStatus",
                t.id AS "taskId", t.status AS "taskStatus", t.priority AS "taskPriority", t.task_type AS "taskType", t.assigned_membership_id AS "assignedId", u.full_name AS "assignedName",
                EXISTS (SELECT 1 FROM reservation_rooms rr WHERE rr.hotel_id = s.hotel_id AND rr.room_id = s.room_id AND rr.status IN ('pending', 'confirmed') AND rr.check_in = $1::date) AS "arrivesToday",
                EXISTS (SELECT 1 FROM reservation_rooms rr WHERE rr.hotel_id = s.hotel_id AND rr.room_id = s.room_id AND rr.status = 'checked_in' AND rr.check_out = $1::date) AS "departsToday",
                (SELECT count(*)::int FROM maintenance_requests q WHERE q.hotel_id = s.hotel_id AND q.room_id = s.room_id AND q.status IN ('open', 'in_progress')) AS "openIssues"
         FROM room_status_today s
         JOIN room_categories c ON c.id = s.category_id AND c.hotel_id = s.hotel_id
         LEFT JOIN LATERAL (SELECT * FROM hk_tasks x WHERE x.hotel_id = s.hotel_id AND x.room_id = s.room_id AND x.status IN ('to_clean', 'in_progress', 'cleaned') ORDER BY CASE x.status WHEN 'in_progress' THEN 0 WHEN 'to_clean' THEN 1 ELSE 2 END, x.created_at LIMIT 1) t ON true
         LEFT JOIN memberships m ON m.id = t.assigned_membership_id AND m.hotel_id = s.hotel_id LEFT JOIN users u ON u.id = m.user_id
         WHERE ($2::boolean IS NOT TRUE OR t.assigned_membership_id = $3)
         ORDER BY s.floor NULLS LAST, length(s.number), s.number`,
        [clock.today, req.query.mine === 'true', me.membershipId],
      );
      const counts = { dirty: 0, cleaning: 0, clean: 0, inspected: 0 } as Record<string, number>;
      for (const x of rows as any[]) counts[x.housekeepingStatus] = (counts[x.housekeepingStatus] ?? 0) + 1;
      return { today: clock.today, rooms: rows, counts };
    });
  });

  r.post('/housekeeping/rooms/:id/status', {
    preValidation: manage,
    schema: { tags, summary: 'Forcer l\'état de ménage d\'une chambre (sans tâche) — tracé', params: z.object({ id: z.uuid() }), body: z.object({ status: z.enum(['dirty', 'clean', 'inspected']) }) },
  }, async (req) => {
    const me = req.hotel!;
    await me.tenant(async (tx) => {
      const res = await tx.query<{ number: string }>('UPDATE rooms SET housekeeping_status = $2 WHERE id = $1 AND NOT is_archived RETURNING number', [req.params.id, req.body.status]);
      if (!res.rowCount) throw new AppError('not_found');
      // Une chambre déclarée propre clôt ses tâches de ménage ouvertes
      if (req.body.status !== 'dirty') await tx.query("UPDATE hk_tasks SET status = $2, completed_at = COALESCE(completed_at, now()) WHERE room_id = $1 AND status IN ('to_clean', 'in_progress')", [req.params.id, req.body.status === 'inspected' ? 'inspected' : 'cleaned']);
      await auditHotel(tx, me, 'housekeeping.room_status_set', { type: 'room', id: req.params.id }, `Chambre ${res.rows[0]!.number} : ménage « ${req.body.status} »`, { ip: req.ip, requestId: req.id });
    });
    return { updated: true };
  });

  /* ------------------------------------------------------------------ Tâches */
  r.get('/housekeeping/tasks', {
    preValidation: read,
    schema: { tags, summary: 'Tâches de ménage', querystring: z.object({ status: z.enum(['open', 'to_clean', 'in_progress', 'cleaned', 'inspected', 'maintenance']).optional(), mine: z.enum(['true']).optional(), roomId: z.uuid().optional(), ...page }) },
  }, async (req) => {
    const me = req.hotel!;
    const { status, mine, roomId, page: pg, pageSize } = req.query;
    return me.tenant(async (tx) => {
      const where = `($1::text IS NULL OR ($1 = 'open' AND t.status IN ('to_clean', 'in_progress', 'cleaned')) OR t.status = $1) AND ($2::boolean IS NOT TRUE OR t.assigned_membership_id = $3) AND ($4::uuid IS NULL OR t.room_id = $4)`;
      const args = [status ?? null, mine === 'true', me.membershipId, roomId ?? null];
      const { rows: total } = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM hk_tasks t WHERE ${where}`, args);
      const { rows } = await tx.query(
        `${TASK_SELECT} WHERE ${where}
         ORDER BY CASE t.status WHEN 'in_progress' THEN 0 WHEN 'to_clean' THEN 1 WHEN 'cleaned' THEN 2 ELSE 3 END, CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.created_at DESC, t.id
         LIMIT $5 OFFSET $6`,
        [...args, pageSize, (pg - 1) * pageSize],
      );
      return { items: rows, total: total[0]!.n, page: pg, pageSize };
    });
  });

  r.get('/housekeeping/staff', { preValidation: read, schema: { tags, summary: 'Membres du personnel à qui confier une tâche de ménage' } }, async (req) => {
    const { rows } = await req.hotel!.tenant((tx) =>
      tx.query(
        `SELECT m.id, u.full_name AS name, ro.name AS role FROM memberships m JOIN users u ON u.id = m.user_id JOIN roles ro ON ro.id = m.role_id AND ro.hotel_id = m.hotel_id
         WHERE m.status = 'active' AND EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = m.role_id AND p.permission = 'housekeeping:update_task') ORDER BY u.full_name`,
      ),
    );
    return { staff: rows };
  });

  r.post('/housekeeping/tasks', {
    preValidation: manage,
    schema: {
      tags,
      summary: 'Créer une tâche (ménage de départ, de recouche, à fond, inspection)',
      body: z.object({ roomId: z.uuid(), taskType: z.enum(['checkout_clean', 'stayover_clean', 'deep_clean', 'inspection']), priority: PRIORITY.default('normal'), assignedId: z.uuid().nullish(), dueAt: z.iso.datetime().nullish(), notes: z.string().trim().max(500).nullish() }),
    },
  }, async (req, reply) => {
    const me = req.hotel!;
    const b = req.body;
    const id = await me.tenant(async (tx) => {
      const room = await tx.query('SELECT 1 FROM rooms WHERE id = $1 AND NOT is_archived', [b.roomId]);
      if (!room.rowCount) throw new AppError('not_found');
      if (b.assignedId) await assertStaff(tx, b.assignedId);
      const { rows } = await tx.query<{ id: string }>(
        "INSERT INTO hk_tasks (hotel_id, room_id, task_type, status, priority, assigned_membership_id, due_at, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
        [me.hotelId, b.roomId, b.taskType, b.taskType === 'inspection' ? 'cleaned' : 'to_clean', b.priority, b.assignedId ?? null, b.dueAt ?? null, b.notes ?? null],
      );
      await auditHotel(tx, me, 'housekeeping.task_created', { type: 'hk_task', id: rows[0]!.id }, `Tâche de ménage créée (${b.taskType})`, { after: b, ip: req.ip, requestId: req.id });
      return rows[0]!.id;
    });
    return reply.code(201).send({ id });
  });

  const assertStaff = async (tx: import('../db').Tx, membershipId: string) => {
    const { rowCount } = await tx.query(
      "SELECT 1 FROM memberships m WHERE m.id = $1 AND m.status = 'active' AND EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = m.role_id AND p.permission = 'housekeeping:update_task')",
      [membershipId],
    );
    if (!rowCount) throw new AppError('validation_error', [{ path: 'assignedId', message: "Cette personne ne peut pas recevoir de tâche de ménage." }]);
  };

  const params = z.object({ id: z.uuid() });
  /** Étape d'une tâche : transition contrôlée, état de la chambre mis à jour dans la même transaction. */
  const step = (path: string, summary: string, perm: typeof work, from: string[], to: string, action: 'start' | 'complete' | 'inspect', label: string) =>
    r.post(`/housekeeping/tasks/:id/${path}`, { preValidation: perm, schema: { tags, summary, params } }, async (req) => {
      const me = req.hotel!;
      await me.tenant(async (tx) => {
        const { rows } = await tx.query<{ status: string; room_id: string; task_type: string; assigned: string | null; number: string }>(
          'SELECT t.status, t.room_id, t.task_type, t.assigned_membership_id AS assigned, ro.number FROM hk_tasks t JOIN rooms ro ON ro.id = t.room_id AND ro.hotel_id = t.hotel_id WHERE t.id = $1 FOR UPDATE OF t',
          [req.params.id],
        );
        const t = rows[0];
        if (!t) throw new AppError('not_found');
        if (!from.includes(t.status)) throw new AppError('hk_task_invalid_state');
        // Un employé ne traite que SES tâches (ou les tâches libres, qu'il s'attribue) ; un responsable peut tout faire
        const isManager = me.permissions.includes('housekeeping:manage');
        if (!isManager && t.assigned && t.assigned !== me.membershipId) throw new AppError('forbidden');
        const sets = ['status = $2'];
        const args: unknown[] = [req.params.id, to];
        if (action === 'start') { sets.push('started_at = COALESCE(started_at, now())'); if (!t.assigned) { args.push(me.membershipId); sets.push(`assigned_membership_id = $${args.length}`); } }
        if (action === 'complete') sets.push('completed_at = now()');
        if (action === 'inspect') { args.push(me.membershipId); sets.push(`inspected_by_membership_id = $${args.length}`); }
        await tx.query(`UPDATE hk_tasks SET ${sets.join(', ')} WHERE id = $1`, args);
        // Une inspection seule (tâche « inspection ») ne change pas la propreté de la chambre en dessous de « propre »
        const roomStatus = t.task_type === 'inspection' && action === 'complete' ? 'inspected' : ROOM_AFTER[action];
        await tx.query('UPDATE rooms SET housekeeping_status = $2 WHERE id = $1', [t.room_id, roomStatus]);
        await auditHotel(tx, me, `housekeeping.task_${action}`, { type: 'hk_task', id: req.params.id }, `Chambre ${t.number} : ${label}`, { ip: req.ip, requestId: req.id });
      });
      return { updated: true };
    });
  step('start', 'Commencer le ménage (la chambre passe « en nettoyage »)', work, ['to_clean'], 'in_progress', 'start', 'ménage commencé');
  step('complete', 'Terminer le ménage (la chambre passe « propre »)', work, ['in_progress', 'to_clean'], 'cleaned', 'complete', 'ménage terminé');
  step('inspect', 'Contrôler la chambre (elle passe « contrôlée »)', manage, ['cleaned'], 'inspected', 'inspect', 'chambre contrôlée');

  r.post('/housekeeping/tasks/:id/assign', {
    preValidation: manage,
    schema: { tags, summary: 'Confier une tâche à quelqu\'un (ou la libérer)', params, body: z.object({ assignedId: z.uuid().nullable() }) },
  }, async (req) => {
    const me = req.hotel!;
    await me.tenant(async (tx) => {
      if (req.body.assignedId) await assertStaff(tx, req.body.assignedId);
      const res = await tx.query("UPDATE hk_tasks SET assigned_membership_id = $2 WHERE id = $1 AND status IN ('to_clean', 'in_progress')", [req.params.id, req.body.assignedId]);
      if (!res.rowCount) throw new AppError('hk_task_invalid_state');
      await auditHotel(tx, me, 'housekeeping.task_assigned', { type: 'hk_task', id: req.params.id }, 'Tâche de ménage attribuée', { after: req.body, ip: req.ip, requestId: req.id });
    });
    return { updated: true };
  });

  r.post('/housekeeping/tasks/:id/report-issue', {
    preValidation: work,
    schema: { tags, summary: 'Signaler un problème trouvé pendant le ménage : crée une demande de maintenance liée à la chambre', params, body: z.object({ title: z.string().trim().min(3).max(120), description: z.string().trim().max(1000).nullish(), priority: PRIORITY.default('normal') }) },
  }, async (req, reply) => {
    const me = req.hotel!;
    const b = req.body;
    const id = await me.tenant(async (tx) => {
      const { rows } = await tx.query<{ room_id: string; number: string }>('SELECT t.room_id, ro.number FROM hk_tasks t JOIN rooms ro ON ro.id = t.room_id AND ro.hotel_id = t.hotel_id WHERE t.id = $1', [req.params.id]);
      if (!rows[0]) throw new AppError('not_found');
      const ins = await tx.query<{ id: string }>(
        'INSERT INTO maintenance_requests (hotel_id, room_id, title, description, priority, reported_by_membership_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [me.hotelId, rows[0].room_id, b.title, b.description ?? null, b.priority, me.membershipId],
      );
      await auditHotel(tx, me, 'maintenance.reported', { type: 'maintenance', id: ins.rows[0]!.id }, `Chambre ${rows[0].number} : ${b.title}`, { after: b, ip: req.ip, requestId: req.id });
      return ins.rows[0]!.id;
    });
    return reply.code(201).send({ id });
  });

  /* ------------------------------------------------------------------ Maintenance */
  r.get('/maintenance', {
    preValidation: read,
    schema: { tags: ['Maintenance'], summary: 'Demandes de maintenance', querystring: z.object({ status: z.enum(['active', 'open', 'in_progress', 'resolved', 'cancelled']).optional(), roomId: z.uuid().optional(), ...page }) },
  }, async (req) => {
    const { status, roomId, page: pg, pageSize } = req.query;
    return req.hotel!.tenant(async (tx) => {
      const where = `($1::text IS NULL OR ($1 = 'active' AND q.status IN ('open', 'in_progress')) OR q.status = $1) AND ($2::uuid IS NULL OR q.room_id = $2)`;
      const args = [status ?? null, roomId ?? null];
      const { rows: total } = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM maintenance_requests q WHERE ${where}`, args);
      const { rows } = await tx.query(
        `${MAINT_SELECT} WHERE ${where} ORDER BY CASE WHEN q.status IN ('open', 'in_progress') THEN 0 ELSE 1 END, CASE q.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, q.reported_at DESC, q.id LIMIT $3 OFFSET $4`,
        [...args, pageSize, (pg - 1) * pageSize],
      );
      return { items: rows, total: total[0]!.n, page: pg, pageSize };
    });
  });

  r.post('/maintenance', {
    preValidation: work,
    schema: {
      tags: ['Maintenance'],
      summary: 'Signaler une panne ou un travail ; peut bloquer la chambre à la vente jusqu\'à la fin des travaux',
      body: z.object({
        roomId: z.uuid().nullish(), title: z.string().trim().min(3).max(120), description: z.string().trim().max(1000).nullish(), priority: PRIORITY.default('normal'),
        block: z.object({ startsOn: date, endsOn: date.nullable() }).nullish(),
      }).refine((b) => !b.block || b.roomId, { message: 'Choisissez la chambre à bloquer.', path: ['roomId'] })
        .refine((b) => !b.block || b.block.endsOn === null || b.block.endsOn > b.block.startsOn, { message: 'La fin doit être après le début.', path: ['block', 'endsOn'] }),
    },
  }, async (req, reply) => {
    const me = req.hotel!;
    const b = req.body;
    const id = await me.tenant(async (tx) => {
      let allocationId: string | null = null;
      if (b.roomId) {
        const room = await tx.query('SELECT 1 FROM rooms WHERE id = $1 AND NOT is_archived', [b.roomId]);
        if (!room.rowCount) throw new AppError('not_found');
      }
      if (b.block && b.roomId) {
        await expireTentatives(tx);
        // Le chevauchement avec un séjour est refusé par la base (409 room_not_available)
        const a = await tx.query<{ id: string }>(
          "INSERT INTO room_allocations (hotel_id, room_id, kind, starts_on, ends_on, block_reason, notes, created_by_membership_id) VALUES ($1, $2, 'block', $3, $4, 'maintenance', $5, $6) RETURNING id",
          [me.hotelId, b.roomId, b.block.startsOn, b.block.endsOn, b.title, me.membershipId],
        );
        allocationId = a.rows[0]!.id;
      }
      const { rows } = await tx.query<{ id: string }>(
        'INSERT INTO maintenance_requests (hotel_id, room_id, title, description, priority, reported_by_membership_id, allocation_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [me.hotelId, b.roomId ?? null, b.title, b.description ?? null, b.priority, me.membershipId, allocationId],
      );
      await auditHotel(tx, me, 'maintenance.reported', { type: 'maintenance', id: rows[0]!.id }, `Maintenance : ${b.title}${allocationId ? ' (chambre bloquée)' : ''}`, { after: b, ip: req.ip, requestId: req.id });
      return rows[0]!.id;
    });
    return reply.code(201).send({ id });
  });

  r.patch('/maintenance/:id', {
    preValidation: manage,
    schema: {
      tags: ['Maintenance'],
      summary: 'Faire avancer une demande : prise en charge, résolution (le blocage de la chambre est levé), annulation, coût',
      params,
      body: z.object({ status: z.enum(['in_progress', 'resolved', 'cancelled']), assignedId: z.uuid().nullable(), priority: PRIORITY, costAmount: z.number().int().min(0).max(1_000_000_000_000).nullable(), title: z.string().trim().min(3).max(120) }).partial(),
    },
  }, async (req) => {
    const me = req.hotel!;
    const b = req.body;
    if (Object.keys(b).length === 0) throw new AppError('validation_error', [{ path: '', message: 'Aucune modification fournie.' }]);
    await me.tenant(async (tx) => {
      const { rows } = await tx.query<{ status: string; allocation_id: string | null; title: string }>('SELECT status, allocation_id, title FROM maintenance_requests WHERE id = $1 FOR UPDATE', [req.params.id]);
      const cur = rows[0];
      if (!cur) throw new AppError('not_found');
      if (['resolved', 'cancelled'].includes(cur.status)) throw new AppError('maintenance_invalid_state');
      if (b.assignedId) await assertStaff(tx, b.assignedId).catch(() => { throw new AppError('validation_error', [{ path: 'assignedId', message: 'Cette personne ne peut pas recevoir de demande.' }]); });
      // La date de résolution est posée AVANT le statut : la base exige les deux ensemble
      if (b.status === 'resolved') await tx.query('UPDATE maintenance_requests SET resolved_at = now() WHERE id = $1', [req.params.id]);
      const u = buildUpdate('maintenance_requests', { status: 'status', assignedId: 'assigned_membership_id', priority: 'priority', costAmount: 'cost_amount', title: 'title' }, b, { column: 'id', value: req.params.id });
      await tx.query(u.sql, u.args);
      // La chambre redevient vendable : le blocage lié est levé
      if ((b.status === 'resolved' || b.status === 'cancelled') && cur.allocation_id) await tx.query("DELETE FROM room_allocations WHERE id = $1 AND kind = 'block'", [cur.allocation_id]);
      await auditHotel(tx, me, 'maintenance.updated', { type: 'maintenance', id: req.params.id }, `Maintenance « ${cur.title} » : ${u.keys.join(', ')}`, { after: b, ip: req.ip, requestId: req.id });
    });
    return { updated: true };
  });
}
