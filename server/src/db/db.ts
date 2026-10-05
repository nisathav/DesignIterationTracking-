import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { migrations } from './migrations.js';
import { seed } from './seed.js';

export type DB = Database.Database;

export interface OpenOptions {
  /** File path, or ':memory:' for tests. */
  file: string;
  /** Insert the initial domains, users and lookup values into a new database. */
  seed?: boolean;
}

export function openDb({ file, seed: doSeed = true }: OpenOptions): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  migrate(db);
  if (doSeed) {
    const { n } = db.prepare('SELECT count(*) AS n FROM users').get() as { n: number };
    if (n === 0) db.transaction(() => seed(db))();
  }
  return db;
}

export function migrate(db: DB): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let i = current; i < migrations.length; i++) {
    db.transaction(() => {
      db.exec(migrations[i]);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}
