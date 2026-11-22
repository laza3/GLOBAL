import { PERMISSIONS, hasPermission, type Permission } from '@hmp/shared';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../db';
import { AppError } from '../errors';
import { auditHotel } from '../lib/audit';
import { hashPassword } from '../lib/security';
import { withUnique } from '../lib/sql';

const id = z.object({ id: z.uuid() });

/** Mot de passe provisoire lisible : sans caractères ambigus (0/O, 1/l/I), 14 caractères, tiré d'une source cryptographique. */
function temporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(14);
  const raw = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  return `${raw.slice(0, 4)}-${raw.slice(4, 9)}-${raw.slice(9)}`;
}

async function rolePermissions(tx: Tx, roleId: string): Promise<string[]> {
  const { rows } = await tx.query<{ permission: string }>('SELECT permission FROM role_permissions WHERE role_id = $1', [roleId]);
  return rows.map((r) => r.permission);
}

/** Anti-escalade : on ne donne pas ce qu'on n'a pas, et on ne touche pas un compte plus puissant que le sien. */
const assertCovers = (mine: readonly string[], wanted: readonly string[]) => {
  if (wanted.some((p) => !hasPermission(mine, p as Permission))) throw new AppError('privilege_escalation');
};

export default async function staffRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const read = app.hotelAuth({ permission: 'staff:read' });
  const manage = app.hotelAuth({ permission: 'staff:manage' });
  const customRoles = app.hotelAuth({ permission: 'staff:manage', feature: 'staff_permissions' });
  const tags = ['Personnel'];

  r.get('/staff', { preValidation: read, schema: { tags, summary: 'Personnel de l\'établissement : rôle, état, dernière connexion' } }, async (req) => {
    const { rows } = await req.hotel!.tenant((tx) =>
      tx.query(
        `SELECT m.id, u.id AS "userId", u.full_name AS "fullName", u.email, m.job_title AS "jobTitle", m.status, r.id AS "roleId", r.key AS "roleKey", r.name AS "roleName",
                u.last_login_at AS "lastLoginAt", u.must_change_password AS "mustChangePassword", m.created_at AS "createdAt"
         FROM memberships m JOIN users u ON u.id = m.user_id JOIN roles r ON r.id = m.role_id AND r.hotel_id = m.hotel_id
         ORDER BY m.status, u.full_name`,
      ),
    );
    return { staff: rows };
  });

  r.get('/staff/roles', { preValidation: read, schema: { tags, summary: 'Rôles (prédéfinis et personnalisés) avec leurs permissions et leur nombre de membres' } }, async (req) => {
    const { rows } = await req.hotel!.tenant((tx) =>
      tx.query(
        `SELECT r.id, r.key, r.name, r.description, r.is_system AS "isSystem",
                COALESCE((SELECT array_agg(p.permission ORDER BY p.permission) FROM role_permissions p WHERE p.role_id = r.id), '{}') AS permissions,
                (SELECT count(*)::int FROM memberships m WHERE m.role_id = r.id AND m.status <> 'disabled') AS members
         FROM roles r ORDER BY r.is_system DESC, r.name`,
      ),
    );
    return { roles: rows };
  });

  r.post('/staff', {
    preValidation: manage,
    schema: {
      tags,
      summary: 'Créer le compte d\'un employé : un mot de passe PROVISOIRE est renvoyé une seule fois',
      description: "Aucun e-mail n'est envoyé (pas de fournisseur configuré) : remettez le mot de passe à l'employé en main propre. Il lui est demandé de le changer. Un e-mail déjà utilisé par un autre compte est refusé.",
      body: z.object({ fullName: z.string().trim().min(2).max(120), email: z.email().max(254), roleId: z.uuid(), jobTitle: z.string().trim().max(80).nullish() }),
    },
  }, async (req, reply) => {
    const me = req.hotel!;
    const b = req.body;
    const password = temporaryPassword();
    const hash = await hashPassword(password);
    const created = await me.tenant((tx) =>
      withUnique({ users_email_key: 'email_already_registered' }, async () => {
        assertCovers(me.permissions, await rolePermissions(tx, b.roleId));
        const { rows } = await tx.query<{ id: string }>('SELECT staff_create_user($1, $2, $3, $4, $5) AS id', [b.email, b.fullName, hash, b.roleId, b.jobTitle ?? null]);
        const { rows: m } = await tx.query<{ id: string }>('SELECT id FROM memberships WHERE user_id = $1', [rows[0]!.id]);
        await auditHotel(tx, me, 'staff.created', { type: 'membership', id: m[0]!.id }, `Compte créé : ${b.fullName} (${b.email})`, { after: { roleId: b.roleId }, ip: req.ip, requestId: req.id });
        return { membershipId: m[0]!.id, userId: rows[0]!.id };
      }),
    );
    return reply.code(201).header('cache-control', 'no-store').send({ ...created, email: b.email, temporaryPassword: password });
  });

  /** Membre ciblé + garde-fous communs : pas soi-même, pas plus puissant que soi. */
  const loadTarget = async (tx: Tx, me: { permissions: string[]; membershipId: string }, membershipId: string) => {
    const { rows } = await tx.query<{ id: string; user_id: string; role_id: string; status: string; role_key: string; full_name: string }>(
      'SELECT m.id, m.user_id, m.role_id, m.status, r.key AS role_key, u.full_name FROM memberships m JOIN roles r ON r.id = m.role_id AND r.hotel_id = m.hotel_id JOIN users u ON u.id = m.user_id WHERE m.id = $1 FOR UPDATE OF m',
      [membershipId],
    );
    const t = rows[0];
    if (!t) throw new AppError('member_not_found');
    assertCovers(me.permissions, await rolePermissions(tx, t.role_id));
    return t;
  };
  const activeOwnersExcluding = async (tx: Tx, membershipId: string) =>
    (await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM memberships m JOIN roles r ON r.id = m.role_id AND r.hotel_id = m.hotel_id WHERE r.key = 'owner' AND m.status = 'active' AND m.id <> $1", [membershipId])).rows[0]!.n;

  r.patch('/staff/:id', {
    preValidation: manage,
    schema: { tags, summary: 'Changer le rôle, la fonction ou l\'état (actif / désactivé) d\'un membre', params: id, body: z.object({ roleId: z.uuid(), status: z.enum(['active', 'disabled']), jobTitle: z.string().trim().max(80).nullable() }).partial() },
  }, async (req) => {
    const me = req.hotel!;
    const b = req.body;
    if (Object.keys(b).length === 0) throw new AppError('validation_error', [{ path: '', message: 'Aucune modification fournie.' }]);
    await me.tenant(async (tx) => {
      const t = await loadTarget(tx, me, req.params.id);
      const self = t.id === me.membershipId;
      if (self && (b.roleId !== undefined || b.status !== undefined)) throw new AppError('cannot_modify_self');
      if (b.roleId !== undefined) {
        const perms = await rolePermissions(tx, b.roleId);
        const exists = await tx.query('SELECT 1 FROM roles WHERE id = $1', [b.roleId]);
        if (!exists.rowCount) throw new AppError('role_not_found');
        assertCovers(me.permissions, perms);
      }
      const demotes = (b.roleId !== undefined && b.roleId !== t.role_id) || b.status === 'disabled';
      if (t.role_key === 'owner' && t.status === 'active' && demotes && (await activeOwnersExcluding(tx, t.id)) === 0) throw new AppError('last_owner');
      const sets: string[] = [];
      const args: unknown[] = [req.params.id];
      const set = (col: string, v: unknown) => { args.push(v); sets.push(`${col} = $${args.length}`); };
      if (b.roleId !== undefined) set('role_id', b.roleId);
      if (b.status !== undefined) set('status', b.status);
      if (b.jobTitle !== undefined) set('job_title', b.jobTitle);
      await tx.query(`UPDATE memberships SET ${sets.join(', ')} WHERE id = $1`, args);
      // Un compte désactivé perd ses sessions immédiatement
      if (b.status === 'disabled') await tx.query('SELECT auth_revoke_user_sessions($1, NULL)', [t.user_id]);
      await auditHotel(tx, me, 'staff.updated', { type: 'membership', id: req.params.id }, `${t.full_name} : ${Object.keys(b).join(', ')}`, { after: b, ip: req.ip, requestId: req.id });
    });
    return { updated: true };
  });

  r.post('/staff/:id/reset-password', {
    preValidation: manage,
    schema: { tags, summary: 'Réinitialiser le mot de passe d\'un employé : nouveau mot de passe PROVISOIRE affiché une seule fois, ses sessions sont fermées', params: id },
  }, async (req, reply) => {
    const me = req.hotel!;
    const password = temporaryPassword();
    const hash = await hashPassword(password);
    await me.tenant(async (tx) => {
      const t = await loadTarget(tx, me, req.params.id);
      if (t.id === me.membershipId) throw new AppError('cannot_modify_self');
      await tx.query('SELECT staff_set_temp_password($1, $2)', [t.user_id, hash]);
      await auditHotel(tx, me, 'staff.password_reset', { type: 'membership', id: req.params.id }, `Mot de passe réinitialisé : ${t.full_name}`, { ip: req.ip, requestId: req.id });
    });
    return reply.header('cache-control', 'no-store').send({ temporaryPassword: password });
  });

  /* ------------------------------------------------------------------ Rôles personnalisés */
  const roleBody = z.object({ name: z.string().trim().min(2).max(60), description: z.string().trim().max(200).nullable(), permissions: z.array(z.enum(PERMISSIONS)).min(1).max(PERMISSIONS.length) });
  const slug = (name: string) => `custom_${name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30)}`;
  const NAME_UNIQUE = { roles_hotel_id_key_key: 'role_name_taken' } as const;

  r.post('/staff/roles', { preValidation: customRoles, schema: { tags, summary: 'Créer un rôle personnalisé (formules avec permissions du personnel)', body: roleBody.partial({ description: true }) } }, async (req, reply) => {
    const me = req.hotel!;
    const b = req.body;
    assertCovers(me.permissions, b.permissions);
    const created = await me.tenant((tx) =>
      withUnique(NAME_UNIQUE, async () => {
        const { rows } = await tx.query<{ id: string }>('INSERT INTO roles (hotel_id, key, name, description, is_system) VALUES ($1, $2, $3, $4, false) RETURNING id', [me.hotelId, slug(b.name), b.name, b.description ?? null]);
        await tx.query('INSERT INTO role_permissions (hotel_id, role_id, permission) SELECT $1, $2, unnest($3::text[])', [me.hotelId, rows[0]!.id, [...new Set(b.permissions)]]);
        await auditHotel(tx, me, 'role.created', { type: 'role', id: rows[0]!.id }, `Rôle créé : ${b.name}`, { after: b, ip: req.ip, requestId: req.id });
        return rows[0]!.id;
      }),
    );
    return reply.code(201).send({ id: created });
  });

  r.patch('/staff/roles/:id', { preValidation: customRoles, schema: { tags, summary: 'Modifier un rôle personnalisé', params: id, body: roleBody.partial() } }, async (req) => {
    const me = req.hotel!;
    const b = req.body;
    if (Object.keys(b).length === 0) throw new AppError('validation_error', [{ path: '', message: 'Aucune modification fournie.' }]);
    await me.tenant((tx) =>
      withUnique(NAME_UNIQUE, async () => {
        const { rows } = await tx.query<{ is_system: boolean }>('SELECT is_system FROM roles WHERE id = $1 FOR UPDATE', [req.params.id]);
        if (!rows[0]) throw new AppError('role_not_found');
        if (rows[0].is_system) throw new AppError('system_role_immutable');
        if (b.permissions) {
          assertCovers(me.permissions, b.permissions);
          await tx.query('DELETE FROM role_permissions WHERE role_id = $1', [req.params.id]);
          await tx.query('INSERT INTO role_permissions (hotel_id, role_id, permission) SELECT $1, $2, unnest($3::text[])', [me.hotelId, req.params.id, [...new Set(b.permissions)]]);
          // Les membres de ce rôle perdent aussitôt les permissions retirées : leurs sessions sont relues à chaque requête
        }
        if (b.name !== undefined || b.description !== undefined) {
          await tx.query('UPDATE roles SET name = COALESCE($2, name), description = CASE WHEN $3::boolean THEN $4 ELSE description END WHERE id = $1', [req.params.id, b.name ?? null, b.description !== undefined, b.description ?? null]);
        }
        await auditHotel(tx, me, 'role.updated', { type: 'role', id: req.params.id }, `Rôle modifié : ${Object.keys(b).join(', ')}`, { after: b, ip: req.ip, requestId: req.id });
      }),
    );
    return { updated: true };
  });

  r.delete('/staff/roles/:id', { preValidation: customRoles, schema: { tags, summary: 'Supprimer un rôle personnalisé sans membre', params: id } }, async (req) => {
    const me = req.hotel!;
    await me.tenant(async (tx) => {
      const { rows } = await tx.query<{ is_system: boolean; name: string }>('SELECT is_system, name FROM roles WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!rows[0]) throw new AppError('role_not_found');
      if (rows[0].is_system) throw new AppError('system_role_immutable');
      const used = await tx.query('SELECT 1 FROM memberships WHERE role_id = $1 LIMIT 1', [req.params.id]);
      if (used.rowCount) throw new AppError('role_in_use');
      await tx.query('DELETE FROM role_permissions WHERE role_id = $1', [req.params.id]);
      await tx.query('DELETE FROM roles WHERE id = $1', [req.params.id]);
      await auditHotel(tx, me, 'role.deleted', { type: 'role', id: req.params.id }, `Rôle supprimé : ${rows[0].name}`, { ip: req.ip, requestId: req.id });
    });
    return { deleted: true };
  });
}
