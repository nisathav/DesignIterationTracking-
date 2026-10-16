import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Services, TeamsEvent } from '../context.js';
import path from 'node:path';
import { requireManager, requireUser } from '../auth.js';
import { badRequest, notFound } from '../errors.js';
import { KEEP_DAYS, listBackups, runBackup } from '../backup.js';
import { sendWeeklyDigest } from '../digest.js';
import { TEAMS_EVENTS, getTeamsSettings, getTeamsStatus, postToTeams, saveTeamsSettings } from '../teams.js';
import { parse } from '../validation.js';

const httpsUrl = z.string().trim().max(2000).refine((u) => u === '' || /^https:\/\/\S+$/i.test(u), 'must start with https://');
const appUrl = z.string().trim().max(300).regex(/^https?:\/\/\S+$/i, 'must be like http://192.168.1.25:8080');

export function registerAlertRoutes(app: FastifyInstance, svc: Services) {
  const { db, config } = svc;

  app.get('/api/admin/teams', async (req) => {
    requireManager(req);
    return { settings: getTeamsSettings(db, config.appUrl), events: TEAMS_EVENTS, lastResult: getTeamsStatus(db) };
  });

  app.put('/api/admin/teams', async (req) => {
    requireManager(req);
    const body = parse(z.object({
      enabled: z.boolean(),
      webhookUrl: httpsUrl,
      appUrl,
      events: z.record(z.string(), z.boolean()),
    }).strict(), req.body);
    if (body.enabled && !body.webhookUrl) throw badRequest('Paste the Teams workflow URL before switching alerts on');
    const current = getTeamsSettings(db, config.appUrl);
    const events = { ...current.events };
    for (const e of TEAMS_EVENTS) if (e.key in body.events) events[e.key] = body.events[e.key];
    saveTeamsSettings(db, { enabled: body.enabled, webhookUrl: body.webhookUrl, appUrl: body.appUrl.replace(/\/$/, ''), events });
    return { settings: getTeamsSettings(db, config.appUrl), events: TEAMS_EVENTS, lastResult: getTeamsStatus(db) };
  });

  /** Post a test card that @mentions the manager, so they can see a mention arrive. */
  app.post('/api/admin/teams/test', async (req) => {
    const me = requireManager(req);
    const settings = getTeamsSettings(db, config.appUrl);
    if (!settings.webhookUrl) throw badRequest('Save the Teams workflow URL first');
    const email = db.prepare('SELECT email FROM users WHERE id = ?').pluck().get(me.id) as string | null;
    try {
      await postToTeams(db, settings, {
        event: 'flag_assigned' as TeamsEvent,
        entityId: 'SH-C01',
        mention: [me.id],
        title: 'Test message from the Design Iteration Tracker',
        text: `{mentions}, Teams alerts are connected. Flags will be posted here and the person they are for is mentioned.${email ? '' : ' (You have no email address in Users, so you were not @mentioned.)'}`,
      });
    } catch (e) {
      throw badRequest(`Teams did not accept the message: ${(e as Error).message}`);
    }
    return { ok: true, lastResult: getTeamsStatus(db) };
  });
}

export function registerMaintenanceRoutes(app: FastifyInstance, svc: Services) {
  const { db, config } = svc;

  app.get('/api/admin/maintenance', async (req) => {
    requireManager(req);
    return {
      backups: listBackups(svc),
      keepDays: KEEP_DAYS,
      backupDir: path.resolve(config.backupDir),
      lastDigestWeek: (db.prepare("SELECT value FROM settings WHERE key = 'digest_week'").pluck().get() as string | undefined) ?? null,
    };
  });

  app.post('/api/admin/backup', async (req) => {
    const me = requireManager(req);
    const b = await runBackup(svc);
    req.log.info(`Backup made by ${me.name}: ${b.file}`);
    return { backup: b, backups: listBackups(svc) };
  });

  /** Send last week's digest now (normally sent automatically on Monday morning). */
  app.post('/api/admin/digest', async (req) => {
    requireManager(req);
    return { sent: sendWeeklyDigest(svc) };
  });

  /** One of my notifications, e.g. a weekly digest to read in full. */
  app.get('/api/notifications/:id', async (req) => {
    const user = requireUser(req);
    const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), req.params);
    const n = db.prepare(
      `SELECT id, kind, entity_type AS entityType, entity_id AS entityId, title, body, is_read AS isRead, created_at AS createdAt
       FROM notifications WHERE id = ? AND user_id = ?`,
    ).get(id, user.id);
    if (!n) throw notFound('Notification');
    db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(id);
    return n;
  });
}
