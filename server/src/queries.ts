import type { DB } from './db/db.js';
import { today } from './time.js';

// Read models: rows joined with the display fields the UI needs
// (names, labels, behaviours and domain colours).

export interface ConsiderationRow {
  id: string;
  seq: number;
  domainId: number;
  domainCode: string;
  domainName: string;
  domainColour: string;
  subsystemId: number;
  subsystemName: string;
  title: string;
  targetMetric: string;
  ownerId: number;
  ownerName: string;
  originFlagId: string | null;
  statusId: number;
  statusLabel: string;
  statusBehaviour: string;
  notes: string;
  createdBy: number;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  iterationCount: number;
  latestIterationId: string | null;
  latestVerdictLabel: string | null;
  latestVerdictBehaviour: string | null;
  openFlagCount: number;
  lastActivityAt: string | null;
}

export interface IterationRow {
  id: string;
  seq: number;
  considerationId: string;
  considerationTitle: string;
  targetMetric: string;
  domainId: number;
  domainCode: string;
  domainColour: string;
  subsystemId: number;
  subsystemName: string;
  considerationOwnerId: number;
  parentIterationId: string | null;
  parentFlagId: string | null;
  date: string;
  authorId: number;
  authorName: string;
  designInput: string;
  cadDesign: string;
  analyticalResults: string;
  simulationResults: string;
  evidenceLink: string;
  verdictId: number | null;
  verdictLabel: string | null;
  verdictBehaviour: string | null;
  statusId: number;
  statusLabel: string;
  statusBehaviour: string;
  nextAction: string;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
  version: number;
  flagCount: number;
  openFlagCount: number;
}

export interface FlagRow {
  id: string;
  seq: number;
  iterationId: string;
  considerationId: string;
  considerationTitle: string;
  sourceDomainId: number;
  sourceDomainCode: string;
  sourceDomainColour: string;
  sourceSubsystemName: string;
  sourceTargetMetric: string;
  sourceVerdictLabel: string | null;
  sourceVerdictBehaviour: string | null;
  raisedById: number;
  raisedByName: string;
  dateRaised: string;
  typeId: number;
  typeLabel: string;
  typeBehaviour: string;
  assignedToId: number;
  assignedToName: string;
  affectedDomainId: number;
  affectedDomainCode: string;
  affectedDomainName: string;
  affectedDomainColour: string;
  request: string;
  dueDate: string | null;
  statusId: number;
  statusLabel: string;
  statusBehaviour: string;
  response: string;
  resultingConsiderationId: string | null;
  dateClosed: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  overdue: boolean;
}

const CONS_SELECT = `
SELECT c.id, c.seq, c.domain_id AS domainId, d.code AS domainCode, d.name AS domainName, d.colour AS domainColour,
  c.subsystem_id AS subsystemId, s.name AS subsystemName, c.title, c.target_metric AS targetMetric,
  c.owner_id AS ownerId, o.name AS ownerName, c.origin_flag_id AS originFlagId,
  c.status_id AS statusId, st.label AS statusLabel, st.behaviour AS statusBehaviour,
  c.notes, c.created_by AS createdBy, cb.name AS createdByName, c.created_at AS createdAt,
  c.updated_at AS updatedAt, c.version,
  (SELECT count(*) FROM iterations i WHERE i.consideration_id = c.id) AS iterationCount,
  li.id AS latestIterationId, lv.label AS latestVerdictLabel, lv.behaviour AS latestVerdictBehaviour,
  (SELECT count(*) FROM flags f JOIN iterations fi ON fi.id = f.iteration_id
     JOIN lookup_values fs ON fs.id = f.status_id
   WHERE fi.consideration_id = c.id AND fs.behaviour <> 'closed') AS openFlagCount,
  (SELECT max(a.at) FROM audit_log a WHERE a.consideration_id = c.id) AS lastActivityAt
FROM considerations c
JOIN domains d ON d.id = c.domain_id
JOIN subsystems s ON s.id = c.subsystem_id
JOIN users o ON o.id = c.owner_id
JOIN users cb ON cb.id = c.created_by
JOIN lookup_values st ON st.id = c.status_id
LEFT JOIN iterations li ON li.id = (
  SELECT i.id FROM iterations i JOIN lookup_values ist ON ist.id = i.status_id
  WHERE i.consideration_id = c.id AND ist.behaviour <> 'withdrawn' ORDER BY i.seq DESC LIMIT 1)
LEFT JOIN lookup_values lv ON lv.id = li.verdict_id`;

const ITER_SELECT = `
SELECT i.id, i.seq, i.consideration_id AS considerationId, c.title AS considerationTitle,
  c.target_metric AS targetMetric, c.domain_id AS domainId, d.code AS domainCode, d.colour AS domainColour,
  c.subsystem_id AS subsystemId, s.name AS subsystemName, c.owner_id AS considerationOwnerId,
  i.parent_iteration_id AS parentIterationId, i.parent_flag_id AS parentFlagId, i.date,
  i.author_id AS authorId, a.name AS authorName, i.design_input AS designInput, i.cad_design AS cadDesign,
  i.analytical_results AS analyticalResults, i.simulation_results AS simulationResults,
  i.evidence_link AS evidenceLink, i.verdict_id AS verdictId, v.label AS verdictLabel,
  v.behaviour AS verdictBehaviour, i.status_id AS statusId, st.label AS statusLabel,
  st.behaviour AS statusBehaviour, i.next_action AS nextAction, i.created_by AS createdBy,
  i.created_at AS createdAt, i.updated_at AS updatedAt, i.version,
  (SELECT count(*) FROM flags f WHERE f.iteration_id = i.id) AS flagCount,
  (SELECT count(*) FROM flags f JOIN lookup_values fs ON fs.id = f.status_id
   WHERE f.iteration_id = i.id AND fs.behaviour <> 'closed') AS openFlagCount
FROM iterations i
JOIN considerations c ON c.id = i.consideration_id
JOIN domains d ON d.id = c.domain_id
JOIN subsystems s ON s.id = c.subsystem_id
JOIN users a ON a.id = i.author_id
JOIN lookup_values st ON st.id = i.status_id
LEFT JOIN lookup_values v ON v.id = i.verdict_id`;

const FLAG_SELECT = `
SELECT f.id, f.seq, f.iteration_id AS iterationId, c.id AS considerationId, c.title AS considerationTitle,
  c.domain_id AS sourceDomainId, sd.code AS sourceDomainCode, sd.colour AS sourceDomainColour,
  s.name AS sourceSubsystemName, c.target_metric AS sourceTargetMetric,
  iv.label AS sourceVerdictLabel, iv.behaviour AS sourceVerdictBehaviour,
  f.raised_by_id AS raisedById, rb.name AS raisedByName, f.date_raised AS dateRaised,
  f.type_id AS typeId, ty.label AS typeLabel, ty.behaviour AS typeBehaviour,
  f.assigned_to_id AS assignedToId, at.name AS assignedToName,
  f.affected_domain_id AS affectedDomainId, ad.code AS affectedDomainCode, ad.name AS affectedDomainName,
  ad.colour AS affectedDomainColour, f.request, f.due_date AS dueDate,
  f.status_id AS statusId, st.label AS statusLabel, st.behaviour AS statusBehaviour, f.response,
  f.resulting_consideration_id AS resultingConsiderationId, f.date_closed AS dateClosed,
  f.created_at AS createdAt, f.updated_at AS updatedAt, f.version
FROM flags f
JOIN iterations i ON i.id = f.iteration_id
JOIN considerations c ON c.id = i.consideration_id
JOIN domains sd ON sd.id = c.domain_id
JOIN subsystems s ON s.id = c.subsystem_id
LEFT JOIN lookup_values iv ON iv.id = i.verdict_id
JOIN users rb ON rb.id = f.raised_by_id
JOIN lookup_values ty ON ty.id = f.type_id
JOIN users at ON at.id = f.assigned_to_id
JOIN domains ad ON ad.id = f.affected_domain_id
JOIN lookup_values st ON st.id = f.status_id`;

const withOverdue = (f: Omit<FlagRow, 'overdue'>): FlagRow => ({
  ...f,
  overdue: !!f.dueDate && f.statusBehaviour !== 'closed' && f.dueDate < today(),
});

export function getConsideration(db: DB, id: string): ConsiderationRow | undefined {
  return db.prepare(`${CONS_SELECT} WHERE c.id = ?`).get(id) as ConsiderationRow | undefined;
}

export function getIteration(db: DB, id: string): IterationRow | undefined {
  return db.prepare(`${ITER_SELECT} WHERE i.id = ?`).get(id) as IterationRow | undefined;
}

export function getFlag(db: DB, id: string): FlagRow | undefined {
  const f = db.prepare(`${FLAG_SELECT} WHERE f.id = ?`).get(id) as Omit<FlagRow, 'overdue'> | undefined;
  return f && withOverdue(f);
}

export function iterationsOf(db: DB, considerationId: string): IterationRow[] {
  return db.prepare(`${ITER_SELECT} WHERE i.consideration_id = ? ORDER BY i.seq`).all(considerationId) as IterationRow[];
}

export function flagsOfIteration(db: DB, iterationId: string): FlagRow[] {
  return (db.prepare(`${FLAG_SELECT} WHERE f.iteration_id = ? ORDER BY f.seq`).all(iterationId) as Omit<FlagRow, 'overdue'>[])
    .map(withOverdue);
}

export function flagsOfConsideration(db: DB, considerationId: string): FlagRow[] {
  return (db.prepare(`${FLAG_SELECT} WHERE i.consideration_id = ? ORDER BY i.seq, f.seq`).all(considerationId) as Omit<FlagRow, 'overdue'>[])
    .map(withOverdue);
}

/** Considerations whose origin is one of the given flags. */
export function spawnedFrom(db: DB, flagIds: string[]): ConsiderationRow[] {
  if (!flagIds.length) return [];
  return db
    .prepare(`${CONS_SELECT} WHERE c.origin_flag_id IN (${flagIds.map(() => '?').join(',')}) ORDER BY d.sort_order, c.seq`)
    .all(...flagIds) as ConsiderationRow[];
}

// ---------- lists with filters ----------

class Where {
  parts: string[] = [];
  params: unknown[] = [];
  add(sql: string, ...params: unknown[]) {
    this.parts.push(sql);
    this.params.push(...params);
  }
  in(col: string, values: unknown[] | undefined) {
    if (values?.length) this.add(`${col} IN (${values.map(() => '?').join(',')})`, ...values);
  }
  text(cols: string[], q: string | undefined) {
    if (!q) return;
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    this.add(`(${cols.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ')})`, ...cols.map(() => like));
  }
  get sql() {
    return this.parts.length ? ` WHERE ${this.parts.join(' AND ')}` : '';
  }
}

/** Sort keys map to one or more terms; the direction applies to every term. */
function orderBy(sorts: Record<string, string[]>, sort: string | undefined, dir: string | undefined, fallback: string) {
  const terms = sort && sorts[sort] ? sorts[sort] : sorts[fallback];
  const d = dir === 'desc' ? 'DESC' : 'ASC';
  return ` ORDER BY ${terms.map((t) => `${t} ${d}`).join(', ')}`;
}

const followingClause = (domainCol: string, consCol: string) =>
  `(${domainCol} IN (SELECT CAST(entity_id AS INTEGER) FROM follows WHERE user_id = ? AND entity_type = 'domain')
    OR ${consCol} IN (SELECT entity_id FROM follows WHERE user_id = ? AND entity_type = 'consideration'))`;

export interface ListFilters {
  domain?: number[];
  subsystem?: number[];
  owner?: number[];
  person?: number[];
  status?: number[];
  statusBehaviour?: string[];
  verdict?: number[];
  type?: number[];
  affectedDomain?: number[];
  assignee?: number[];
  raisedBy?: number[];
  consideration?: string[];
  from?: string;
  to?: string;
  q?: string;
  following?: boolean;
  overdue?: boolean;
  sort?: string;
  dir?: string;
  limit?: number;
  offset?: number;
}

const page = (f: ListFilters) => ` LIMIT ${Math.min(f.limit ?? 500, 2000)} OFFSET ${f.offset ?? 0}`;

export function listConsiderations(db: DB, f: ListFilters, userId: number): ConsiderationRow[] {
  const w = new Where();
  w.in('c.domain_id', f.domain);
  w.in('c.subsystem_id', f.subsystem);
  w.in('c.owner_id', f.owner);
  w.in('c.status_id', f.status);
  w.in('st.behaviour', f.statusBehaviour);
  w.in('lv.id', f.verdict);
  if (f.person?.length) {
    const qs = f.person.map(() => '?').join(',');
    w.add(`(c.owner_id IN (${qs}) OR c.created_by IN (${qs}))`, ...f.person, ...f.person);
  }
  if (f.from) w.add('substr(c.created_at, 1, 10) >= ?', f.from);
  if (f.to) w.add('substr(c.created_at, 1, 10) <= ?', f.to);
  w.text(['c.id', 'c.title', 'c.target_metric', 'c.notes', 's.name', 'o.name'], f.q);
  if (f.following) w.add(followingClause('c.domain_id', 'c.id'), userId, userId);
  const sorts = {
    id: ['d.code', 'c.seq'],
    domain: ['d.sort_order', 'c.seq'],
    subsystem: ['s.name', 'd.code', 'c.seq'],
    title: ['c.title'],
    owner: ['o.name', 'd.code', 'c.seq'],
    status: ['st.sort_order', 'd.code', 'c.seq'],
    verdict: ['lv.sort_order', 'd.code', 'c.seq'],
    created: ['c.created_at'],
    activity: ['lastActivityAt'],
  };
  return db
    .prepare(CONS_SELECT + w.sql + orderBy(sorts, f.sort, f.dir, 'domain') + page(f))
    .all(...w.params) as ConsiderationRow[];
}

export function listIterations(db: DB, f: ListFilters, userId: number): IterationRow[] {
  const w = new Where();
  w.in('c.domain_id', f.domain);
  w.in('c.subsystem_id', f.subsystem);
  w.in('c.owner_id', f.owner);
  w.in('i.author_id', f.person);
  w.in('i.status_id', f.status);
  w.in('st.behaviour', f.statusBehaviour);
  w.in('i.verdict_id', f.verdict);
  w.in('i.consideration_id', f.consideration);
  if (f.from) w.add('i.date >= ?', f.from);
  if (f.to) w.add('i.date <= ?', f.to);
  w.text(['i.id', 'c.title', 'i.design_input', 'i.cad_design', 'i.analytical_results', 'i.simulation_results',
    'i.next_action', 'a.name', 's.name'], f.q);
  if (f.following) w.add(followingClause('c.domain_id', 'c.id'), userId, userId);
  const sorts = {
    id: ['d.code', 'c.seq', 'i.seq'],
    date: ['i.date', 'd.code', 'c.seq', 'i.seq'],
    domain: ['d.sort_order', 'c.seq', 'i.seq'],
    subsystem: ['s.name', 'd.code', 'c.seq', 'i.seq'],
    author: ['a.name', 'i.date'],
    owner: ['(SELECT name FROM users WHERE id = c.owner_id)', 'd.code', 'c.seq', 'i.seq'],
    verdict: ['v.sort_order', 'i.date'],
    status: ['st.sort_order', 'i.date'],
  };
  const dir = f.sort ? f.dir : f.dir ?? 'desc';
  return db
    .prepare(ITER_SELECT + w.sql + orderBy(sorts, f.sort, dir, 'date') + page(f))
    .all(...w.params) as IterationRow[];
}

export function listFlags(db: DB, f: ListFilters, userId: number): FlagRow[] {
  const w = new Where();
  w.in('c.domain_id', f.domain);
  w.in('c.subsystem_id', f.subsystem);
  w.in('f.affected_domain_id', f.affectedDomain);
  w.in('f.assigned_to_id', f.assignee);
  w.in('f.raised_by_id', f.raisedBy);
  w.in('f.status_id', f.status);
  w.in('st.behaviour', f.statusBehaviour);
  w.in('f.type_id', f.type);
  w.in('i.verdict_id', f.verdict);
  w.in('c.owner_id', f.owner);
  w.in('c.id', f.consideration);
  if (f.person?.length) {
    const qs = f.person.map(() => '?').join(',');
    w.add(`(f.assigned_to_id IN (${qs}) OR f.raised_by_id IN (${qs}))`, ...f.person, ...f.person);
  }
  if (f.from) w.add('f.date_raised >= ?', f.from);
  if (f.to) w.add('f.date_raised <= ?', f.to);
  if (f.overdue) w.add("f.due_date IS NOT NULL AND f.due_date < ? AND st.behaviour <> 'closed'", today());
  w.text(['f.id', 'f.request', 'f.response', 'c.title', 'rb.name', 'at.name'], f.q);
  if (f.following) {
    w.add(`(${followingClause('c.domain_id', 'c.id')} OR f.affected_domain_id IN
      (SELECT CAST(entity_id AS INTEGER) FROM follows WHERE user_id = ? AND entity_type = 'domain'))`,
    userId, userId, userId);
  }
  const sorts = {
    id: ['sd.code', 'c.seq', 'i.seq', 'f.seq'],
    due: ["coalesce(f.due_date, '9999-12-31')", 'sd.code', 'c.seq', 'i.seq', 'f.seq'],
    raised: ['f.date_raised', 'sd.code', 'c.seq', 'i.seq', 'f.seq'],
    domain: ['sd.sort_order', 'c.seq', 'i.seq', 'f.seq'],
    affected: ['ad.sort_order', 'sd.code', 'c.seq', 'i.seq', 'f.seq'],
    assignee: ['at.name', 'f.due_date'],
    raisedBy: ['rb.name', 'f.date_raised'],
    status: ['st.sort_order', 'f.due_date'],
    type: ['ty.sort_order', 'f.due_date'],
  };
  return (db.prepare(FLAG_SELECT + w.sql + orderBy(sorts, f.sort, f.dir, 'due') + page(f)).all(...w.params) as Omit<FlagRow, 'overdue'>[])
    .map(withOverdue);
}
