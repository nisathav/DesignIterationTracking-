import { SYSTEM_USER, write, type Services } from './context.js';
import { listFlags } from './queries.js';
import { localDate, now, nowIso } from './time.js';
import { lastBackupDay, runBackup } from './backup.js';
import { digestDue, sendWeeklyDigest } from './digest.js';

export { SYSTEM_USER };

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
      ctx.teams({
        event: 'overdue', entityId: f.id, mention: [f.assignedToId, ...ctx.managers()],
        title: `Overdue by ${late} days: ${f.id}`,
        text: `{mentions}, this ${f.typeLabel} for ${f.assignedToName} was due on ${f.dueDate} (${f.considerationTitle}).`,
        quote: f.request,
      });
      mark.run(nowIso(), f.id);
    }
  });
  return flags.map((f) => f.id);
}

/** Runs the periodic jobs while the server is up: overdue check, nightly backup, weekly digest. */
export function startScheduler(svc: Services, log: (msg: string) => void): () => void {
  let backingUp = false;
  const run = async () => {
    try {
      const ids = escalateOverdueFlags(svc);
      if (ids.length) log(`Overdue flags reported to managers: ${ids.join(', ')}`);
    } catch (e) {
      log(`Overdue check failed: ${(e as Error).message}`);
    }
    // Backup from 02:00, or as soon as the server runs if today's was missed.
    try {
      if (!backingUp && now().getHours() >= 2 && lastBackupDay(svc) !== localDate(now())) {
        backingUp = true;
        const b = await runBackup(svc);
        log(`Backup written: ${b.file} (${Math.round(b.size / 1024)} KB)`);
      }
    } catch (e) {
      log(`Backup failed: ${(e as Error).message}`);
    } finally {
      backingUp = false;
    }
    try {
      if (digestDue(svc)) log(`Weekly digest sent to ${sendWeeklyDigest(svc)} people`);
    } catch (e) {
      log(`Weekly digest failed: ${(e as Error).message}`);
    }
  };
  const first = setTimeout(run, 60_000);
  const every = setInterval(run, 10 * 60_000);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
