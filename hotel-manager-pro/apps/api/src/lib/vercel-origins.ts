/**
 * Sur Vercel, le site connaît sa propre adresse (variables système VERCEL_PROJECT_PRODUCTION_URL, VERCEL_URL, VERCEL_BRANCH_URL :
 * des noms de domaine du PROJET lui-même, sans « https:// »). Les ajouter aux origines autorisées évite l'erreur « origine non
 * autorisée » quand ALLOWED_ORIGINS est absent ou ne correspond pas exactement à l'adresse utilisée. Aucun domaine étranger n'est
 * jamais ajouté : ces valeurs sont posées par Vercel, pas par le visiteur. ALLOWED_ORIGINS reste prioritaire et peut en lister d'autres
 * (domaine personnalisé).
 */
export function mergedAllowedOrigins(env: Record<string, string | undefined>): string | undefined {
  const own = ['VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_URL', 'VERCEL_BRANCH_URL']
    .map((key) => env[key]?.trim())
    .filter((host): host is string => Boolean(host) && /^[a-z0-9.-]+(:\d+)?$/i.test(host!))
    .map((host) => `https://${host}`);
  const all = [...(env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean), ...own];
  const unique = [...new Set(all)];
  return unique.length ? unique.join(',') : undefined;
}
