import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { decrypt, encrypt } from '../src/lib/crypto';

const key = randomBytes(32);

describe('chiffrement des pièces d\'identité', () => {
  it('chiffre puis déchiffre ; deux chiffrements du même texte diffèrent', () => {
    const a = encrypt('PA1234567', key);
    const b = encrypt('PA1234567', key);
    expect(decrypt(a, key)).toBe('PA1234567');
    expect(a.equals(b)).toBe(false);
    expect(a.toString('utf8')).not.toContain('PA1234567');
    expect(decrypt(encrypt('é-œ 日本', key), key)).toBe('é-œ 日本');
  });
  it('refuse une clé différente et toute altération', () => {
    const c = encrypt('SECRET', key);
    expect(() => decrypt(c, randomBytes(32))).toThrow();
    const tampered = Buffer.from(c);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
    expect(() => decrypt(tampered, key)).toThrow();
    expect(() => decrypt(Buffer.from('court'), key)).toThrow();
    expect(() => encrypt('x', Buffer.alloc(16))).toThrow();
  });
});

describe('configuration de la clé', () => {
  const base = { DATABASE_URL_APP: 'x', DATABASE_URL_PLATFORM: 'x', CSRF_SECRET: 'z'.repeat(40) };
  it('est dérivée en développement, stable d\'un démarrage à l\'autre', () => {
    const a = loadConfig({ ...base, NODE_ENV: 'development' });
    const b = loadConfig({ ...base, NODE_ENV: 'development' });
    expect(a.encryptionKey).toHaveLength(32);
    expect(a.encryptionKey.equals(b.encryptionKey)).toBe(true);
  });
  it('est obligatoire en production, et doit faire 32 octets', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/ENCRYPTION_KEY est obligatoire/);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') })).toThrow(/32 octets/);
    const ok = loadConfig({ ...base, NODE_ENV: 'production', ENCRYPTION_KEY: key.toString('base64') });
    expect(ok.encryptionKey.equals(key)).toBe(true);
  });
});
