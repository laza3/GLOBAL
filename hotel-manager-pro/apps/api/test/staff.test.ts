import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, PASSWORD, addStaff, createTestApp, q, registerHotel, uniqueEmail, type Registered, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.close(); });

const code = (res: { body: any }) => res.body?.error?.code;
const roleId = async (h: Registered, key: string) => (await q(t, 'SELECT id FROM roles WHERE hotel_id = $1 AND key = $2', [h.hotelId, key]))[0].id as string;
const create = async (c: Client, over: Record<string, unknown>) => c.post('/api/v1/staff', { fullName: 'Employé Test', email: uniqueEmail('emp'), jobTitle: 'Réceptionniste', ...over });
const login = async (email: string, password: string, hotelId?: string) => {
  const c = new Client(t);
  const res = await c.post('/api/v1/auth/login', { email, password, hotelId });
  return { c, res };
};

describe('comptes du personnel', () => {
  it('le propriétaire crée un compte : mot de passe provisoire affiché une fois, à changer ; l\'employé se connecte avec le rôle donné', async () => {
    const h = await registerHotel(t);
    const res = await create(h.client, { roleId: await roleId(h, 'receptionist'), email: 'marie@hotel.test' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.body.temporaryPassword).toMatch(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{5}-[A-Za-z2-9]{5}$/);
    const { c, res: l } = await login('marie@hotel.test', res.body.temporaryPassword, h.hotelId);
    expect(l.status, JSON.stringify(l.body)).toBe(200);
    expect(l.body.user ?? l.body).toBeTruthy();
    expect((await c.get('/api/v1/auth/password-status')).body).toEqual({ mustChange: true });
    expect((await c.get('/api/v1/reservations')).status).toBe(200); // le rôle de réception fonctionne tout de suite
    expect((await c.get('/api/v1/staff')).status).toBe(403);
    // changement du mot de passe : le marquage disparaît
    const change = await c.post('/api/v1/auth/change-password', { currentPassword: res.body.temporaryPassword, newPassword: 'Un-nouveau-mot-de-passe-91' });
    expect(change.status).toBe(204);
    expect((await c.get('/api/v1/auth/password-status')).body).toEqual({ mustChange: false });
    // aucune trace du mot de passe provisoire dans le journal
    const audit = await q(t, "SELECT summary, after_data::text AS a FROM audit_logs WHERE hotel_id = $1 AND action = 'staff.created'", [h.hotelId]);
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(res.body.temporaryPassword);
    // liste
    const list = (await h.client.get('/api/v1/staff')).body.staff;
    expect(list.find((s: any) => s.email === 'marie@hotel.test')).toMatchObject({ roleKey: 'receptionist', status: 'active', jobTitle: 'Réceptionniste', mustChangePassword: false });
  });

  it('e-mail déjà utilisé refusé ; validation ; limite d\'utilisateurs de la formule', async () => {
    const h = await registerHotel(t);
    const rid = await roleId(h, 'receptionist');
    expect(code(await create(h.client, { roleId: rid, email: h.email }))).toBe('email_already_registered');
    const other = await registerHotel(t);
    expect(code(await create(h.client, { roleId: rid, email: other.email }))).toBe('email_already_registered'); // compte d'un autre hôtel : jamais rattaché
    expect((await create(h.client, { roleId: rid, email: 'pas-un-email' })).status).toBe(422);
    expect((await create(h.client, { roleId: rid, fullName: 'A' })).status).toBe(422);
    expect(code(await create(h.client, { roleId: '00000000-0000-4000-8000-000000000000' }))).toBe('role_not_found');
    expect(code(await create(h.client, { roleId: await roleId(other, 'receptionist') }))).toBe('role_not_found'); // rôle d'un autre hôtel
    await q(t, "UPDATE subscriptions SET plan_id = (SELECT id FROM plans WHERE code = 'starter') WHERE hotel_id = $1", [h.hotelId]);
    await create(h.client, { roleId: rid });
    await create(h.client, { roleId: rid });
    const full = await create(h.client, { roleId: rid });
    expect(full.status).toBe(402);
    expect(code(full)).toBe('user_limit_reached');
  });

  it('un administrateur gère le personnel mais ne peut ni créer un propriétaire, ni toucher à l\'un d\'eux', async () => {
    const h = await registerHotel(t);
    const admin = await addStaff(t, h.hotelId, 'admin');
    const owner = (await h.client.get('/api/v1/staff')).body.staff.find((s: any) => s.roleKey === 'owner');
    expect(code(await create(admin.client, { roleId: await roleId(h, 'owner') }))).toBe('privilege_escalation');
    expect((await create(admin.client, { roleId: await roleId(h, 'receptionist') })).status).toBe(201);
    expect(code(await admin.client.patch(`/api/v1/staff/${owner.id}`, { status: 'disabled' }))).toBe('privilege_escalation');
    expect(code(await admin.client.post(`/api/v1/staff/${owner.id}/reset-password`))).toBe('privilege_escalation');
    const reception = await addStaff(t, h.hotelId, 'receptionist');
    expect((await reception.client.post('/api/v1/staff', { fullName: 'X Y', email: uniqueEmail(), roleId: await roleId(h, 'receptionist') })).status).toBe(403);
    // lecture seule pour qui a staff:read sans manage : le comptable n'a pas staff:read
    const acc = await addStaff(t, h.hotelId, 'accountant');
    expect((await acc.client.get('/api/v1/staff')).status).toBe(403);
  });

  it('changer le rôle prend effet aussitôt ; désactiver ferme les sessions ; on ne se modifie pas soi-même', async () => {
    const h = await registerHotel(t);
    const emp = await addStaff(t, h.hotelId, 'receptionist');
    const list = (await h.client.get('/api/v1/staff')).body.staff;
    const target = list.find((s: any) => s.userId === emp.userId);
    const newTask = () => emp.client.post('/api/v1/housekeeping/tasks', { roomId: '00000000-0000-4000-8000-000000000000', taskType: 'deep_clean' });
    expect((await newTask()).status).toBe(403);
    expect((await h.client.patch(`/api/v1/staff/${target.id}`, { roleId: await roleId(h, 'hk_manager'), jobTitle: 'Gouvernante' })).status).toBe(200);
    expect((await newTask()).status).toBe(404); // autorisé : seule la chambre fictive est introuvable
    expect((await emp.client.get('/api/v1/reception/overview')).status).toBe(200); // hk_manager lit les réservations
    expect((await emp.client.post('/api/v1/reception/check-in', { reservationId: '00000000-0000-4000-8000-000000000000' })).status).toBe(403);
    // désactivation
    expect((await h.client.patch(`/api/v1/staff/${target.id}`, { status: 'disabled' })).status).toBe(200);
    expect((await emp.client.get('/api/v1/reservations')).status).toBe(401);
    const again = await login(emp.email, PASSWORD, h.hotelId);
    expect(again.res.status).toBeGreaterThanOrEqual(400);
    // réactivation
    expect((await h.client.patch(`/api/v1/staff/${target.id}`, { status: 'active' })).status).toBe(200);
    expect((await login(emp.email, PASSWORD, h.hotelId)).res.status).toBe(200);
    // soi-même
    const me = list.find((s: any) => s.roleKey === 'owner');
    expect(code(await h.client.patch(`/api/v1/staff/${me.id}`, { status: 'disabled' }))).toBe('cannot_modify_self');
    expect(code(await h.client.patch(`/api/v1/staff/${me.id}`, { roleId: await roleId(h, 'admin') }))).toBe('cannot_modify_self');
    expect((await h.client.patch(`/api/v1/staff/${me.id}`, { jobTitle: 'Directrice' })).status).toBe(200);
    expect((await h.client.patch(`/api/v1/staff/${target.id}`, {})).status).toBe(422);
    expect((await h.client.patch('/api/v1/staff/00000000-0000-4000-8000-000000000000', { jobTitle: 'X' })).status).toBe(404);
  });

  it('réinitialisation : nouveau mot de passe provisoire, ancien refusé, sessions fermées ; pas pour soi-même', async () => {
    const h = await registerHotel(t);
    const emp = await addStaff(t, h.hotelId, 'receptionist');
    const target = (await h.client.get('/api/v1/staff')).body.staff.find((s: any) => s.userId === emp.userId);
    const reset = await h.client.post(`/api/v1/staff/${target.id}/reset-password`);
    expect(reset.status).toBe(200);
    expect(reset.headers['cache-control']).toContain('no-store');
    expect((await emp.client.get('/api/v1/reservations')).status).toBe(401);
    expect((await login(emp.email, PASSWORD, h.hotelId)).res.status).toBeGreaterThanOrEqual(400);
    const ok = await login(emp.email, reset.body.temporaryPassword, h.hotelId);
    expect(ok.res.status).toBe(200);
    expect((await ok.c.get('/api/v1/auth/password-status')).body.mustChange).toBe(true);
    const self = (await h.client.get('/api/v1/staff')).body.staff.find((s: any) => s.roleKey === 'owner');
    expect(code(await h.client.post(`/api/v1/staff/${self.id}/reset-password`))).toBe('cannot_modify_self');
    // un compte partagé avec un autre établissement ne peut pas être réinitialisé par celui-ci (garde de la base)
    const other = await registerHotel(t);
    await q(t, "INSERT INTO memberships (hotel_id, user_id, role_id, status) VALUES ($1, $2, $3, 'active')", [other.hotelId, emp.userId, await roleId(other, 'receptionist')]);
    expect((await h.client.post(`/api/v1/staff/${target.id}/reset-password`)).status).toBe(403);
  });
});

describe('rôles personnalisés', () => {
  it('créer, attribuer, modifier (effet immédiat), supprimer ; jamais plus de droits que soi', async () => {
    const h = await registerHotel(t);
    const created = await h.client.post('/api/v1/staff/roles', { name: 'Chef de réception', description: 'Réception + rapports', permissions: ['reservations:read', 'reservations:create', 'calendar:read', 'reports:read'] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const roles = (await h.client.get('/api/v1/staff/roles')).body.roles;
    expect(roles.map((r: any) => r.key)).toContain('custom_chef_de_reception');
    expect(roles.find((r: any) => r.key === 'owner')).toMatchObject({ isSystem: true, members: 1 });
    expect(code(await h.client.post('/api/v1/staff/roles', { name: 'Chef de réception', permissions: ['reservations:read'] }))).toBe('role_name_taken');
    expect((await h.client.post('/api/v1/staff/roles', { name: 'Vide', permissions: [] })).status).toBe(422);
    expect((await h.client.post('/api/v1/staff/roles', { name: 'Inconnu', permissions: ['tout:faire'] })).status).toBe(422);
    const emp = await create(h.client, { roleId: created.body.id, email: 'chef@hotel.test' });
    const { c } = await login('chef@hotel.test', emp.body.temporaryPassword, h.hotelId);
    expect((await c.get('/api/v1/reservations')).status).toBe(200);
    expect((await c.get('/api/v1/rooms')).status).toBe(403);
    expect((await h.client.patch(`/api/v1/staff/roles/${created.body.id}`, { permissions: ['reservations:read', 'rooms:read'] })).status).toBe(200);
    expect((await c.get('/api/v1/rooms')).status).toBe(200);
    expect((await c.post('/api/v1/reservations', { guestId: '00000000-0000-4000-8000-000000000000', rooms: [] })).status).toBe(403); // droit retiré
    expect(code(await h.client.delete(`/api/v1/staff/roles/${created.body.id}`))).toBe('role_in_use');
    const sysId = await roleId(h, 'receptionist');
    expect(code(await h.client.patch(`/api/v1/staff/roles/${sysId}`, { name: 'Autre' }))).toBe('system_role_immutable');
    expect(code(await h.client.delete(`/api/v1/staff/roles/${sysId}`))).toBe('system_role_immutable');
    const member = (await h.client.get('/api/v1/staff')).body.staff.find((s: any) => s.email === 'chef@hotel.test');
    await h.client.patch(`/api/v1/staff/${member.id}`, { roleId: sysId });
    expect((await h.client.delete(`/api/v1/staff/roles/${created.body.id}`)).status).toBe(200);
    expect(code(await h.client.delete(`/api/v1/staff/roles/${created.body.id}`))).toBe('role_not_found');
  });

  it('un administrateur ne peut pas fabriquer un rôle plus puissant que lui ; formule sans permissions personnalisées refusée', async () => {
    const h = await registerHotel(t);
    const admin = await addStaff(t, h.hotelId, 'admin');
    expect(code(await admin.client.post('/api/v1/staff/roles', { name: 'Super', permissions: ['reservations:read', 'subscription:manage'] }))).toBe('privilege_escalation');
    expect((await admin.client.post('/api/v1/staff/roles', { name: 'Correct', permissions: ['reservations:read'] })).status).toBe(201);
    await q(t, "UPDATE subscriptions SET plan_id = (SELECT id FROM plans WHERE code = 'starter') WHERE hotel_id = $1", [h.hotelId]);
    const refused = await h.client.post('/api/v1/staff/roles', { name: 'Autre', permissions: ['reservations:read'] });
    expect(refused.status).toBe(403);
    expect(code(refused)).toBe('feature_not_in_plan');
    expect((await h.client.get('/api/v1/staff/roles')).status).toBe(200); // la lecture reste possible
  });

  it('isolation : un autre établissement ne voit ni ne modifie le personnel et les rôles', async () => {
    const a = await registerHotel(t);
    const b = await registerHotel(t);
    const staffA = (await a.client.get('/api/v1/staff')).body.staff;
    expect(staffA).toHaveLength(1);
    expect((await b.client.get('/api/v1/staff')).body.staff.every((s: any) => s.email !== a.email)).toBe(true);
    expect(code(await b.client.patch(`/api/v1/staff/${staffA[0].id}`, { jobTitle: 'Pirate' }))).toBe('member_not_found');
    expect(code(await b.client.post(`/api/v1/staff/${staffA[0].id}/reset-password`))).toBe('member_not_found');
    const roleA = await roleId(a, 'receptionist');
    expect(code(await b.client.patch(`/api/v1/staff/roles/${roleA}`, { name: 'Xx' }))).toBe('role_not_found');
    expect((await new Client(t).get('/api/v1/staff')).status).toBe(401);
  });
});
