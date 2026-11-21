import { isApiError } from '../api/client';

export interface FormFeedback {
  /** Erreurs par champ (chemin du champ → message), à afficher sous chaque champ. */
  fields: Record<string, string>;
  /** Message général (erreur qui ne concerne pas un champ précis), à afficher en haut du formulaire. */
  general?: string;
}

/**
 * Convertit une erreur d'API en retour de formulaire : les erreurs de validation du serveur vont sous leur champ,
 * certains codes d'erreur sont rattachés à un champ (`codeToField`), le reste devient un message général.
 */
export function feedbackFrom(error: unknown, codeToField: Record<string, string> = {}): FormFeedback {
  if (!isApiError(error)) return { fields: {}, general: 'Une erreur inattendue est survenue. Réessayez.' };
  const fields: Record<string, string> = {};
  for (const d of error.details ?? []) if (d.path && !fields[d.path]) fields[d.path] = d.message;
  const target = codeToField[error.code];
  if (target) fields[target] = error.message;
  if (Object.keys(fields).length) return { fields };
  return { fields, general: error.message };
}

export const emailProblem = (value: string): string | null =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim()) ? null : 'Saisissez une adresse e-mail valide (ex. nom@hotel.mg).';

export const requiredProblem = (value: string, label: string, min = 1): string | null =>
  value.trim().length >= min ? null : min > 1 ? `${label} doit contenir au moins ${min} caractères.` : `${label} est obligatoire.`;
