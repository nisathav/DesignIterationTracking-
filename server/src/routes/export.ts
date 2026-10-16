import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Services } from '../context.js';
import { requireManager } from '../auth.js';
import { buildWorkbook } from '../export.js';
import { importWorkbook } from '../importer.js';
import { badRequest } from '../errors.js';
import { today } from '../time.js';
import { flag, idList, isoDate, parse } from '../validation.js';

export function registerExportRoutes(app: FastifyInstance, svc: Services) {
  /** Manager-only Excel export of considerations, iterations and flags. */
  app.get('/api/export.xlsx', async (req, reply) => {
    const me = requireManager(req);
    const q = parse(z.object({
      domain: idList,
      openOnly: flag,
      comments: flag,
      history: flag,
      historyFrom: isoDate.optional(),
      historyTo: isoDate.optional(),
    }), req.query);
    // Links in the workbook point at the address the manager used to open the tracker.
    const fwdHost = req.headers['x-forwarded-host'];
    const host = (Array.isArray(fwdHost) ? fwdHost[0] : fwdHost) ?? req.headers.host ?? 'localhost:8080';
    const fwdProto = req.headers['x-forwarded-proto'];
    const proto = (Array.isArray(fwdProto) ? fwdProto[0] : fwdProto)?.split(',')[0] ?? 'http';
    const wb = await buildWorkbook(svc.db, {
      domains: q.domain ?? [],
      openOnly: q.openOnly,
      includeComments: q.comments,
      includeHistory: q.history,
      historyFrom: q.historyFrom,
      historyTo: q.historyTo,
      baseUrl: `${proto}://${host}`,
      exportedBy: me.name,
    });
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    req.log.info(`Excel export by ${me.name} (${buffer.length} bytes)`);
    reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="DesignTracker_${today()}.xlsx"`)
      .header('Cache-Control', 'no-store');
    return reply.send(buffer);
  });
}

export function registerImportRoutes(app: FastifyInstance, svc: Services) {
  /**
   * Manager-only import from an .xlsx in the export layout. With ?dryRun=1
   * nothing is saved; the result lists what would be created, skipped and why
   * not. Without it, everything is saved in one go, or nothing if any row has
   * an error.
   */
  app.post('/api/import', async (req) => {
    const me = requireManager(req);
    const q = parse(z.object({ dryRun: flag }), req.query);
    const part = await req.file({ limits: { fileSize: 20 * 1024 * 1024 } });
    if (!part) throw badRequest('Choose an Excel file');
    const buffer = await part.toBuffer();
    const result = await importWorkbook(svc.db, buffer, me, q.dryRun);
    if (!q.dryRun && !result.errors.length) {
      req.log.info(`Excel import by ${me.name}: ${result.created.considerations.length} considerations, ${result.created.iterations.length} iterations, ${result.created.flags.length} flags`);
      svc.bus.emit('activity', { by: me.id, items: [] });
    }
    return result;
  });
}
