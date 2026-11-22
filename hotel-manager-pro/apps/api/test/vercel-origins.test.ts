import { describe, expect, it } from 'vitest';
import { mergedAllowedOrigins } from '../src/lib/vercel-origins';

describe('origines autorisées sur Vercel', () => {
  it('ajoute les adresses propres du projet à ALLOWED_ORIGINS, sans doublon ni « / » final', () => {
    expect(mergedAllowedOrigins({
      ALLOWED_ORIGINS: 'https://hmp-staging.vercel.app/, https://hotel.exemple.mg',
      VERCEL_PROJECT_PRODUCTION_URL: 'hmp-staging.vercel.app',
      VERCEL_URL: 'hmp-staging-abc123-laza.vercel.app',
    })).toBe('https://hmp-staging.vercel.app,https://hotel.exemple.mg,https://hmp-staging-abc123-laza.vercel.app');
  });
  it('fonctionne sans ALLOWED_ORIGINS (adresses du projet seules)', () => {
    expect(mergedAllowedOrigins({ VERCEL_PROJECT_PRODUCTION_URL: 'hmp-staging-x1.vercel.app' })).toBe('https://hmp-staging-x1.vercel.app');
  });
  it('ne change rien hors Vercel', () => {
    expect(mergedAllowedOrigins({})).toBeUndefined();
    expect(mergedAllowedOrigins({ ALLOWED_ORIGINS: 'http://127.0.0.1:5173' })).toBe('http://127.0.0.1:5173');
  });
  it('ignore une valeur qui ne ressemble pas à un nom de domaine (aucune injection d\'origine)', () => {
    expect(mergedAllowedOrigins({ VERCEL_URL: 'evil.com/path?x=1' })).toBeUndefined();
    expect(mergedAllowedOrigins({ VERCEL_URL: 'https://evil.com' })).toBeUndefined();
  });
});
