/**
 * Politique de mot de passe — UNE seule définition, appliquée par le serveur (qui fait foi) et par l'interface
 * (qui prévient avant l'envoi). 10 caractères minimum, une lettre et un chiffre, ni l'e-mail ni un mot de passe courant.
 */
const COMMON = new Set(['password123', '1234567890', 'azerty1234', 'motdepasse1', 'qwerty12345', 'madagascar1', 'hotelmanager1']);

export const PASSWORD_HINT = '10 caractères minimum, avec au moins une lettre et un chiffre.';

export function isStrongPassword(password: string, email?: string): boolean {
  return (
    password.length >= 10 &&
    password.length <= 128 &&
    /[A-Za-zÀ-ÿ]/.test(password) &&
    /\d/.test(password) &&
    !COMMON.has(password.toLowerCase()) &&
    !(email && password.toLowerCase() === email.toLowerCase())
  );
}

/** Message à afficher sous le champ, ou null si le mot de passe convient. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < 10) return 'Le mot de passe doit contenir au moins 10 caractères.';
  if (password.length > 128) return 'Le mot de passe est trop long (128 caractères maximum).';
  if (!/[A-Za-zÀ-ÿ]/.test(password) || !/\d/.test(password)) return 'Ajoutez au moins une lettre et un chiffre.';
  if (!isStrongPassword(password, email)) return 'Ce mot de passe est trop courant ou identique à votre e-mail. Choisissez-en un autre.';
  return null;
}
