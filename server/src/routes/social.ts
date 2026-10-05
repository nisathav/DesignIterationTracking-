import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { write, type ActivityOut, type NotificationOut, type Services, type SessionUser } from '../context.js';
import { requireUser } from '../auth.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { isManager } from '../permissions.js';
import { getConsideration, getFlag, getIteration } from '../queries.js';
import { nowIso } from '../time.js';
import { entityType, flag, id, idList, isoDate, parse, required, strList } from '../validation.js';
import type { DB } from '../db/db.js';

type Entity = 'consideration' | 'iteration' | 'flag';

/** Domain / consideration of a record, for audit rows and feed filters. */
function entityInfo(db: DB, type: Entity, eid: string) {
  if (type === 'consideration') {
    const c = getConsideration(db, eid);
    return c && { domainId: c.domainId, considerationId: c.id, closedIteration: false };
  }
  if (type === 'iteration') {
    const i = getIteration(db, eid);
    return i && { domainId: i.domainId, considerationId: i.considerationId, closedIteration: i.statusBehaviour === 'closed' };
  }
  const f = getFlag(db, eid);
  return f && { domainId: f.sourceDomainId, considerationId: f.considerationId, closedIteration: false };
}

const entityRef = z.object({ entityType, entityId: z.string().trim().toUpperCase().max(40) });

/** Local calendar date -> UTC ISO bound, so feed date filters follow the office clock. */
const localBound = (d: string, end: boolean) => new Date(`${d}T${end ? '23:59:59.999' : '00:00:00'}`).toISOString();

const feedSummary = (event: string, raw: string | null): Record<string, unknown> => {
  if (!raw) return {};
  if (event === 'comment_added') return { text: raw.slice(0, 300) };
  if (!raw.startsWith('{')) return { value: raw };
  const r = JSON.parse(raw);
  switch (event) {
    case 'consideration_created':
      return { title: r.title, ownerName: r.ownerName, subsystemName: r.subsystemName, originFlagId: r.originFlagId };
    case 'iteration_logged':
      return { verdictLabel: r.verdictLabel, verdictBehaviour: r.verdictBehaviour, statusLabel: r.statusLabel, authorName: r.authorName };
    case 'flag_raised':
      return {
        typeLabel: r.typeLabel, assignedToName: r.assignedToName, affectedDomainCode: r.affectedDomainCode,
        affectedDomainColour: r.affectedDomainColour, dueDate: r.dueDate, text: String(r.request ?? '').slice(0, 300),
      };
    default:
      return {};
  }
};

export function registerSocialRoutes(app: FastifyInstance, svc: Services) {
  const { db, bus, config } = svc;

  // ----- comments -----
  app.get('/api/comments', async (req) => {
    const q = parse(entityRef, req.query);
    return db.prepare(
      `SELECT c.id, c.entity_type AS entityType, c.entity_id AS entityId, c.author_id AS authorId, u.name AS authorName,
         c.body, c.created_at AS createdAt
       FROM comments c JOIN users u ON u.id = c.author_id
       WHERE c.entity_type = ? AND c.entity_id = ? ORDER BY c.id`,
    ).all(q.entityType, q.entityId);
  });

  app.post('/api/comments', async (req, reply) => {
    const user = requireUser(req);
    const body = parse(entityRef.extend({ body: required(5000) }).strict(), req.body);
    const cid = write(svc, user, (ctx) => {
      const info = entityInfo(db, body.entityType, body.entityId);
      if (!info) throw notFound(body.entityType);
      const newId = Number(db.prepare('INSERT INTO comments (entity_type, entity_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(body.entityType, body.entityId, user.id, body.body, ctx.at).lastInsertRowid);
      ctx.audit({
        action: 'comment', entityType: body.entityType, entityId: body.entityId, domainId: info.domainId,
        considerationId: info.considerationId, newValue: body.body, event: 'comment_added',
      });
      return newId;
    });
    reply.code(201);
    return db.prepare('SELECT id, entity_type AS entityType, entity_id AS entityId, author_id AS authorId, body, created_at AS createdAt FROM comments WHERE id = ?').get(cid);
  });

  // ----- attachments -----
  const ATT_SELECT = `SELECT a.id, a.entity_type AS entityType, a.entity_id AS entityId, a.kind, a.label, a.url, a.mime,
    a.size, a.uploaded_by AS uploadedBy, u.name AS uploadedByName, a.created_at AS createdAt, a.withdrawn
    FROM attachments a JOIN users u ON u.id = a.uploaded_by`;
  const uploadDir = path.resolve(config.uploadDir);

  app.get('/api/attachments', async (req) => {
    const q = parse(entityRef, req.query);
    return db.prepare(`${ATT_SELECT} WHERE a.entity_type = ? AND a.entity_id = ? AND a.withdrawn = 0 ORDER BY a.id`).all(q.entityType, q.entityId);
  });

  const addAttachment = (user: SessionUser, row: { entityType: Entity; entityId: string; kind: 'file' | 'link'; label: string; url?: string | null; storedName?: string; mime?: string; size?: number }) =>
    write(svc, user, (ctx) => {
      const info = entityInfo(db, row.entityType, row.entityId);
      if (!info) throw notFound(row.entityType);
      if (info.closedIteration) throw conflict('This iteration is closed and read-only. A manager can reopen it.');
      const newId = Number(db.prepare(
        `INSERT INTO attachments (entity_type, entity_id, kind, label, url, stored_name, mime, size, uploaded_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(row.entityType, row.entityId, row.kind, row.label, row.url ?? null, row.storedName ?? null, row.mime ?? null,
        row.size ?? null, user.id, ctx.at).lastInsertRowid);
      ctx.audit({
        action: 'attach', entityType: row.entityType, entityId: row.entityId, domainId: info.domainId,
        considerationId: info.considerationId, field: 'attachment', newValue: row.label,
      });
      return newId;
    });

  /** A link or a network path (\\server\share\...). */
  app.post('/api/attachments/link', async (req, reply) => {
    const user = requireUser(req);
    const body = parse(entityRef.extend({ label: z.string().trim().max(200).default(''), url: required(1000) }).strict(), req.body);
    const aid = addAttachment(user, { ...body, kind: 'link', label: body.label || body.url });
    reply.code(201);
    return db.prepare(`${ATT_SELECT} WHERE a.id = ?`).get(aid);
  });

  /** multipart/form-data with fields entityType, entityId and one file. */
  app.post('/api/attachments/upload', async (req, reply) => {
    const user = requireUser(req);
    const part = await req.file({ limits: { fileSize: config.maxUploadMb * 1024 * 1024 } });
    if (!part) throw badRequest('No file received');
    const fields = Object.fromEntries(
      Object.entries(part.fields).map(([k, v]) => [k, v && typeof v === 'object' && 'value' in v ? (v as { value: unknown }).value : undefined]),
    );
    const ref = parse(entityRef, fields);
    fs.mkdirSync(uploadDir, { recursive: true });
    const storedName = randomUUID();
    const dest = path.join(uploadDir, storedName);
    await pipeline(part.file, fs.createWriteStream(dest));
    if (part.file.truncated) {
      fs.rmSync(dest, { force: true });
      throw badRequest(`File is larger than ${config.maxUploadMb} MB`);
    }
    try {
      const aid = addAttachment(user, {
        ...ref, kind: 'file', label: path.basename(part.filename || 'file').slice(0, 200), storedName,
        mime: part.mimetype, size: fs.statSync(dest).size,
      });
      reply.code(201);
      return db.prepare(`${ATT_SELECT} WHERE a.id = ?`).get(aid);
    } catch (e) {
      fs.rmSync(dest, { force: true });
      throw e;
    }
  });

  app.get('/api/attachments/:id/file', async (req, reply) => {
    const { id: aid } = parse(z.object({ id }), req.params);
    const a = db.prepare('SELECT kind, label, stored_name AS storedName, mime FROM attachments WHERE id = ?').get(aid) as
      { kind: string; label: string; storedName: string | null; mime: string | null } | undefined;
    if (!a || a.kind !== 'file' || !a.storedName) throw notFound('File');
    const file = path.join(uploadDir, a.storedName);
    if (!fs.existsSync(file)) throw notFound('File');
    reply.header('Content-Type', a.mime || 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(a.label)}`);
    return reply.send(fs.createReadStream(file));
  });

  /** Attachments are never deleted, only hidden. */
  app.post('/api/attachments/:id/withdraw', async (req) => {
    const user = requireUser(req);
    const { id: aid } = parse(z.object({ id }), req.params);
    write(svc, user, (ctx) => {
      const a = db.prepare('SELECT entity_type AS entityType, entity_id AS entityId, label, uploaded_by AS uploadedBy, withdrawn FROM attachments WHERE id = ?').get(aid) as
        { entityType: Entity; entityId: string; label: string; uploadedBy: number; withdrawn: number } | undefined;
      if (!a) throw notFound('Attachment');
      if (a.uploadedBy !== user.id && !isManager(user)) throw forbidden('Only the person who added it or a manager can remove it');
      const info = entityInfo(db, a.entityType, a.entityId);
      if (info?.closedIteration) throw conflict('This iteration is closed and read-only. A manager can reopen it.');
      db.prepare('UPDATE attachments SET withdrawn = 1 WHERE id = ?').run(aid);
      ctx.audit({
        action: 'update', entityType: a.entityType, entityId: a.entityId, domainId: info?.domainId,
        considerationId: info?.considerationId, field: 'attachment', oldValue: a.label, newValue: '(removed)',
      });
    });
    return { ok: true };
  });

  // ----- history (audit log of one record) -----
  app.get('/api/history', async (req) => {
    const q = parse(z.object({ entityType: z.string().max(20), entityId: z.string().max(40) }), req.query);
    return db.prepare(
      `SELECT a.id, a.at, a.user_id AS userId, u.name AS userName, a.action, a.field, a.old_value AS oldValue,
         CASE WHEN a.action = 'create' THEN NULL ELSE a.new_value END AS newValue
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.entity_type = ? AND a.entity_id = ? ORDER BY a.id`,
    ).all(q.entityType, q.entityId);
  });

  // ----- notifications -----
  app.get('/api/notifications', async (req) => {
    const user = requireUser(req);
    const q = parse(z.object({ unread: flag, limit: z.coerce.number().int().min(1).max(200).default(50), before: z.coerce.number().int().optional() }), req.query);
    const items = db.prepare(
      `SELECT id, kind, entity_type AS entityType, entity_id AS entityId, title, body, is_read AS isRead, created_at AS createdAt
       FROM notifications WHERE user_id = ? ${q.unread ? 'AND is_read = 0' : ''} ${q.before ? 'AND id < ?' : ''}
       ORDER BY id DESC LIMIT ?`,
    ).all(...[user.id, ...(q.before ? [q.before] : []), q.limit]);
    const unread = db.prepare('SELECT count(*) FROM notifications WHERE user_id = ? AND is_read = 0').pluck().get(user.id);
    return { unread, items };
  });

  app.post('/api/notifications/read', async (req) => {
    const user = requireUser(req);
    const body = parse(z.object({ ids: z.array(id).max(500).optional(), all: z.boolean().optional() }).strict(), req.body);
    if (body.all) db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(user.id);
    else if (body.ids?.length) {
      db.prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ? AND id IN (${body.ids.map(() => '?').join(',')})`).run(user.id, ...body.ids);
    }
    return { unread: db.prepare('SELECT count(*) FROM notifications WHERE user_id = ? AND is_read = 0').pluck().get(user.id) };
  });

  // ----- follows -----
  const followRef = z.object({ entityType: z.enum(['consideration', 'domain']), entityId: z.string().trim().toUpperCase().max(40) }).strict();

  app.get('/api/follows', async (req) => {
    const user = requireUser(req);
    return db.prepare('SELECT entity_type AS entityType, entity_id AS entityId, created_at AS createdAt FROM follows WHERE user_id = ?').all(user.id);
  });

  app.put('/api/follows', async (req) => {
    const user = requireUser(req);
    const body = parse(followRef, req.body);
    const exists = body.entityType === 'domain'
      ? db.prepare('SELECT 1 FROM domains WHERE id = ?').get(Number(body.entityId))
      : db.prepare('SELECT 1 FROM considerations WHERE id = ?').get(body.entityId);
    if (!exists) throw notFound(body.entityType);
    db.prepare('INSERT OR IGNORE INTO follows (user_id, entity_type, entity_id, created_at) VALUES (?, ?, ?, ?)')
      .run(user.id, body.entityType, body.entityId, nowIso());
    return { following: true };
  });

  app.delete('/api/follows', async (req) => {
    const user = requireUser(req);
    const body = parse(followRef, req.query);
    db.prepare('DELETE FROM follows WHERE user_id = ? AND entity_type = ? AND entity_id = ?').run(user.id, body.entityType, body.entityId);
    return { following: false };
  });

  // ----- activity feed (built from the audit log) -----
  app.get('/api/feed', async (req) => {
    const user = requireUser(req);
    const q = parse(z.object({
      domain: idList, person: idList, type: strList, from: isoDate.optional(), to: isoDate.optional(),
      following: flag, consideration: z.string().max(40).optional(),
      before: z.coerce.number().int().optional(), limit: z.coerce.number().int().min(1).max(200).default(50),
    }), req.query);
    const where = ['a.event IS NOT NULL'];
    const params: unknown[] = [];
    if (q.domain) {
      const qs = q.domain.map(() => '?').join(',');
      where.push(`(a.domain_id IN (${qs}) OR (a.entity_type = 'flag' AND a.entity_id IN (SELECT id FROM flags WHERE affected_domain_id IN (${qs}))))`);
      params.push(...q.domain, ...q.domain);
    }
    if (q.person) {
      where.push(`a.user_id IN (${q.person.map(() => '?').join(',')})`);
      params.push(...q.person);
    }
    if (q.type) {
      where.push(`(${q.type.map(() => "(a.event = ? OR a.event LIKE ? || '\\_%' ESCAPE '\\')").join(' OR ')})`);
      for (const t of q.type) params.push(t, t);
    }
    if (q.from) { where.push('a.at >= ?'); params.push(localBound(q.from, false)); }
    if (q.to) { where.push('a.at <= ?'); params.push(localBound(q.to, true)); }
    if (q.consideration) { where.push('a.consideration_id = ?'); params.push(q.consideration); }
    if (q.following) {
      where.push(`(a.domain_id IN (SELECT CAST(entity_id AS INTEGER) FROM follows WHERE user_id = ? AND entity_type = 'domain')
        OR a.consideration_id IN (SELECT entity_id FROM follows WHERE user_id = ? AND entity_type = 'consideration'))`);
      params.push(user.id, user.id);
    }
    if (q.before) { where.push('a.id < ?'); params.push(q.before); }
    const rows = db.prepare(
      `SELECT a.id, a.at, a.event, a.user_id AS userId, u.name AS userName, a.entity_type AS entityType,
         a.entity_id AS entityId, a.domain_id AS domainId, d.code AS domainCode, d.colour AS domainColour,
         a.consideration_id AS considerationId, c.title AS considerationTitle, a.old_value AS oldValue, a.new_value AS newValue
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN domains d ON d.id = a.domain_id
       LEFT JOIN considerations c ON c.id = a.consideration_id
       WHERE ${where.join(' AND ')}
       ORDER BY a.id DESC LIMIT ?`,
    ).all(...params, q.limit) as Array<Record<string, unknown> & { event: string; oldValue: string | null; newValue: string | null }>;
    const items = rows.map(({ oldValue, newValue, ...r }) => ({
      ...r,
      ...(newValue?.startsWith('{') || r.event === 'comment_added' ? feedSummary(r.event, newValue) : { from: oldValue, to: newValue }),
    }));
    const lastVisit = db.prepare('SELECT feed_seen_at FROM users WHERE id = ?').pluck().get(user.id) as string | null;
    return { lastVisit, items };
  });

  /** Remember when the user last looked at the feed ("since my last visit"). */
  app.post('/api/feed/seen', async (req) => {
    const user = requireUser(req);
    const prev = db.prepare('SELECT feed_seen_at FROM users WHERE id = ?').pluck().get(user.id) as string | null;
    db.prepare('UPDATE users SET feed_seen_at = ? WHERE id = ?').run(nowIso(), user.id);
    return { lastVisit: prev };
  });

  // ----- live updates (Server-Sent Events) -----
  app.get('/api/stream', (req, reply) => {
    const user = requireUser(req);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('hello', { userId: user.id });
    const onNotification = (n: NotificationOut) => {
      if (n.userId === user.id) send('notification', n);
    };
    const onActivity = (a: { by: number; items: ActivityOut[] }) => send('activity', a);
    bus.on('notification', onNotification);
    bus.on('activity', onActivity);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    const onShutdown = () => res.end();
    const close = () => {
      clearInterval(ping);
      bus.off('notification', onNotification);
      bus.off('activity', onActivity);
      bus.off('shutdown', onShutdown);
    };
    req.raw.on('close', close);
    bus.on('shutdown', onShutdown);
  });
}
