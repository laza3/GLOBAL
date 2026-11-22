/**
 * Téléphone normalisé : uniquement des chiffres, indicatif pays inclus, sans « + » ni « 00 » (ex. 261340000000).
 * Sert à détecter les doublons (« 034 00 000 00 », « +261 34 00 000 00 » et « 0026134 00 000 00 » désignent le même numéro).
 * Pour un numéro local (commençant par un seul 0), l'indicatif du pays de l'établissement est ajouté (Madagascar : 261).
 * Retourne null si la saisie ne contient pas assez de chiffres pour être un numéro (moins de 7).
 */
export function normalizePhone(raw: string, defaultDialCode = '261'): string | null {
  const hasPlus = raw.trim().startsWith('+');
  let digits = raw.replace(/\D/g, '');
  if (digits.length < 7) return null;
  if (!hasPlus && digits.startsWith('00')) digits = digits.slice(2);
  else if (!hasPlus && digits.startsWith('0')) digits = defaultDialCode + digits.slice(1);
  return digits.length >= 7 && digits.length <= 15 ? digits : null;
}

/** Indicatif téléphonique du pays de l'établissement (utilisé pour normaliser les numéros saisis sans indicatif). */
export const DIAL_CODES: Record<string, string> = { MG: '261', FR: '33', RE: '262', YT: '262', MU: '230', KM: '269', SC: '248' };
export const dialCodeFor = (country: string | null | undefined): string => (country && DIAL_CODES[country]) || '261';
