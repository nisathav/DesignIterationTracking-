import fs from 'node:fs';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import type { DB } from '../db/db.js';
import { conflict, notFound } from '../errors.js';
import { hashPassword } from '../passwords.js';
import { nowIso } from '../time.js';

// Letters and digits that cannot be mistaken for each other when read aloud or copied.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Temporary password like 'k7mq-x3vd-p9ta'. */
export function generatePassword(): string {
  const group = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `${group()}-${group()}-${group()}`;
}

export interface NewUser {
  name: string;
  email?: string | null;
  role: 'manager' | 'designer';
  /** Omit to generate a temporary password. */
  password?: string;
}

/**
 * Create a user. They must choose their own password at first sign-in.
 * Must run inside a write transaction; hash the password first (async).
 */
export function insertUser(db: DB, u: NewUser, hash: string): number {
  if (db.prepare('SELECT 1 FROM users WHERE name = ?').get(u.name)) throw conflict(`A user called ${u.name} already exists`);
  return Number(db.prepare(
    'INSERT INTO users (name, email, role, password_hash, must_change_password, created_at) VALUES (?, ?, ?, ?, 1, ?)',
  ).run(u.name, u.email ?? null, u.role, hash, nowIso()).lastInsertRowid);
}

export function storePassword(db: DB, userId: number, hash: string, mustChange: boolean): void {
  const r = db.prepare('UPDATE users SET password_hash = ?, must_change_password = ?, version = version + 1 WHERE id = ?')
    .run(hash, mustChange ? 1 : 0, userId);
  if (r.changes === 0) throw notFound('User');
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

/** Audit row for changes made from the server console (no signed-in user). */
export function consoleAudit(db: DB, entityId: number, field: string | null, newValue: string): void {
  db.prepare(
    `INSERT INTO audit_log (batch_id, at, user_id, action, entity_type, entity_id, field, new_value)
     VALUES (?, ?, NULL, ?, 'user', ?, ?, ?)`,
  ).run(`console-${Date.now()}`, nowIso(), field ? 'update' : 'create', String(entityId), field, newValue);
}

/**
 * Give every active user without a password a temporary one (first start).
 * Returns the passwords so they can be shown once and saved to a local file.
 */
export async function issueInitialPasswords(db: DB): Promise<Array<{ name: string; role: string; password: string }>> {
  const users = db.prepare('SELECT id, name, role FROM users WHERE password_hash IS NULL AND active = 1 ORDER BY id').all() as
    Array<{ id: number; name: string; role: string }>;
  const issued = [];
  for (const u of users) {
    const password = generatePassword();
    const hash = await hashPassword(password);
    db.transaction(() => {
      storePassword(db, u.id, hash, true);
      consoleAudit(db, u.id, 'password', '(initial password issued)');
    })();
    issued.push({ name: u.name, role: u.role, password });
  }
  return issued;
}

export function writePasswordSheet(dir: string, rows: Array<{ name: string; role?: string; password: string }>, heading: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'initial-passwords.txt');
  const lines = [
    '',
    `${heading} (${new Date().toLocaleString()})`,
    'Each person must choose their own password when they first sign in. Delete this file once everyone has signed in.',
    ...rows.map((r) => `  ${r.name.padEnd(16)} ${(r.role ?? '').padEnd(10)} ${r.password}`),
  ];
  fs.appendFileSync(file, lines.join('\n') + '\n');
  return file;
}
