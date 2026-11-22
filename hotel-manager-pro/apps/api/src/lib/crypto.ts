import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Chiffrement des données sensibles (numéros de pièces d'identité) : AES-256-GCM.
 * Format stocké : iv (12 octets) ‖ tag d'authentification (16 octets) ‖ texte chiffré. Un IV aléatoire par chiffrement
 * (deux fois le même numéro donne deux chiffrés différents) ; toute altération du chiffré est détectée au déchiffrement.
 */
const IV = 12;
const TAG = 16;

export function encrypt(plain: string, key: Buffer): Buffer {
  if (key.length !== 32) throw new Error('Clé AES-256 invalide');
  const iv = randomBytes(IV);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function decrypt(data: Buffer, key: Buffer): string {
  if (data.length < IV + TAG + 1) throw new Error('Donnée chiffrée invalide');
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, IV));
  decipher.setAuthTag(data.subarray(IV, IV + TAG));
  return Buffer.concat([decipher.update(data.subarray(IV + TAG)), decipher.final()]).toString('utf8');
}
