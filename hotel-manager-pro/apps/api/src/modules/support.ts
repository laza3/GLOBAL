import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../errors';
import { auditHotel } from '../lib/audit';

export default async function supportRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  // L'assistance reste joignable même compte suspendu ou abonnement échu : c'est le canal pour résoudre la situation
  const read = app.hotelAuth({ permission: 'support:read', lapsedOk: true, blockedOk: true });
  const create = app.hotelAuth({ permission: 'support:create', lapsedOk: true, blockedOk: true });
  const tags = ['Assistance'];

  r.get('/support/tickets', { preValidation: read, schema: { tags, summary: 'Mes demandes d\'assistance' } }, async (req) => {
    const { rows } = await req.hotel!.tenant((tx) =>
      tx.query(
        `SELECT id, number, subject, category, priority, status, created_at AS "createdAt", updated_at AS "updatedAt", first_response_at AS "firstResponseAt"
         FROM support_tickets ORDER BY updated_at DESC`,
      ),
    );
    return { tickets: rows };
  });

  r.post('/support/tickets', {
    preValidation: create,
    schema: {
      tags,
      summary: 'Demander de l\'assistance',
      body: z.object({
        subject: z.string().trim().min(3).max(200),
        category: z.enum(['billing', 'technical', 'account', 'feature_request', 'other']).default('other'),
        priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
        message: z.string().trim().min(1).max(5000),
      }),
    },
  }, async (req, reply) => {
    const me = req.hotel!;
    const b = req.body;
    const ticket = await me.tenant(async (tx) => {
      const { rows } = await tx.query<{ id: string; number: string }>(
        'INSERT INTO support_tickets (hotel_id, subject, category, priority, created_by_user_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, number',
        [me.hotelId, b.subject, b.category, b.priority, me.userId],
      );
      await tx.query(
        "INSERT INTO support_messages (ticket_id, hotel_id, author_kind, author_user_id, body) VALUES ($1, $2, 'hotel_user', $3, $4)",
        [rows[0]!.id, me.hotelId, me.userId, b.message],
      );
      await auditHotel(tx, me, 'support.ticket_opened', { type: 'support_ticket', id: rows[0]!.id }, `Ticket ${rows[0]!.number} : ${b.subject}`, { ip: req.ip, requestId: req.id });
      return rows[0]!;
    });
    return reply.code(201).send({ ticket });
  });

  r.get('/support/tickets/:id', { preValidation: read, schema: { tags, summary: 'Une demande et ses messages (sans les notes internes)', params: z.object({ id: z.uuid() }) } }, async (req) => {
    return req.hotel!.tenant(async (tx) => {
      const { rows } = await tx.query(
        'SELECT id, number, subject, category, priority, status, created_at AS "createdAt", updated_at AS "updatedAt" FROM support_tickets WHERE id = $1',
        [req.params.id],
      );
      if (!rows[0]) throw new AppError('not_found');
      const { rows: messages } = await tx.query(
        `SELECT m.id, m.author_kind AS "authorKind", m.body, m.created_at AS "createdAt",
                CASE WHEN m.author_kind = 'hotel_user' THEN u.full_name WHEN m.author_kind = 'platform_admin' THEN 'Support Hotel Manager Pro' ELSE 'Système' END AS "authorName"
         FROM support_messages m LEFT JOIN users u ON u.id = m.author_user_id WHERE m.ticket_id = $1 ORDER BY m.created_at`,
        [req.params.id],
      );
      return { ticket: rows[0], messages };
    });
  });

  r.post('/support/tickets/:id/messages', {
    preValidation: create,
    schema: { tags, summary: 'Répondre sur une demande', params: z.object({ id: z.uuid() }), body: z.object({ body: z.string().trim().min(1).max(5000) }) },
  }, async (req, reply) => {
    const me = req.hotel!;
    await me.tenant(async (tx) => {
      const { rows } = await tx.query<{ status: string }>('SELECT status FROM support_tickets WHERE id = $1', [req.params.id]);
      if (!rows[0]) throw new AppError('not_found');
      if (rows[0].status === 'closed') throw new AppError('invalid_state');
      await tx.query(
        "INSERT INTO support_messages (ticket_id, hotel_id, author_kind, author_user_id, body) VALUES ($1, $2, 'hotel_user', $3, $4)",
        [req.params.id, me.hotelId, me.userId, req.body.body],
      );
    });
    return reply.code(201).send({ ok: true });
  });
}
