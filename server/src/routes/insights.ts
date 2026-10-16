import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Services } from '../context.js';
import { requireUser } from '../auth.js';
import { notFound } from '../errors.js';
import { dashboard, trace } from '../insights.js';
import { ids } from '../schemas.js';
import { parse } from '../validation.js';

export function registerInsightRoutes(app: FastifyInstance, svc: Services) {
  app.get('/api/dashboard', async (req) => {
    requireUser(req);
    return dashboard(svc.db);
  });

  /** The whole chain this consideration belongs to, from its root. */
  app.get('/api/considerations/:id/trace', async (req) => {
    requireUser(req);
    const { id } = parse(z.object({ id: ids.considerationId }), req.params);
    const t = trace(svc.db, id);
    if (!t) throw notFound('Consideration');
    return t;
  });
}
