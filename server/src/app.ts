import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { Bus, type Services } from './context.js';
import type { Config } from './config.js';
import { openDb, type DB } from './db/db.js';
import { AppError } from './errors.js';
import { registerAuth } from './auth.js';
import { registerRecordRoutes } from './routes/records.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerSocialRoutes } from './routes/social.js';

export interface BuildOptions {
  config: Config;
  /** Use an already-open database (tests). */
  db?: DB;
  logger?: boolean;
}

export async function buildApp({ config, db, logger = false }: BuildOptions): Promise<{ app: FastifyInstance; svc: Services }> {
  const svc: Services = { db: db ?? openDb({ file: config.dbFile }), bus: new Bus(), config };
  const app = Fastify({ logger, bodyLimit: 2 * 1024 * 1024 });

  await app.register(cookie);
  await app.register(multipart);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send({ error: err.code, message: err.message, details: err.details });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'bad_request', message: err.message });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.code(status).send({ error: 'bad_request', message: (err as Error).message });
    }
    req.log.error(err);
    return reply.code(500).send({ error: 'server_error', message: 'Something went wrong on the server' });
  });

  registerAuth(app, svc);
  registerRecordRoutes(app, svc);
  registerAdminRoutes(app, svc);
  registerSocialRoutes(app, svc);

  // The built front end (dist/client). Files are looked up on every request,
  // so a rebuild is picked up without restarting. Browser routes such as
  // /considerations/SH-C01 (no file extension) are answered with index.html.
  const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client');
  await app.register(fastifyStatic, { root: clientDir, wildcard: true });
  app.setNotFoundHandler((req, reply) => {
    const urlPath = req.url.split('?')[0];
    const isPage = req.method === 'GET' && !urlPath.startsWith('/api/') && !path.extname(urlPath);
    if (!isPage || !fs.existsSync(path.join(clientDir, 'index.html'))) {
      return reply.code(404).send({ error: 'not_found', message: 'Not found' });
    }
    return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
  });

  app.addHook('onClose', async () => {
    svc.bus.emit('shutdown');
    if (!db) svc.db.close();
  });

  return { app, svc };
}
