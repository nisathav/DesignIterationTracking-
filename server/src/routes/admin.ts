import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { write, type Services } from '../context.js';
import { endSessionsOf, password, requireManager, requireUser } from '../auth.js';
import { badRequest, conflict, notFound, stale } from '../errors.js';
import { behaviours, getLookup, listLookups, type LookupCategory } from '../lookups.js';
import { hashPassword } from '../passwords.js';
import { generatePassword, insertUser, storePassword } from '../services/users.js';
import { nowIso } from '../time.js';
import { colour, id, parse, required, version } from '../validation.js';

const USER_SELECT = `SELECT id, name, email, role, active, must_change_password AS mustChangePassword,
  password_hash IS NOT NULL AS hasPassword, created_at AS createdAt, version FROM users`;
const DOMAIN_SELECT = `SELECT d.id, d.code, d.name, d.owner_id AS ownerId, u.name AS ownerName, d.colour,
  d.sort_order AS sortOrder, d.active, d.version,
  EXISTS (SELECT 1 FROM counters WHERE scope = 'C:' || d.id) AS used
  FROM domains d LEFT JOIN users u ON u.id = d.owner_id`;
const SUB_SELECT = `SELECT id, domain_id AS domainId, name, sort_order AS sortOrder, active, version FROM subsystems`;

const email = z.union([z.literal(''), z.string().trim().email().max(200)]).nullish().transform((v) => v || null);
const role = z.enum(['manager', 'designer']);
const code = z.string().trim().toUpperCase().regex(/^[A-Z]{2,3}$/, 'must be 2-3 letters');
const categories = Object.keys(behaviours) as [LookupCategory, ...LookupCategory[]];

export function registerAdminRoutes(app: FastifyInstance, svc: Services) {
  const { db } = svc;
  const getUser = (uid: number) => db.prepare(`${USER_SELECT} WHERE id = ?`).get(uid) as
    { id: number; name: string; email: string | null; role: string; active: number; version: number } | undefined;
  const getDomain = (did: number) => db.prepare(`${DOMAIN_SELECT} WHERE d.id = ?`).get(did) as
    { id: number; code: string; name: string; ownerId: number | null; ownerName: string | null; colour: string; sortOrder: number; active: number; version: number; used: number } | undefined;
  const getSub = (sid: number) => db.prepare(`${SUB_SELECT} WHERE id = ?`).get(sid) as
    { id: number; domainId: number; name: string; sortOrder: number; active: number; version: number } | undefined;

  /** Everything the forms need for dropdowns, in one call. */
  app.get('/api/meta', async (req) => {
    const user = requireUser(req);
    return {
      domains: db.prepare(`${DOMAIN_SELECT} ORDER BY d.sort_order, d.code`).all(),
      subsystems: db.prepare(`${SUB_SELECT} ORDER BY domain_id, sort_order, name`).all(),
      users: db.prepare(`SELECT id, name, email, role, active FROM users ORDER BY name`).all(),
      lookups: listLookups(db),
      follows: db.prepare('SELECT entity_type AS entityType, entity_id AS entityId FROM follows WHERE user_id = ?').all(user.id),
    };
  });

  // ----- users -----
  app.get('/api/users', async (req) => {
    requireManager(req);
    return db.prepare(`${USER_SELECT} ORDER BY name`).all();
  });

  /** Create a user. Without a password, a temporary one is generated and returned once. */
  app.post('/api/users', async (req, reply) => {
    const me = requireManager(req);
    const body = parse(z.object({ name: required(80), email, role: role.default('designer'), password: password.optional() }).strict(), req.body);
    const temporaryPassword = body.password ?? generatePassword();
    const hash = await hashPassword(temporaryPassword);
    const uid = write(svc, me, (ctx) => {
      const newId = insertUser(db, body, hash);
      ctx.audit({ action: 'create', entityType: 'user', entityId: newId, newValue: { name: body.name, email: body.email, role: body.role } });
      return newId;
    });
    reply.code(201);
    return { user: getUser(uid), temporaryPassword };
  });

  app.patch('/api/users/:id', async (req) => {
    const me = requireManager(req);
    const { id: uid } = parse(z.object({ id }), req.params);
    const body = parse(z.object({ version, name: required(80).optional(), email, role: role.optional(), active: z.boolean().optional() }).strict(), req.body);
    return write(svc, me, (ctx) => {
      const u = getUser(uid);
      if (!u) throw notFound('User');
      if (u.version !== body.version) throw stale(u);
      const next = {
        name: body.name ?? u.name,
        email: body.email === undefined ? u.email : body.email,
        role: body.role ?? u.role,
        active: body.active === undefined ? u.active : body.active ? 1 : 0,
      };
      if (next.name !== u.name && db.prepare('SELECT 1 FROM users WHERE name = ? AND id <> ?').get(next.name, uid)) {
        throw conflict(`A user called ${next.name} already exists`);
      }
      if (u.role === 'manager' && (next.role !== 'manager' || !next.active)) {
        const others = db.prepare("SELECT count(*) FROM users WHERE role = 'manager' AND active = 1 AND id <> ?").pluck().get(uid) as number;
        if (others === 0) throw conflict('There must be at least one active manager');
      }
      db.prepare('UPDATE users SET name = ?, email = ?, role = ?, active = ?, version = version + 1 WHERE id = ?')
        .run(next.name, next.email, next.role, next.active, uid);
      ctx.auditChanges({ entityType: 'user', entityId: uid }, {
        name: [u.name, next.name], email: [u.email, next.email], role: [u.role, next.role], active: [u.active, next.active],
      });
      if (!next.active) endSessionsOf(db, uid);
      return getUser(uid);
    });
  });

  /**
   * Manager sets a temporary password (generated when none is given and
   * returned once); the user must change it at next sign-in.
   */
  app.post('/api/users/:id/password', async (req) => {
    const me = requireManager(req);
    const { id: uid } = parse(z.object({ id }), req.params);
    const body = parse(z.object({ password: password.optional() }).strict(), req.body ?? {});
    const temporaryPassword = body.password ?? generatePassword();
    const hash = await hashPassword(temporaryPassword);
    write(svc, me, (ctx) => {
      if (!getUser(uid)) throw notFound('User');
      storePassword(db, uid, hash, uid !== me.id);
      ctx.audit({ action: 'update', entityType: 'user', entityId: uid, field: 'password', newValue: '(reset)' });
    });
    return { user: getUser(uid), temporaryPassword };
  });

  // ----- domains -----
  app.post('/api/domains', async (req, reply) => {
    const me = requireManager(req);
    const body = parse(z.object({ code, name: required(120), ownerId: id.nullish(), colour }).strict(), req.body);
    const did = write(svc, me, (ctx) => {
      if (db.prepare('SELECT 1 FROM domains WHERE code = ?').get(body.code)) throw conflict(`Domain code ${body.code} already exists`);
      if (body.ownerId && !getUser(body.ownerId)?.active) throw badRequest('Owner must be an active user');
      const order = (db.prepare('SELECT coalesce(max(sort_order), 0) + 1 FROM domains').pluck().get() as number);
      const newId = Number(db.prepare('INSERT INTO domains (code, name, owner_id, colour, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(body.code, body.name, body.ownerId ?? null, body.colour, order, nowIso()).lastInsertRowid);
      if (body.ownerId) ctx.follow(body.ownerId, 'domain', newId);
      ctx.audit({ action: 'create', entityType: 'domain', entityId: newId, domainId: newId, newValue: body });
      return newId;
    });
    reply.code(201);
    return getDomain(did);
  });

  app.patch('/api/domains/:id', async (req) => {
    const me = requireManager(req);
    const { id: did } = parse(z.object({ id }), req.params);
    const body = parse(z.object({
      version, code: code.optional(), name: required(120).optional(), ownerId: id.nullish(), colour: colour.optional(),
      sortOrder: z.number().int().optional(), active: z.boolean().optional(),
    }).strict(), req.body);
    return write(svc, me, (ctx) => {
      const d = getDomain(did);
      if (!d) throw notFound('Domain');
      if (d.version !== body.version) throw stale(d);
      if (body.code && body.code !== d.code) {
        // The code is part of every record ID, so it is frozen once a consideration has used it.
        if (d.used) throw conflict(`Domain code ${d.code} has been used in IDs and can no longer change`);
        if (db.prepare('SELECT 1 FROM domains WHERE code = ? AND id <> ?').get(body.code, did)) throw conflict(`Domain code ${body.code} already exists`);
      }
      const next = {
        code: body.code ?? d.code, name: body.name ?? d.name,
        ownerId: body.ownerId === undefined ? d.ownerId : body.ownerId, colour: body.colour ?? d.colour,
        sortOrder: body.sortOrder ?? d.sortOrder, active: body.active === undefined ? d.active : body.active ? 1 : 0,
      };
      if (next.ownerId !== d.ownerId && next.ownerId && !getUser(next.ownerId)?.active) throw badRequest('Owner must be an active user');
      db.prepare('UPDATE domains SET code = ?, name = ?, owner_id = ?, colour = ?, sort_order = ?, active = ?, version = version + 1 WHERE id = ?')
        .run(next.code, next.name, next.ownerId, next.colour, next.sortOrder, next.active, did);
      if (next.ownerId && next.ownerId !== d.ownerId) ctx.follow(next.ownerId, 'domain', did);
      ctx.auditChanges({ entityType: 'domain', entityId: did, domainId: did }, {
        code: [d.code, next.code], name: [d.name, next.name],
        owner: [d.ownerName, next.ownerId ? getUser(next.ownerId)?.name : null],
        colour: [d.colour, next.colour], sortOrder: [d.sortOrder, next.sortOrder], active: [d.active, next.active],
      });
      return getDomain(did);
    });
  });

  // ----- sub-systems -----
  app.post('/api/domains/:id/subsystems', async (req, reply) => {
    const me = requireManager(req);
    const { id: did } = parse(z.object({ id }), req.params);
    const body = parse(z.object({ name: required(120) }).strict(), req.body);
    const sid = write(svc, me, (ctx) => {
      if (!getDomain(did)) throw notFound('Domain');
      if (db.prepare('SELECT 1 FROM subsystems WHERE domain_id = ? AND name = ?').get(did, body.name)) {
        throw conflict(`${body.name} already exists in this domain`);
      }
      const order = db.prepare('SELECT coalesce(max(sort_order), 0) + 1 FROM subsystems WHERE domain_id = ?').pluck().get(did) as number;
      const newId = Number(db.prepare('INSERT INTO subsystems (domain_id, name, sort_order) VALUES (?, ?, ?)').run(did, body.name, order).lastInsertRowid);
      ctx.audit({ action: 'create', entityType: 'subsystem', entityId: newId, domainId: did, newValue: body.name });
      return newId;
    });
    reply.code(201);
    return getSub(sid);
  });

  app.patch('/api/subsystems/:id', async (req) => {
    const me = requireManager(req);
    const { id: sid } = parse(z.object({ id }), req.params);
    const body = parse(z.object({ version, name: required(120).optional(), sortOrder: z.number().int().optional(), active: z.boolean().optional() }).strict(), req.body);
    return write(svc, me, (ctx) => {
      const s = getSub(sid);
      if (!s) throw notFound('Sub-system');
      if (s.version !== body.version) throw stale(s);
      const next = { name: body.name ?? s.name, sortOrder: body.sortOrder ?? s.sortOrder, active: body.active === undefined ? s.active : body.active ? 1 : 0 };
      if (next.name !== s.name && db.prepare('SELECT 1 FROM subsystems WHERE domain_id = ? AND name = ? AND id <> ?').get(s.domainId, next.name, sid)) {
        throw conflict(`${next.name} already exists in this domain`);
      }
      db.prepare('UPDATE subsystems SET name = ?, sort_order = ?, active = ?, version = version + 1 WHERE id = ?').run(next.name, next.sortOrder, next.active, sid);
      ctx.auditChanges({ entityType: 'subsystem', entityId: sid, domainId: s.domainId }, {
        name: [s.name, next.name], sortOrder: [s.sortOrder, next.sortOrder], active: [s.active, next.active],
      });
      return getSub(sid);
    });
  });

  // ----- lookup values -----
  app.post('/api/lookups', async (req, reply) => {
    const me = requireManager(req);
    const body = parse(z.object({
      category: z.enum(categories), label: required(60), behaviour: z.string(), colour: colour.nullish(),
    }).strict(), req.body);
    if (!behaviours[body.category].includes(body.behaviour)) {
      throw badRequest(`behaviour must be one of: ${behaviours[body.category].join(', ')}`);
    }
    const lid = write(svc, me, (ctx) => {
      if (db.prepare('SELECT 1 FROM lookup_values WHERE category = ? AND label = ?').get(body.category, body.label)) {
        throw conflict(`'${body.label}' already exists`);
      }
      const order = db.prepare('SELECT coalesce(max(sort_order), 0) + 1 FROM lookup_values WHERE category = ?').pluck().get(body.category) as number;
      const newId = Number(db.prepare('INSERT INTO lookup_values (category, label, behaviour, colour, sort_order) VALUES (?, ?, ?, ?, ?)')
        .run(body.category, body.label, body.behaviour, body.colour ?? null, order).lastInsertRowid);
      ctx.audit({ action: 'create', entityType: 'lookup', entityId: newId, newValue: body });
      return newId;
    });
    reply.code(201);
    return getLookup(db, lid);
  });

  /** Label, colour, order, active and default can change; the behaviour cannot. */
  app.patch('/api/lookups/:id', async (req) => {
    const me = requireManager(req);
    const { id: lid } = parse(z.object({ id }), req.params);
    const body = parse(z.object({
      version, label: required(60).optional(), colour: colour.nullish(), sortOrder: z.number().int().optional(),
      active: z.boolean().optional(), isDefault: z.boolean().optional(),
    }).strict(), req.body);
    return write(svc, me, (ctx) => {
      const l = getLookup(db, lid);
      if (!l) throw notFound('Value');
      if (l.version !== body.version) throw stale(l);
      const next = {
        label: body.label ?? l.label, colour: body.colour === undefined ? l.colour : body.colour,
        sortOrder: body.sortOrder ?? l.sortOrder, active: body.active === undefined ? l.active : body.active ? 1 : 0,
        isDefault: body.isDefault === undefined ? l.isDefault : body.isDefault ? 1 : 0,
      };
      if (next.label !== l.label && db.prepare('SELECT 1 FROM lookup_values WHERE category = ? AND label = ? AND id <> ?').get(l.category, next.label, lid)) {
        throw conflict(`'${next.label}' already exists`);
      }
      if (next.isDefault && !next.active) throw badRequest('The default value must be active');
      if (next.isDefault) db.prepare('UPDATE lookup_values SET is_default = 0 WHERE category = ? AND id <> ?').run(l.category, lid);
      db.prepare('UPDATE lookup_values SET label = ?, colour = ?, sort_order = ?, active = ?, is_default = ?, version = version + 1 WHERE id = ?')
        .run(next.label, next.colour, next.sortOrder, next.active, next.isDefault, lid);
      ctx.auditChanges({ entityType: 'lookup', entityId: lid }, {
        label: [l.label, next.label], colour: [l.colour, next.colour], sortOrder: [l.sortOrder, next.sortOrder],
        active: [l.active, next.active], isDefault: [l.isDefault, next.isDefault],
      });
      return getLookup(db, lid);
    });
  });

}
