import type { DB } from './db/db.js';
import { getConsideration, getFlag, iterationsOf, flagsOfIteration, type ConsiderationRow } from './queries.js';
import { localDate, now, today } from './time.js';

// Read-only views built from the records: the dashboard and the trace tree.

export interface DomainStats {
  id: number;
  code: string;
  name: string;
  colour: string;
  ownerName: string | null;
  considerations: number;
  openConsiderations: number;
  iterations: number;
  pass: number;
  conditional: number;
  fail: number;
  noVerdict: number;
  openFlagsRaised: number;
  openFlagsAffecting: number;
  overdueAffecting: number;
  escalated: number;
}

export interface PersonStats {
  id: number;
  name: string;
  role: string;
  openFlags: number;
  reviewsToDo: number;
  overdue: number;
  iterationsAuthored: number;
  iterationsLast30: number;
  flagsRaisedOpen: number;
  considerationsOwnedOpen: number;
  readyToClose: number;
}

export interface Dashboard {
  domains: DomainStats[];
  people: PersonStats[];
  totals: { openFlags: number; overdue: number; escalated: number };
  /** Last 8 weeks, oldest first: Monday of the week, iterations logged, flags raised, flags closed. */
  weeks: Array<{ week: string; iterations: number; flagsRaised: number; flagsClosed: number }>;
}

const OPEN_FLAG = "fs.behaviour <> 'closed'";

export function dashboard(db: DB): Dashboard {
  const t = today();
  const domains = db.prepare(
    `SELECT d.id, d.code, d.name, d.colour, u.name AS ownerName,
       (SELECT count(*) FROM considerations c WHERE c.domain_id = d.id) AS considerations,
       (SELECT count(*) FROM considerations c JOIN lookup_values s ON s.id = c.status_id WHERE c.domain_id = d.id AND s.behaviour = 'open') AS openConsiderations,
       (SELECT count(*) FROM iterations i JOIN considerations c ON c.id = i.consideration_id WHERE c.domain_id = d.id) AS iterations,
       (SELECT count(*) FROM iterations i JOIN considerations c ON c.id = i.consideration_id JOIN lookup_values v ON v.id = i.verdict_id WHERE c.domain_id = d.id AND v.behaviour = 'pass') AS pass,
       (SELECT count(*) FROM iterations i JOIN considerations c ON c.id = i.consideration_id JOIN lookup_values v ON v.id = i.verdict_id WHERE c.domain_id = d.id AND v.behaviour = 'conditional') AS conditional,
       (SELECT count(*) FROM iterations i JOIN considerations c ON c.id = i.consideration_id JOIN lookup_values v ON v.id = i.verdict_id WHERE c.domain_id = d.id AND v.behaviour = 'fail') AS fail,
       (SELECT count(*) FROM iterations i JOIN considerations c ON c.id = i.consideration_id WHERE c.domain_id = d.id AND i.verdict_id IS NULL) AS noVerdict,
       (SELECT count(*) FROM flags f JOIN iterations i ON i.id = f.iteration_id JOIN considerations c ON c.id = i.consideration_id
          JOIN lookup_values fs ON fs.id = f.status_id WHERE c.domain_id = d.id AND ${OPEN_FLAG}) AS openFlagsRaised,
       (SELECT count(*) FROM flags f JOIN lookup_values fs ON fs.id = f.status_id WHERE f.affected_domain_id = d.id AND ${OPEN_FLAG}) AS openFlagsAffecting,
       (SELECT count(*) FROM flags f JOIN lookup_values fs ON fs.id = f.status_id WHERE f.affected_domain_id = d.id AND ${OPEN_FLAG}
          AND f.due_date IS NOT NULL AND f.due_date < @t) AS overdueAffecting,
       (SELECT count(*) FROM flags f JOIN iterations i ON i.id = f.iteration_id JOIN considerations c ON c.id = i.consideration_id
          WHERE (c.domain_id = d.id OR f.affected_domain_id = d.id) AND f.escalated_at IS NOT NULL AND f.escalation_resolved_at IS NULL) AS escalated
     FROM domains d LEFT JOIN users u ON u.id = d.owner_id
     WHERE d.active = 1 OR EXISTS (SELECT 1 FROM considerations c WHERE c.domain_id = d.id)
     ORDER BY d.sort_order, d.code`,
  ).all({ t }) as DomainStats[];

  const since30 = new Date(now());
  since30.setDate(since30.getDate() - 30);
  const people = db.prepare(
    `SELECT u.id, u.name, u.role,
       (SELECT count(*) FROM flags f JOIN lookup_values fs ON fs.id = f.status_id WHERE f.assigned_to_id = u.id AND ${OPEN_FLAG}) AS openFlags,
       (SELECT count(*) FROM flags f JOIN lookup_values fs ON fs.id = f.status_id JOIN lookup_values ft ON ft.id = f.type_id
          WHERE f.assigned_to_id = u.id AND ${OPEN_FLAG} AND ft.behaviour = 'review') AS reviewsToDo,
       (SELECT count(*) FROM flags f JOIN lookup_values fs ON fs.id = f.status_id
          WHERE f.assigned_to_id = u.id AND ${OPEN_FLAG} AND f.due_date IS NOT NULL AND f.due_date < @t) AS overdue,
       (SELECT count(*) FROM iterations i WHERE i.author_id = u.id) AS iterationsAuthored,
       (SELECT count(*) FROM iterations i WHERE i.author_id = u.id AND i.date >= @since) AS iterationsLast30,
       (SELECT count(*) FROM flags f JOIN lookup_values fs ON fs.id = f.status_id WHERE f.raised_by_id = u.id AND ${OPEN_FLAG}) AS flagsRaisedOpen,
       (SELECT count(*) FROM considerations c JOIN lookup_values s ON s.id = c.status_id WHERE c.owner_id = u.id AND s.behaviour = 'open') AS considerationsOwnedOpen,
       (SELECT count(*) FROM iterations i JOIN considerations c ON c.id = i.consideration_id JOIN lookup_values ist ON ist.id = i.status_id
          WHERE c.owner_id = u.id AND ist.behaviour IN ('in_progress','awaiting_review')
            AND EXISTS (SELECT 1 FROM flags f JOIN lookup_values ft ON ft.id = f.type_id WHERE f.iteration_id = i.id AND ft.behaviour = 'review')
            AND NOT EXISTS (SELECT 1 FROM flags f JOIN lookup_values ft ON ft.id = f.type_id JOIN lookup_values fs ON fs.id = f.status_id
              WHERE f.iteration_id = i.id AND ft.behaviour = 'review'
                AND NOT (fs.behaviour = 'closed' AND f.review_outcome IN ('approved','approved_with_comments')))) AS readyToClose
     FROM users u WHERE u.active = 1 ORDER BY u.name`,
  ).all({ t, since: localDate(since30) }) as PersonStats[];

  // Weekly activity, Monday-based weeks.
  const monday = new Date(now());
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const weeks: Dashboard['weeks'] = [];
  const count = (sql: string, a: string, b: string) => db.prepare(sql).pluck().get(a, b) as number;
  for (let w = 7; w >= 0; w--) {
    const start = new Date(monday);
    start.setDate(monday.getDate() - 7 * w);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    const s = localDate(start);
    const e = localDate(end);
    weeks.push({
      week: s,
      iterations: count('SELECT count(*) FROM iterations WHERE date >= ? AND date < ?', s, e),
      flagsRaised: count('SELECT count(*) FROM flags WHERE date_raised >= ? AND date_raised < ?', s, e),
      flagsClosed: count('SELECT count(*) FROM flags WHERE date_closed >= ? AND date_closed < ?', s, e),
    });
  }
  const totals = db.prepare(
    `SELECT count(*) AS openFlags,
       coalesce(sum(CASE WHEN f.due_date IS NOT NULL AND f.due_date < ? THEN 1 ELSE 0 END), 0) AS overdue,
       coalesce(sum(CASE WHEN f.escalated_at IS NOT NULL AND f.escalation_resolved_at IS NULL THEN 1 ELSE 0 END), 0) AS escalated
     FROM flags f JOIN lookup_values fs ON fs.id = f.status_id WHERE ${OPEN_FLAG}`,
  ).get(t) as Dashboard['totals'];
  return { domains, people, totals, weeks };
}

// ---------- trace ----------

export interface TraceNode {
  kind: 'consideration' | 'iteration' | 'flag';
  id: string;
  label: string;
  domainCode: string;
  domainColour: string;
  status: string;
  statusBehaviour: string;
  /** Verdict for iterations, review outcome for flags. */
  tone: string | null;
  toneLabel: string | null;
  sub: string;
  children: TraceNode[];
}

/** Walk up origin flags to the root consideration of a chain. */
export function rootOf(db: DB, considerationId: string): string {
  let id = considerationId;
  const seen = new Set<string>();
  for (;;) {
    if (seen.has(id)) return id;
    seen.add(id);
    const origin = db.prepare('SELECT origin_flag_id FROM considerations WHERE id = ?').pluck().get(id) as string | null | undefined;
    if (!origin) return id;
    const f = getFlag(db, origin);
    if (!f) return id;
    id = f.considerationId;
  }
}

/** Root consideration -> iterations -> flags -> spawned considerations -> ..., across domains. */
export function trace(db: DB, considerationId: string): { root: TraceNode; focus: string } | null {
  if (!getConsideration(db, considerationId)) return null;
  const seen = new Set<string>();
  const build = (c: ConsiderationRow): TraceNode => {
    seen.add(c.id);
    const node: TraceNode = {
      kind: 'consideration', id: c.id, label: c.title, domainCode: c.domainCode, domainColour: c.domainColour,
      status: c.statusLabel, statusBehaviour: c.statusBehaviour, tone: c.latestVerdictBehaviour, toneLabel: c.latestVerdictLabel,
      sub: `${c.ownerName} · ${c.subsystemName}`, children: [],
    };
    for (const it of iterationsOf(db, c.id)) {
      const itNode: TraceNode = {
        kind: 'iteration', id: it.id, label: it.designInput.split('\n')[0].slice(0, 80) || it.id, domainCode: it.domainCode,
        domainColour: it.domainColour, status: it.statusLabel, statusBehaviour: it.statusBehaviour, tone: it.verdictBehaviour,
        toneLabel: it.verdictLabel, sub: `${it.authorName} · ${it.date}`, children: [],
      };
      for (const f of flagsOfIteration(db, it.id)) {
        const fNode: TraceNode = {
          kind: 'flag', id: f.id, label: f.request.split('\n')[0].slice(0, 80), domainCode: f.affectedDomainCode,
          domainColour: f.affectedDomainColour, status: f.statusLabel, statusBehaviour: f.statusBehaviour,
          tone: f.reviewOutcome === 'approved' ? 'pass' : f.reviewOutcome === 'approved_with_comments' ? 'conditional' : f.reviewOutcome === 'changes_needed' ? 'fail' : null,
          toneLabel: f.reviewOutcome ? { approved: 'Approved', approved_with_comments: 'Approved w/ comments', changes_needed: 'Changes needed' }[f.reviewOutcome] : null,
          sub: `${f.typeLabel} → ${f.assignedToName}`, children: [],
        };
        if (f.resultingConsiderationId && !seen.has(f.resultingConsiderationId)) {
          const spawned = getConsideration(db, f.resultingConsiderationId);
          if (spawned) fNode.children.push(build(spawned));
        }
        itNode.children.push(fNode);
      }
      node.children.push(itNode);
    }
    return node;
  };
  const root = getConsideration(db, rootOf(db, considerationId))!;
  return { root: build(root), focus: considerationId };
}

