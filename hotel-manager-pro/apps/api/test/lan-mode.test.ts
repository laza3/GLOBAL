import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, ORIGIN, type TestApp } from './helpers';

/**
 * Mode réseau local (plusieurs ordinateurs dans l'hôtel) : l'interface relaie les requêtes des autres appareils vers l'API sur 127.0.0.1.
 * Sans précaution, toutes les machines auraient la même adresse aux yeux de l'API et partageraient les limites de requêtes :
 * quelques mots de passe faux sur un poste bloqueraient tous les autres.
 */
async function login(t: TestApp, socket: string, forwardedFor?: string): Promise<number> {
  const res = await t.app.inject({
    method: 'POST', url: '/api/v1/auth/login', remoteAddress: socket,
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}) },
    payload: { email: 'personne@example.test', password: 'Mauvais-mot-de-passe-42' },
  });
  return res.statusCode;
}
const exhaust = async (t: TestApp, socket: string, ff: (i: number) => string | undefined) => { for (let i = 0; i < 6; i++) await login(t, socket, ff(i)); };

describe('LAN_MODE : une limite de requêtes PAR APPAREIL', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp({ LAN_MODE: 'true', AUTH_RATE_LIMIT_MAX: '3' }); });
  afterAll(async () => { await t.close(); });

  it('un poste qui se trompe de mot de passe ne bloque pas les autres postes', async () => {
    await exhaust(t, '127.0.0.1', () => '192.168.1.20'); // relais local de l'interface, poste de la réception
    expect(await login(t, '127.0.0.1', '192.168.1.20')).toBe(429);
    expect(await login(t, '127.0.0.1', '192.168.1.21')).not.toBe(429); // autre poste, même relais
  });

  it('un appareil du réseau ne peut pas se faire passer pour un autre avec un en-tête X-Forwarded-For', async () => {
    // Connexion directe d'un appareil (adresse non locale) : son en-tête est ignoré, seule son adresse réelle compte
    await exhaust(t, '192.168.1.30', (i) => `10.9.9.${i}`);
    expect(await login(t, '192.168.1.30', '10.8.8.8')).toBe(429);
    // Passage par le relais : l'adresse AJOUTÉE par le relais (la dernière) fait foi, pas une adresse forgée avant elle
    await exhaust(t, '127.0.0.1', (i) => `1.1.1.${i}, 192.168.1.40`);
    expect(await login(t, '127.0.0.1', '2.2.2.2, 192.168.1.40')).toBe(429);
  });
});

describe('sans LAN_MODE : l\'en-tête X-Forwarded-For n\'est jamais cru', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp({ AUTH_RATE_LIMIT_MAX: '3' }); });
  afterAll(async () => { await t.close(); });

  it('changer l\'en-tête ne contourne pas la limite', async () => {
    await exhaust(t, '203.0.113.7', (i) => `198.51.100.${i}`);
    expect(await login(t, '203.0.113.7', '198.51.100.250')).toBe(429);
  });
});
