import { SYSTEM_USER, write, type Services } from './context.js';
import { localDate, now } from './time.js';

// Weekly summary per person of the domains and considerations they follow,
// plus what is waiting on them. Stored as an in-app notification (and
// emailed by the mailer when SMTP is set up).

interface Row {
  event: string;
  entityId: string;
  considerationId: string | null;
  title: string | null;
  newValue: string | null;
}

const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** Monday 00:00 of the week containing `d`. */
export function weekStart(d: Date): Date {
  const m = new Date(d);
  m.setHours(0, 0, 0, 0);
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}

export function buildDigest(svc: Services, userId: number, from: Date, to: Date): { title: string; body: string } | null {
  const { db } = svc;
  const rows = db.prepare(
    `SELECT a.event, a.entity_id AS entityId, a.consideration_id AS considerationId, c.title, a.new_value AS newValue
     FROM audit_log a LEFT JOIN considerations c ON c.id = a.consideration_id
     WHERE a.event IS NOT NULL AND a.at >= ? AND a.at < ?
       AND (a.domain_id IN (SELECT CAST(entity_id AS INTEGER) FROM follows WHERE user_id = ? AND entity_type = 'domain')
         OR a.consideration_id IN (SELECT entity_id FROM follows WHERE user_id = ? AND entity_type = 'consideration'))
     ORDER BY a.id`,
  ).all(from.toISOString(), to.toISOString(), userId, userId) as Row[];

  const t = localDate(now());
  const waiting = db.prepare(
    `SELECT count(*) AS open, sum(CASE WHEN f.due_date IS NOT NULL AND f.due_date < ? THEN 1 ELSE 0 END) AS overdue
     FROM flags f JOIN lookup_values fs ON fs.id = f.status_id WHERE f.assigned_to_id = ? AND fs.behaviour <> 'closed'`,
  ).get(t, userId) as { open: number; overdue: number | null };

  if (!rows.length && !waiting.open) return null;

  const count = (e: string, pred?: (r: Row) => boolean) => rows.filter((r) => r.event === e && (!pred || pred(r))).length;
  const verdict = (r: Row, v: string) => !!r.newValue && r.newValue.includes(`"verdictLabel":"${v}"`);
  const lines: string[] = [];
  lines.push(`Week ${fmt(from)} to ${fmt(new Date(to.getTime() - 1))}, in the domains and considerations you follow:`);
  const totals: Array<[number, string]> = [
    [count('consideration_created'), 'new considerations'],
    [count('iteration_logged'), `iterations logged (${count('iteration_logged', (r) => verdict(r, 'Pass'))} Pass, ${count('iteration_logged', (r) => verdict(r, 'Conditional Pass'))} Conditional, ${count('iteration_logged', (r) => verdict(r, 'Fail'))} Fail)`],
    [count('flag_raised'), 'flags raised'],
    [count('flag_review', (r) => r.newValue?.startsWith('Approved') ?? false), 'reviews approved'],
    [count('flag_review', (r) => r.newValue === 'Changes needed'), 'reviews with changes needed'],
    [count('flag_status', (r) => r.newValue === 'Closed'), 'flags closed'],
    [count('flag_escalated'), 'escalations'],
  ];
  for (const [n, label] of totals) if (n) lines.push(`- ${n} ${label}`);
  if (!rows.length) lines.push('- No activity this week.');

  const byCons = new Map<string, { title: string; n: number }>();
  for (const r of rows) {
    if (!r.considerationId) continue;
    const e = byCons.get(r.considerationId) ?? { title: r.title ?? '', n: 0 };
    e.n++;
    byCons.set(r.considerationId, e);
  }
  const busiest = [...byCons.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8);
  if (busiest.length) {
    lines.push('', 'Most active:');
    for (const [id, e] of busiest) lines.push(`- ${id} ${e.title} (${e.n} update${e.n > 1 ? 's' : ''})`);
  }
  if (waiting.open) {
    lines.push('', `Waiting on you: ${waiting.open} open flag${waiting.open > 1 ? 's' : ''}${waiting.overdue ? `, ${waiting.overdue} overdue` : ''}. See My items.`);
  }
  return { title: `Weekly digest: ${fmt(from)} to ${fmt(new Date(to.getTime() - 1))}`, body: lines.join('\n') };
}

/** Send the digest for the week that just ended to everyone. Returns how many were sent. */
export function sendWeeklyDigest(svc: Services): number {
  const end = weekStart(now());
  const start = new Date(end);
  start.setDate(end.getDate() - 7);
  const users = svc.db.prepare('SELECT id FROM users WHERE active = 1').pluck().all() as number[];
  let sent = 0;
  write(svc, SYSTEM_USER, (ctx) => {
    for (const uid of users) {
      const d = buildDigest(svc, uid, start, end);
      if (!d) continue;
      ctx.notify([uid], { kind: 'digest', entityType: null, entityId: null, title: d.title, body: d.body });
      sent++;
    }
  });
  svc.db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('digest_week', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .run(localDate(end), new Date().toISOString());
  return sent;
}

/** Monday from 07:00 (or later that week, if the PC was off): send once per week. */
export function digestDue(svc: Services): boolean {
  const n = now();
  const week = localDate(weekStart(n));
  const last = svc.db.prepare("SELECT value FROM settings WHERE key = 'digest_week'").pluck().get() as string | undefined;
  if (last === week) return false;
  const isMonday = n.getDay() === 1;
  return !isMonday || n.getHours() >= 7;
}
