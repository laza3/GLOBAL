import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { AppError } from '../errors';

/* ---------------------------------------------------------------------------------------------
 * Jetons de session : 256 bits aléatoires ; seule l'empreinte SHA-256 est stockée en base.
 * ------------------------------------------------------------------------------------------- */
export const newSessionToken = (): string => randomBytes(32).toString('base64url');
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Jeton CSRF lié à la session (HMAC de l'empreinte) : sans état côté serveur, inutilisable avec une autre session. */
export const csrfTokenFor = (secret: string, tokenHash: string): string =>
  createHmac('sha256', secret).update(tokenHash).digest('base64url');

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/* ---------------------------------------------------------------------------------------------
 * Mots de passe : Argon2id (paramètres OWASP : 19 Mio, 2 itérations, 1 voie).
 * ------------------------------------------------------------------------------------------- */
const ARGON2 = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string): Promise<string> => hash(password, ARGON2);

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false; // hash illisible : jamais d'exception qui trahirait l'état du compte
  }
}

/**
 * Empreinte factice : quand l'e-mail est inconnu on vérifie quand même un hash, pour que le temps de réponse
 * ne permette pas de deviner quels comptes existent.
 */
let dummyHash: Promise<string> | null = null;
export const dummyVerify = async (password: string): Promise<void> => {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(await dummyHash, password);
};

const COMMON = new Set(['password123', '1234567890', 'azerty1234', 'motdepasse1', 'qwerty12345', 'madagascar1', 'hotelmanager1']);

/** 10 caractères minimum, une lettre et un chiffre, ni l'e-mail ni un mot de passe courant. */
export function assertStrongPassword(password: string, email?: string): void {
  const ok =
    password.length >= 10 &&
    password.length <= 128 &&
    /[A-Za-zÀ-ÿ]/.test(password) &&
    /\d/.test(password) &&
    !COMMON.has(password.toLowerCase()) &&
    !(email && password.toLowerCase() === email.toLowerCase());
  if (!ok) throw new AppError('weak_password');
}
