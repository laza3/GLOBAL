import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from './schema';

type Param = string | number | bigint | null | undefined | boolean;
const norm = (p: Param[]) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

/** Mince couche au-dessus de node:sqlite (sans module natif) : requêtes préparées en cache, transactions imbriquées. */
export class Db {
  readonly raw: DatabaseSync;
  private cache = new Map<string, ReturnType<DatabaseSync['prepare']>>();
  private depth = 0;

  constructor(readonly path: string) {
    this.raw = new DatabaseSync(path);
    this.raw.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (path !== ':memory:') this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.migrate();
  }

  private stmt(sql: string) {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }

  run(sql: string, ...p: Param[]) {
    return this.stmt(sql).run(...(norm(p) as any[]));
  }
  get<T = Record<string, any>>(sql: string, ...p: Param[]): T | undefined {
    return this.stmt(sql).get(...(norm(p) as any[])) as T | undefined;
  }
  all<T = Record<string, any>>(sql: string, ...p: Param[]): T[] {
    return this.stmt(sql).all(...(norm(p) as any[])) as T[];
  }
  value<T = any>(sql: string, ...p: Param[]): T | undefined {
    const r = this.get<Record<string, any>>(sql, ...p);
    return r ? (Object.values(r)[0] as T) : undefined;
  }

  /** Transaction atomique (BEGIN IMMEDIATE) ; imbriquée via SAVEPOINT. Rollback complet en cas d'exception. */
  tx<T>(fn: () => T): T {
    if (this.depth === 0) {
      this.raw.exec('BEGIN IMMEDIATE');
      this.depth++;
      try {
        const r = fn();
        this.raw.exec('COMMIT');
        return r;
      } catch (e) {
        this.raw.exec('ROLLBACK');
        throw e;
      } finally {
        this.depth--;
      }
    }
    const sp = `sp_${this.depth}`;
    this.raw.exec(`SAVEPOINT ${sp}`);
    this.depth++;
    try {
      const r = fn();
      this.raw.exec(`RELEASE ${sp}`);
      return r;
    } catch (e) {
      this.raw.exec(`ROLLBACK TO ${sp}; RELEASE ${sp}`);
      throw e;
    } finally {
      this.depth--;
    }
  }

  private migrate() {
    this.raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
    const done = new Set(this.all<{ id: number }>('SELECT id FROM schema_migrations').map((r) => r.id));
    for (const m of MIGRATIONS) {
      if (done.has(m.id)) continue;
      this.tx(() => {
        this.raw.exec(m.sql);
        this.run('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?,?,?)', m.id, m.name, new Date().toISOString());
      });
    }
  }

  /** Sauvegarde cohérente à chaud (VACUUM INTO). */
  backupTo(file: string) {
    this.raw.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    this.run(`VACUUM INTO ?`, file);
  }

  close() {
    this.raw.close();
  }
}
