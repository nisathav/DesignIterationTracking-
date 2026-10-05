import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { DB } from './db/db.js';
import type { Services, SessionUser } from './context.js';
import { write } from './context.js';
import { AppError, badRequest, forbidden, unauthorized } from './errors.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { now, nowIso } from './time.js';
import { parse, required } from './validation.js';

export const SESSION_COOKIE = 'dit_session';
export const password = z.string().min(8, 'must be at least 8 characters').max(200);

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

const DAY = 86_400_000;

export function createSession(db: DB, userId: number, days: number): string {
  const sid = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(sid, userId, nowIso(), new Date(now().getTime() + days * DAY).toISOString());
  return sid;
}

/** Resolve a session cookie; sessions are extended while in use. */
export function loadSession(db: DB, sid: string | undefined, days: number): SessionUser | null {
  if (!sid) return null;
  const row = db
    .prepare(
      `SELECT s.expires_at AS expiresAt, u.id, u.name, u.email, u.role, u.must_change_password AS mcp
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND u.active = 1`,
    )
    .get(sid) as { expiresAt: string; id: number; name: string; email: string | null; role: 'manager' | 'designer'; mcp: number } | undefined;
  if (!row) return null;
  const t = now().getTime();
  const exp = new Date(row.expiresAt).getTime();
  if (exp <= t) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
    return null;
  }
  if (exp - t < (days * DAY) / 2) {
    db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(new Date(t + days * DAY).toISOString(), sid);
  }
  return { id: row.id, name: row.name, email: row.email, role: row.role, mustChangePassword: !!row.mcp };
}

export function endSessionsOf(db: DB, userId: number, except?: string): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id IS NOT ?').run(userId, except ?? null);
}

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function requireManager(req: FastifyRequest): SessionUser {
  const u = requireUser(req);
  if (u.role !== 'manager') throw forbidden('Only a manager can do this');
  return u;
}

// Paths reachable without a session, or while a password change is pending.
const PUBLIC = new Set(['/api/auth/login', '/api/setup']);
const PASSWORD_PENDING_OK = new Set(['/api/auth/me', '/api/auth/logout', '/api/auth/password']);

// Simple brute-force brake: 10 failures per name per 15 minutes.
const failures = new Map<string, number[]>();
function tooManyFailures(name: string): boolean {
  const cutoff = Date.now() - 15 * 60_000;
  const list = (failures.get(name) ?? []).filter((t) => t > cutoff);
  failures.set(name, list);
  return list.length >= 10;
}

export function registerAuth(app: FastifyInstance, svc: Services) {
  const { db, config } = svc;
  const cookieOpts = { path: '/', httpOnly: true, sameSite: 'lax' as const, maxAge: config.sessionDays * 86_400 };

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    req.user = loadSession(db, req.cookies[SESSION_COOKIE], config.sessionDays);
    const path = req.url.split('?')[0];
    if (PUBLIC.has(path)) return;
    if (!req.user) throw unauthorized();
    if (req.user.mustChangePassword && !PASSWORD_PENDING_OK.has(path)) {
      throw new AppError(403, 'password_change_required', 'Please choose a new password first');
    }
  });

  const login = (reply: FastifyReply, userId: number) => {
    const sid = createSession(db, userId, config.sessionDays);
    reply.setCookie(SESSION_COOKIE, sid, cookieOpts);
    return loadSession(db, sid, config.sessionDays)!;
  };

  /** First run: no manager has a password yet. */
  const needsSetup = () =>
    !db.prepare("SELECT 1 FROM users WHERE role = 'manager' AND active = 1 AND password_hash IS NOT NULL").get();

  app.get('/api/setup', async () => {
    const manager = db.prepare("SELECT name FROM users WHERE role = 'manager' ORDER BY id LIMIT 1").pluck().get() as string | undefined;
    return { needsSetup: needsSetup(), managerName: manager ?? null };
  });

  app.post('/api/setup', async (req, reply) => {
    const body = parse(z.object({ name: required(80), password }).strict(), req.body);
    const hash = await hashPassword(body.password);
    // Re-check inside a write transaction so two first-run submissions cannot both win.
    const userId = db.transaction(() => {
      if (!needsSetup()) throw forbidden('Setup has already been completed');
      const existing = db.prepare("SELECT id FROM users WHERE role = 'manager' ORDER BY id LIMIT 1").pluck().get() as number | undefined;
      if (existing) {
        const clash = db.prepare('SELECT id FROM users WHERE name = ? AND id <> ?').get(body.name, existing);
        if (clash) throw badRequest(`The name ${body.name} is already used by another user`);
        db.prepare('UPDATE users SET name = ?, password_hash = ?, must_change_password = 0, active = 1, version = version + 1 WHERE id = ?')
          .run(body.name, hash, existing);
        return existing;
      }
      return Number(db.prepare("INSERT INTO users (name, role, password_hash, created_at) VALUES (?, 'manager', ?, ?)")
        .run(body.name, hash, nowIso()).lastInsertRowid);
    }).immediate();
    return login(reply, userId);
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = parse(z.object({ name: required(80), password: z.string().max(200) }).strict(), req.body);
    const key = body.name.toLowerCase();
    if (tooManyFailures(key)) throw new AppError(429, 'too_many_attempts', 'Too many failed attempts. Try again in 15 minutes.');
    const u = db.prepare('SELECT id, password_hash AS hash, active FROM users WHERE name = ?').get(body.name) as
      { id: number; hash: string | null; active: number } | undefined;
    if (u && u.active && !u.hash) {
      throw new AppError(401, 'no_password', 'No password has been set for you yet. Ask the manager to set one.');
    }
    if (!u || !u.active || !(await verifyPassword(body.password, u.hash))) {
      failures.get(key)!.push(Date.now());
      throw new AppError(401, 'bad_login', 'Name or password is wrong');
    }
    failures.delete(key);
    return login(reply, u.id);
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const sid = req.cookies[SESSION_COOKIE];
    if (sid) db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => requireUser(req));

  /** Change own password. The current password is not asked for after a reset. */
  app.post('/api/auth/password', async (req) => {
    const user = requireUser(req);
    const body = parse(z.object({ currentPassword: z.string().max(200).optional(), newPassword: password }).strict(), req.body);
    const hash = db.prepare('SELECT password_hash FROM users WHERE id = ?').pluck().get(user.id) as string | null;
    if (!user.mustChangePassword && !(await verifyPassword(body.currentPassword ?? '', hash))) {
      throw badRequest('Current password is wrong');
    }
    const newHash = await hashPassword(body.newPassword);
    write(svc, user, (ctx) => {
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, version = version + 1 WHERE id = ?')
        .run(newHash, user.id);
      ctx.audit({ action: 'update', entityType: 'user', entityId: user.id, field: 'password', oldValue: null, newValue: '(changed)' });
    });
    endSessionsOf(db, user.id, req.cookies[SESSION_COOKIE]);
    return { ok: true };
  });
}
