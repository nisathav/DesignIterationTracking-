import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { write, type Services } from '../context.js';
import { requireUser } from '../auth.js';
import { notFound } from '../errors.js';
import { formatId, peekSeq, scopes } from '../ids.js';
import {
  flagsOfConsideration, flagsOfIteration, getConsideration, getFlag, getIteration, iterationsOf, listConsiderations,
  listFlags, listIterations, spawnedFrom, type ListFilters,
} from '../queries.js';
import {
  considerationCreate, considerationFromFlag, considerationUpdate, entryCreate, flagCreate, flagUpdate, ids,
  iterationCreate, iterationUpdate,
} from '../schemas.js';
import {
  considerationFromFlag as spawnFromFlag, createConsideration, createEntry, createFlag, createIteration,
  reopenIteration, updateConsideration, updateFlag, updateIteration,
} from '../services/records.js';
import { flag, idList, isoDate, parse, strList, version } from '../validation.js';

const listQuery = z.object({
  domain: idList,
  subsystem: idList,
  owner: idList,
  person: idList,
  status: idList,
  statusBehaviour: strList,
  verdict: idList,
  type: idList,
  affectedDomain: idList,
  assignee: idList,
  raisedBy: idList,
  consideration: strList,
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: z.string().trim().max(200).optional(),
  following: flag,
  overdue: flag,
  sort: z.string().max(30).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const idParam = (schema: z.ZodTypeAny) => z.object({ id: schema });

export function registerRecordRoutes(app: FastifyInstance, svc: Services) {
  const { db } = svc;

  // ----- considerations -----
  app.get('/api/considerations', async (req) =>
    listConsiderations(db, parse(listQuery, req.query) as ListFilters, requireUser(req).id));

  app.get('/api/considerations/:id', async (req) => {
    const { id } = parse(idParam(ids.considerationId), req.params);
    const c = getConsideration(db, id);
    if (!c) throw notFound('Consideration');
    const flags = flagsOfConsideration(db, id);
    const iterations = iterationsOf(db, id).map((it) => ({ ...it, flags: flags.filter((f) => f.iterationId === it.id) }));
    return {
      consideration: c,
      originFlag: c.originFlagId ? getFlag(db, c.originFlagId) : null,
      iterations,
      spawned: spawnedFrom(db, flags.map((f) => f.id)),
    };
  });

  app.post('/api/considerations', async (req, reply) => {
    const body = parse(considerationCreate, req.body);
    const id = write(svc, requireUser(req), (ctx) => createConsideration(ctx, body));
    reply.code(201);
    return getConsideration(db, id);
  });

  app.patch('/api/considerations/:id', async (req) => {
    const { id } = parse(idParam(ids.considerationId), req.params);
    const body = parse(considerationUpdate, req.body);
    return write(svc, requireUser(req), (ctx) => updateConsideration(ctx, id, body));
  });

  // ----- iterations -----
  app.get('/api/iterations', async (req) =>
    listIterations(db, parse(listQuery, req.query) as ListFilters, requireUser(req).id));

  app.get('/api/iterations/:id', async (req) => {
    const { id } = parse(idParam(ids.iterationId), req.params);
    const it = getIteration(db, id);
    if (!it) throw notFound('Iteration');
    return { iteration: it, flags: flagsOfIteration(db, id) };
  });

  app.post('/api/iterations', async (req, reply) => {
    const body = parse(iterationCreate, req.body);
    const id = write(svc, requireUser(req), (ctx) => createIteration(ctx, body));
    reply.code(201);
    return getIteration(db, id);
  });

  app.patch('/api/iterations/:id', async (req) => {
    const { id } = parse(idParam(ids.iterationId), req.params);
    const body = parse(iterationUpdate, req.body);
    return write(svc, requireUser(req), (ctx) => updateIteration(ctx, id, body));
  });

  app.post('/api/iterations/:id/reopen', async (req) => {
    const { id } = parse(idParam(ids.iterationId), req.params);
    const body = parse(z.object({ version }).strict(), req.body);
    return write(svc, requireUser(req), (ctx) => reopenIteration(ctx, id, body.version));
  });

  // ----- flags -----
  app.get('/api/flags', async (req) => listFlags(db, parse(listQuery, req.query) as ListFilters, requireUser(req).id));

  app.get('/api/flags/:id', async (req) => {
    const { id } = parse(idParam(ids.flagId), req.params);
    const f = getFlag(db, id);
    if (!f) throw notFound('Flag');
    return {
      flag: f,
      iteration: getIteration(db, f.iterationId),
      resultingConsideration: f.resultingConsiderationId ? getConsideration(db, f.resultingConsiderationId) : null,
    };
  });

  app.post('/api/flags', async (req, reply) => {
    const body = parse(flagCreate, req.body);
    const id = write(svc, requireUser(req), (ctx) => createFlag(ctx, body));
    reply.code(201);
    return getFlag(db, id);
  });

  app.patch('/api/flags/:id', async (req) => {
    const { id } = parse(idParam(ids.flagId), req.params);
    const body = parse(flagUpdate, req.body);
    return write(svc, requireUser(req), (ctx) => updateFlag(ctx, id, body));
  });

  /** Create a consideration from this flag; origin and the flag's result are linked automatically. */
  app.post('/api/flags/:id/consideration', async (req, reply) => {
    const { id } = parse(idParam(ids.flagId), req.params);
    const body = parse(considerationFromFlag, req.body);
    const cid = write(svc, requireUser(req), (ctx) => spawnFromFlag(ctx, id, body));
    reply.code(201);
    return { consideration: getConsideration(db, cid), flag: getFlag(db, id) };
  });

  // ----- combined entry -----
  app.post('/api/entries', async (req, reply) => {
    const body = parse(entryCreate, req.body);
    const result = write(svc, requireUser(req), (ctx) => createEntry(ctx, body));
    reply.code(201);
    return result;
  });

  /** The ID the next record will receive (for "will be ..." hints; the saved ID is authoritative). */
  app.get('/api/ids/next', async (req) => {
    const q = parse(
      z.object({ domainId: z.coerce.number().int().positive().optional(), considerationId: ids.considerationId.optional(), iterationId: ids.iterationId.optional() }),
      req.query,
    );
    const out: Record<string, string> = {};
    if (q.domainId) {
      const code = db.prepare('SELECT code FROM domains WHERE id = ?').pluck().get(q.domainId) as string | undefined;
      if (!code) throw notFound('Domain');
      out.consideration = formatId.consideration(code, peekSeq(db, scopes.consideration(q.domainId)));
    }
    if (q.considerationId) out.iteration = formatId.iteration(q.considerationId, peekSeq(db, scopes.iteration(q.considerationId)));
    if (q.iterationId) out.flag = formatId.flag(q.iterationId, peekSeq(db, scopes.flag(q.iterationId)));
    return out;
  });

  /** Open flags assigned to me (by due date) and flags I raised. */
  app.get('/api/my-items', async (req) => {
    const user = requireUser(req);
    return {
      assigned: listFlags(db, { assignee: [user.id], statusBehaviour: ['open', 'in_progress'], sort: 'due' }, user.id),
      raised: listFlags(db, { raisedBy: [user.id], sort: 'raised', dir: 'desc', limit: 200 }, user.id),
    };
  });
}
