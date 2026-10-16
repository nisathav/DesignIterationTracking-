import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Services } from '../context.js';
import { requireManager } from '../auth.js';
import { buildWorkbook } from '../export.js';
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
