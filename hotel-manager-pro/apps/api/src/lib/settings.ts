import type { Db } from '../db';
import { platformTx } from '../db';

/** Réglages de la plateforme (durée d'essai, tolérance…), lus via le rôle plateforme avec un cache court. */
export class SettingsCache {
  private cache = new Map<string, { value: unknown; at: number }>();

  constructor(
    private readonly db: Db,
    private readonly ttlMs = 15_000,
  ) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value as T;
    const { rows } = await platformTx(this.db, (tx) => tx.query<{ value: T }>('SELECT value FROM platform_settings WHERE key = $1', [key]));
    const value = rows[0] ? rows[0].value : fallback;
    this.cache.set(key, { value, at: Date.now() });
    return value;
  }

  async number(key: string, fallback: number): Promise<number> {
    const v = await this.get<unknown>(key, fallback);
    return typeof v === 'number' ? v : fallback;
  }

  invalidate(): void {
    this.cache.clear();
  }
}
