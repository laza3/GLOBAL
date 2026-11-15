import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { PERMISSIONS, SYSTEM_ROLES, type Permission } from '@gp/shared';
import type { Db } from './db';
import { audit, companyOf, fail, nowIso, outbox, uuid, type Ctx } from './util';

const MAX_FAILED = 5;
const LOCK_MINUTES = 5;
const MIN_PASSWORD = 8;

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const got = scryptSync(pw, Buffer.from(salt, 'base64'), expected.length, { N: +n, r: +r, p: +p });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export function assertStrongPassword(pw: string) {
  if (pw.length < MIN_PASSWORD) fail('WEAK_PASSWORD', `Le mot de passe doit contenir au moins ${MIN_PASSWORD} caractères`);
}

export function seedRoles(db: Db) {
  for (const r of SYSTEM_ROLES) {
    let id = db.value<string>('SELECT id FROM roles WHERE code = ?', r.code);
    if (!id) {
      id = uuid();
      db.run('INSERT INTO roles (id, code, name, is_system) VALUES (?,?,?,1)', id, r.code, r.name);
    }
    db.run('DELETE FROM role_permissions WHERE role_id = ?', id);
    for (const p of r.permissions) db.run('INSERT INTO role_permissions (role_id, permission) VALUES (?,?)', id, p);
  }
}

export interface AuthUser {
  id: string; username: string; displayName: string; roleCode: string; roleName: string; branchId: string | null; permissions: Permission[];
}

function loadUser(db: Db, id: string): AuthUser | undefined {
  const u = db.get<any>(
    'SELECT u.*, r.code AS role_code, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND u.active = 1',
    id,
  );
  if (!u) return undefined;
  const perms = db.all<{ permission: Permission }>('SELECT permission FROM role_permissions WHERE role_id = ?', u.role_id).map((r) => r.permission);
  return { id: u.id, username: u.username, displayName: u.display_name, roleCode: u.role_code, roleName: u.role_name, branchId: u.branch_id, permissions: perms };
}

/** Sessions applicatives en mémoire (jetons opaques aléatoires). */
export class SessionStore {
  private sessions = new Map<string, { userId: string; sessionId: string; lastSeen: number }>();
  constructor(private db: Db, private idleMs = 8 * 3600_000) {}

  login(username: string, password: string): { token: string; user: AuthUser } {
    const u = this.db.get<any>('SELECT * FROM users WHERE username = ?', username.trim());
    const bad = () => fail('INVALID_CREDENTIALS', 'Identifiant ou mot de passe incorrect');
    if (!u || !u.active) {
      // temps constant approximatif : on hache quand même
      verifyPassword(password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64'));
      return bad();
    }
    if (u.locked_until && new Date(u.locked_until) > new Date()) {
      fail('ACCOUNT_LOCKED', `Compte verrouillé jusqu'à ${new Date(u.locked_until).toLocaleTimeString()}`);
    }
    if (!verifyPassword(password, u.password_hash)) {
      const failed = u.failed_logins + 1;
      const lock = failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null;
      this.db.run('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', lock ? 0 : failed, lock, u.id);
      this.db.run('INSERT INTO audit_log (id, at, user_id, username, action, details) VALUES (?,?,?,?,?,?)', uuid(), nowIso(), u.id, u.username, 'auth.login_failed', JSON.stringify({ failed }));
      return bad();
    }
    this.db.run('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', nowIso(), u.id);
    const sessionId = uuid();
    this.db.run('INSERT INTO user_sessions (id, user_id, started_at, device) VALUES (?,?,?,?)', sessionId, u.id, nowIso(), 'desktop');
    this.db.run('INSERT INTO audit_log (id, at, user_id, username, action) VALUES (?,?,?,?,?)', uuid(), nowIso(), u.id, u.username, 'auth.login');
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(token, { userId: u.id, sessionId, lastSeen: Date.now() });
    return { token, user: loadUser(this.db, u.id)! };
  }

  logout(token: string) {
    const s = this.sessions.get(token);
    if (!s) return;
    this.db.run('UPDATE user_sessions SET ended_at = ? WHERE id = ?', nowIso(), s.sessionId);
    this.sessions.delete(token);
  }

  /** Résout un jeton en contexte (rechargé à chaque appel : une permission retirée prend effet immédiatement). */
  resolve(token: string | undefined): Ctx {
    const s = token ? this.sessions.get(token) : undefined;
    if (!s) return fail('UNAUTHENTICATED', 'Session expirée, veuillez vous reconnecter');
    if (Date.now() - s.lastSeen > this.idleMs) {
      this.logout(token!);
      return fail('UNAUTHENTICATED', 'Session expirée, veuillez vous reconnecter');
    }
    s.lastSeen = Date.now();
    const user = loadUser(this.db, s.userId);
    if (!user) {
      this.sessions.delete(token!);
      return fail('UNAUTHENTICATED', 'Compte désactivé');
    }
    const db = this.db;
    return {
      db,
      user: { ...user, permissions: new Set(user.permissions) },
      company: () => companyOf(db),
    };
  }

  me(token: string) {
    const ctx = this.resolve(token);
    return { ...ctx.user, permissions: [...ctx.user.permissions] };
  }

  activeSessions() {
    return this.db.all('SELECT us.id, u.username, u.display_name, us.started_at, us.ended_at, us.device FROM user_sessions us JOIN users u ON u.id = us.user_id ORDER BY us.started_at DESC LIMIT 100');
  }
}

// ---------- gestion des utilisateurs & rôles ----------
export function listUsers(ctx: Ctx) {
  return ctx.db.all(
    `SELECT u.id, u.username, u.display_name AS displayName, u.email, u.phone, u.active, u.last_login_at AS lastLoginAt, u.locked_until AS lockedUntil,
            u.role_id AS roleId, r.name AS roleName, r.code AS roleCode, u.branch_id AS branchId
     FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.display_name`,
  );
}

export function createUser(ctx: Ctx, i: { username: string; displayName: string; password: string; roleId: string; branchId?: string | null; email?: string; phone?: string }) {
  assertStrongPassword(i.password);
  const username = i.username.trim();
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) fail('INVALID', "Identifiant invalide (3 à 40 caractères : lettres, chiffres, . _ -)");
  if (ctx.db.get('SELECT 1 FROM users WHERE username = ?', username)) fail('DUPLICATE', 'Cet identifiant existe déjà');
  const id = uuid(), t = nowIso();
  ctx.db.tx(() => {
    ctx.db.run(
      'INSERT INTO users (id, username, display_name, password_hash, role_id, branch_id, email, phone, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      id, username, i.displayName, hashPassword(i.password), i.roleId, i.branchId ?? null, i.email ?? null, i.phone ?? null, t, t,
    );
    audit(ctx, 'user.create', 'user', id, { username, roleId: i.roleId });
  });
  return { id };
}

export function updateUser(ctx: Ctx, id: string, i: { displayName?: string; roleId?: string; branchId?: string | null; email?: string; phone?: string; active?: boolean; password?: string }) {
  const u = ctx.db.get<any>('SELECT * FROM users WHERE id = ?', id);
  if (!u) fail('NOT_FOUND', 'Utilisateur introuvable');
  if (i.password) assertStrongPassword(i.password);
  const adminRole = ctx.db.value<string>("SELECT id FROM roles WHERE code = 'ADMIN'");
  const demotes = (i.roleId && i.roleId !== adminRole && u.role_id === adminRole) || (i.active === false && u.role_id === adminRole);
  if (demotes) {
    const others = ctx.db.value<number>('SELECT COUNT(*) FROM users WHERE role_id = ? AND active = 1 AND id <> ?', adminRole, id)!;
    if (others === 0) fail('LAST_ADMIN', "Impossible : il doit rester au moins un administrateur actif");
  }
  ctx.db.tx(() => {
    ctx.db.run(
      `UPDATE users SET display_name = ?, role_id = ?, branch_id = ?, email = ?, phone = ?, active = ?, password_hash = ?, failed_logins = 0, locked_until = NULL, updated_at = ? WHERE id = ?`,
      i.displayName ?? u.display_name, i.roleId ?? u.role_id, i.branchId === undefined ? u.branch_id : i.branchId,
      i.email ?? u.email, i.phone ?? u.phone, i.active === undefined ? u.active : i.active ? 1 : 0,
      i.password ? hashPassword(i.password) : u.password_hash, nowIso(), id,
    );
    audit(ctx, 'user.update', 'user', id, { ...i, password: i.password ? '***' : undefined });
  });
}

export function changeOwnPassword(ctx: Ctx, oldPw: string, newPw: string) {
  const u = ctx.db.get<any>('SELECT password_hash FROM users WHERE id = ?', ctx.user.id)!;
  if (!verifyPassword(oldPw, u.password_hash)) fail('INVALID_CREDENTIALS', 'Ancien mot de passe incorrect');
  assertStrongPassword(newPw);
  ctx.db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', hashPassword(newPw), nowIso(), ctx.user.id);
  audit(ctx, 'user.change_password', 'user', ctx.user.id);
}

export function listRoles(ctx: Ctx) {
  const roles = ctx.db.all<any>('SELECT id, code, name, is_system AS isSystem FROM roles ORDER BY is_system DESC, name');
  return roles.map((r) => ({
    ...r,
    isSystem: !!r.isSystem,
    permissions: ctx.db.all<{ permission: string }>('SELECT permission FROM role_permissions WHERE role_id = ?', r.id).map((p) => p.permission),
  }));
}

export function saveRole(ctx: Ctx, i: { id?: string; name: string; permissions: string[] }) {
  for (const p of i.permissions) if (!(PERMISSIONS as readonly string[]).includes(p)) fail('INVALID', `Permission inconnue : ${p}`);
  return ctx.db.tx(() => {
    let id = i.id;
    if (id) {
      const r = ctx.db.get<any>('SELECT * FROM roles WHERE id = ?', id);
      if (!r) fail('NOT_FOUND', 'Rôle introuvable');
      if (r.code === 'ADMIN') fail('PROTECTED', 'Le rôle Administrateur ne peut pas être modifié');
      ctx.db.run('UPDATE roles SET name = ? WHERE id = ?', i.name, id);
    } else {
      id = uuid();
      ctx.db.run('INSERT INTO roles (id, code, name, is_system) VALUES (?,?,?,0)', id, `CUSTOM_${id.slice(0, 8).toUpperCase()}`, i.name);
    }
    ctx.db.run('DELETE FROM role_permissions WHERE role_id = ?', id);
    for (const p of new Set(i.permissions)) ctx.db.run('INSERT INTO role_permissions (role_id, permission) VALUES (?,?)', id, p);
    audit(ctx, 'role.save', 'role', id, { name: i.name, permissions: i.permissions.length });
    return { id };
  });
}

export function deleteRole(ctx: Ctx, id: string) {
  const r = ctx.db.get<any>('SELECT * FROM roles WHERE id = ?', id);
  if (!r) fail('NOT_FOUND', 'Rôle introuvable');
  if (r.is_system) fail('PROTECTED', 'Un rôle système ne peut pas être supprimé');
  if (ctx.db.get('SELECT 1 FROM users WHERE role_id = ?', id)) fail('IN_USE', 'Ce rôle est attribué à des utilisateurs');
  ctx.db.run('DELETE FROM roles WHERE id = ?', id);
  audit(ctx, 'role.delete', 'role', id);
}

export function listAudit(ctx: Ctx, q: { limit?: number; action?: string }) {
  return ctx.db.all(
    `SELECT id, at, username, action, entity, entity_id AS entityId, details FROM audit_log WHERE (? IS NULL OR action LIKE ?) ORDER BY at DESC LIMIT ?`,
    q.action ?? null, q.action ? `${q.action}%` : null, Math.min(q.limit ?? 200, 1000),
  );
}
void outbox;

/**
 * Récupération hors session (mot de passe oublié) : réinitialise le mot de passe d'un utilisateur (par défaut le
 * premier administrateur actif), lève le verrouillage et journalise l'opération. Appelée uniquement depuis la
 * ligne de commande de l'application (poste local), jamais depuis l'interface.
 */
export function resetPasswordOffline(db: Db, newPassword: string, username?: string): { username: string } {
  assertStrongPassword(newPassword);
  const u = username
    ? db.get<any>('SELECT id, username FROM users WHERE username = ?', username.trim())
    : db.get<any>("SELECT u.id, u.username FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'ADMIN' AND u.active = 1 ORDER BY u.created_at LIMIT 1");
  if (!u) fail('NOT_FOUND', username ? `Utilisateur introuvable : ${username}` : 'Aucun administrateur actif');
  db.tx(() => {
    db.run('UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL, active = 1, updated_at = ? WHERE id = ?', hashPassword(newPassword), nowIso(), u.id);
    db.run('INSERT INTO audit_log (id, at, user_id, username, action, details) VALUES (?,?,?,?,?,?)', uuid(), nowIso(), u.id, u.username, 'auth.password_reset_offline', JSON.stringify({ via: 'command-line' }));
  });
  return { username: u.username };
}
