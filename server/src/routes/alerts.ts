import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Services, TeamsEvent } from '../context.js';
import { requireManager } from '../auth.js';
import { badRequest } from '../errors.js';
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
