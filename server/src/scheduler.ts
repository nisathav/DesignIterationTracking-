import { write, type Services, type SessionUser } from './context.js';
import { listFlags } from './queries.js';
import { localDate, now, nowIso } from './time.js';

/** Background jobs act as this user; it never matches a real user id. */
export const SYSTEM_USER: SessionUser = { id: 0, name: 'Tracker', email: null, role: 'manager', mustChangePassword: false };

/**
 * Tell the managers once about each open flag that is `days` or more past its
 * due date. Changing the due date re-arms it (see updateFlag).
 */
export function escalateOverdueFlags(svc: Services, days = svc.config.overdueEscalationDays): string[] {
  const limit = new Date(now());
  limit.setDate(limit.getDate() - days);
  const cutoff = localDate(limit);
  const due = svc.db
    .prepare(
      `SELECT f.id FROM flags f JOIN lookup_values fs ON fs.id = f.status_id
       WHERE fs.behaviour <> 'closed' AND f.due_date IS NOT NULL AND f.due_date <= ? AND f.overdue_escalated_at IS NULL`,
    )
    .pluck()
    .all(cutoff) as string[];
  if (!due.length) return [];
  const flags = listFlags(svc.db, { limit: 2000 }, 0).filter((f) => due.includes(f.id));
  write(svc, SYSTEM_USER, (ctx) => {
    const mark = svc.db.prepare('UPDATE flags SET overdue_escalated_at = ? WHERE id = ?');
    for (const f of flags) {
      const late = Math.round((new Date(`${localDate(now())}T00:00:00`).getTime() - new Date(`${f.dueDate}T00:00:00`).getTime()) / 86_400_000);
      ctx.notify(ctx.managers(), {
        kind: 'flag_overdue', entityType: 'flag', entityId: f.id,
        title: `${f.id} is ${late} days overdue (${f.assignedToName}, due ${f.dueDate})`,
        body: f.request,
      });
      mark.run(nowIso(), f.id);
    }
  });
  return flags.map((f) => f.id);
}

/** Runs the periodic jobs while the server is up. */
export function startScheduler(svc: Services, log: (msg: string) => void): () => void {
  const run = () => {
    try {
      const ids = escalateOverdueFlags(svc);
      if (ids.length) log(`Overdue flags reported to managers: ${ids.join(', ')}`);
    } catch (e) {
      log(`Scheduled job failed: ${(e as Error).message}`);
    }
  };
  const first = setTimeout(run, 60_000);
  const hourly = setInterval(run, 3_600_000);
  return () => {
    clearTimeout(first);
    clearInterval(hourly);
  };
}
