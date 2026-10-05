import type { WriteCtx } from '../context.js';
import { badRequest, conflict, forbidden, notFound, stale } from '../errors.js';
import { formatId, nextSeq, scopes } from '../ids.js';
import { checkLookup, defaultLookup, getLookup, lookupByBehaviour } from '../lookups.js';
import {
  canEditConsideration, canEditFlagRequest, canEditIteration, canRespondToFlag, canSetFlagStatus,
  canSpawnFromFlag, isManager,
} from '../permissions.js';
import { getConsideration, getFlag, getIteration } from '../queries.js';
import type {
  ConsiderationCreate, ConsiderationUpdate, EntryCreate, FlagCreate, FlagUpdate, IterationCreate, IterationUpdate,
} from '../schemas.js';
import { today } from '../time.js';
import type { DB } from '../db/db.js';

// ---------- small lookups used for validation and audit text ----------

function activeUser(db: DB, id: number, what: string): { id: number; name: string } {
  const u = db.prepare('SELECT id, name, active FROM users WHERE id = ?').get(id) as
    { id: number; name: string; active: number } | undefined;
  if (!u) throw badRequest(`${what}: unknown user`);
  if (!u.active) throw badRequest(`${what}: ${u.name} is no longer active`);
  return u;
}

const userName = (db: DB, id: number | null | undefined) =>
  id == null ? null : (db.prepare('SELECT name FROM users WHERE id = ?').pluck().get(id) as string | undefined) ?? null;
const lookupLabel = (db: DB, id: number | null | undefined) => (id == null ? null : getLookup(db, id)?.label ?? null);
const subsystemName = (db: DB, id: number | null | undefined) =>
  id == null ? null : (db.prepare('SELECT name FROM subsystems WHERE id = ?').pluck().get(id) as string | undefined) ?? null;
const domainCode = (db: DB, id: number | null | undefined) =>
  id == null ? null : (db.prepare('SELECT code FROM domains WHERE id = ?').pluck().get(id) as string | undefined) ?? null;

function activeDomain(db: DB, id: number) {
  const d = db.prepare('SELECT id, code, name, owner_id AS ownerId, active FROM domains WHERE id = ?').get(id) as
    { id: number; code: string; name: string; ownerId: number | null; active: number } | undefined;
  if (!d) throw badRequest('Unknown domain');
  if (!d.active) throw badRequest(`Domain ${d.code} is no longer in use`);
  return d;
}

/** Sub-system must belong to the domain (choices are always filtered by domain). */
function checkSubsystem(db: DB, subsystemId: number, domainId: number, current?: number) {
  const s = db.prepare('SELECT id, domain_id AS domainId, name, active FROM subsystems WHERE id = ?').get(subsystemId) as
    { id: number; domainId: number; name: string; active: number } | undefined;
  if (!s || s.domainId !== domainId) throw badRequest('Sub-system does not belong to the selected domain');
  if (!s.active && s.id !== current) throw badRequest(`Sub-system '${s.name}' is no longer in use`);
  return s;
}

const changed = <T extends object>(input: Partial<T>, current: T, key: keyof T) =>
  input[key] !== undefined && input[key] !== current[key];

// ---------- considerations ----------

export function createConsideration(ctx: WriteCtx, input: ConsiderationCreate): string {
  const { db, user } = ctx;
  const domain = activeDomain(db, input.domainId);
  checkSubsystem(db, input.subsystemId, domain.id);
  const ownerId = input.ownerId ?? domain.ownerId ?? user.id;
  activeUser(db, ownerId, 'Owner');
  const status = input.statusId ? checkLookup(db, 'consideration_status', input.statusId) : defaultLookup(db, 'consideration_status');

  let origin = null;
  if (input.originFlagId) {
    origin = getFlag(db, input.originFlagId);
    if (!origin) throw badRequest(`Origin flag ${input.originFlagId} not found`);
    if (!canSpawnFromFlag(user, origin)) throw forbidden('Only the flag assignee, the person who raised it or a manager can start a consideration from it');
    if (origin.resultingConsiderationId) {
      throw conflict(`Flag ${origin.id} already led to consideration ${origin.resultingConsiderationId}`);
    }
  }

  const seq = nextSeq(db, scopes.consideration(domain.id));
  const cid = formatId.consideration(domain.code, seq);
  db.prepare(
    `INSERT INTO considerations (id, seq, domain_id, subsystem_id, title, target_metric, owner_id, origin_flag_id,
       status_id, notes, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(cid, seq, domain.id, input.subsystemId, input.title, input.targetMetric, ownerId, origin?.id ?? null,
    status.id, input.notes, user.id, ctx.at, ctx.at);

  const row = getConsideration(db, cid)!;
  ctx.audit({
    action: 'create', entityType: 'consideration', entityId: cid, domainId: domain.id, considerationId: cid,
    newValue: row, event: 'consideration_created',
  });
  ctx.follow(user.id, 'consideration', cid);
  ctx.follow(ownerId, 'consideration', cid);

  if (origin) {
    db.prepare('UPDATE flags SET resulting_consideration_id = ?, updated_at = ?, version = version + 1 WHERE id = ?')
      .run(cid, ctx.at, origin.id);
    ctx.audit({
      action: 'link', entityType: 'flag', entityId: origin.id, domainId: origin.sourceDomainId,
      considerationId: origin.considerationId, field: 'resultingConsiderationId', oldValue: null, newValue: cid,
    });
    ctx.notify([origin.raisedById, origin.assignedToId], {
      kind: 'flag_spawned', entityType: 'consideration', entityId: cid,
      title: `${origin.id} led to new consideration ${cid}`, body: input.title,
    });
  }
  if (ownerId !== user.id) {
    ctx.notify([ownerId], {
      kind: 'consideration_owner', entityType: 'consideration', entityId: cid,
      title: `You own new consideration ${cid}`, body: input.title,
    });
  }
  ctx.notify(ctx.followers(cid, domain.id), {
    kind: 'consideration_created', entityType: 'consideration', entityId: cid,
    title: `New consideration ${cid} by ${user.name}`, body: input.title,
  });
  return cid;
}

export function updateConsideration(ctx: WriteCtx, id: string, input: ConsiderationUpdate) {
  const { db, user } = ctx;
  const c = getConsideration(db, id);
  if (!c) throw notFound('Consideration');
  if (!canEditConsideration(user, c)) throw forbidden('Only the owner, the creator or a manager can edit this consideration');
  if (input.version !== c.version) throw stale(c);

  if (changed(input, c, 'subsystemId')) checkSubsystem(db, input.subsystemId!, c.domainId, c.subsystemId);
  if (changed(input, c, 'ownerId')) activeUser(db, input.ownerId!, 'Owner');
  if (changed(input, c, 'statusId')) checkLookup(db, 'consideration_status', input.statusId!, c.statusId);

  const next = {
    subsystemId: input.subsystemId ?? c.subsystemId,
    title: input.title ?? c.title,
    targetMetric: input.targetMetric ?? c.targetMetric,
    ownerId: input.ownerId ?? c.ownerId,
    statusId: input.statusId ?? c.statusId,
    notes: input.notes ?? c.notes,
  };
  const r = db.prepare(
    `UPDATE considerations SET subsystem_id = ?, title = ?, target_metric = ?, owner_id = ?, status_id = ?, notes = ?,
       updated_at = ?, version = version + 1
     WHERE id = ? AND version = ?`,
  ).run(next.subsystemId, next.title, next.targetMetric, next.ownerId, next.statusId, next.notes, ctx.at, id, input.version);
  if (r.changes === 0) throw stale(getConsideration(db, id));

  ctx.auditChanges(
    { entityType: 'consideration', entityId: id, domainId: c.domainId, considerationId: id },
    {
      subsystem: [c.subsystemName, subsystemName(db, next.subsystemId)],
      title: [c.title, next.title],
      targetMetric: [c.targetMetric, next.targetMetric],
      owner: [c.ownerName, userName(db, next.ownerId)],
      status: [c.statusLabel, lookupLabel(db, next.statusId)],
      notes: [c.notes, next.notes],
    },
    { status: 'consideration_status' },
  );

  if (next.ownerId !== c.ownerId) {
    ctx.follow(next.ownerId, 'consideration', id);
    ctx.notify([next.ownerId], {
      kind: 'consideration_owner', entityType: 'consideration', entityId: id,
      title: `${user.name} made you owner of ${id}`, body: next.title,
    });
  }
  if (next.statusId !== c.statusId) {
    ctx.notify(ctx.followers(id, c.domainId), {
      kind: 'consideration_status', entityType: 'consideration', entityId: id,
      title: `${id} is now ${lookupLabel(db, next.statusId)} (${user.name})`, body: next.title,
    });
  }
  return getConsideration(db, id)!;
}

// ---------- iterations ----------

export function createIteration(ctx: WriteCtx, input: IterationCreate): string {
  const { db, user } = ctx;
  const c = getConsideration(db, input.considerationId);
  if (!c) throw badRequest(`Consideration ${input.considerationId} not found`);
  if (c.statusBehaviour !== 'open') {
    throw conflict(`${c.id} is ${c.statusLabel}. Reopen it before logging another iteration.`);
  }
  const authorId = input.authorId ?? user.id;
  activeUser(db, authorId, 'Author');
  const verdict = input.verdictId ? checkLookup(db, 'verdict', input.verdictId) : null;
  const status = input.statusId ? checkLookup(db, 'iteration_status', input.statusId) : defaultLookup(db, 'iteration_status');

  // Parent: the previous iteration of this consideration, or for the first
  // iteration the flag the consideration came from (null for a root).
  const prev = db.prepare('SELECT id FROM iterations WHERE consideration_id = ? ORDER BY seq DESC LIMIT 1')
    .pluck().get(c.id) as string | undefined;
  const parentIterationId = prev ?? null;
  const parentFlagId = prev ? null : c.originFlagId;

  const seq = nextSeq(db, scopes.iteration(c.id));
  const iid = formatId.iteration(c.id, seq);
  db.prepare(
    `INSERT INTO iterations (id, consideration_id, seq, parent_iteration_id, parent_flag_id, date, author_id,
       design_input, cad_design, analytical_results, simulation_results, evidence_link, verdict_id, status_id,
       next_action, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(iid, c.id, seq, parentIterationId, parentFlagId, input.date ?? today(), authorId, input.designInput,
    input.cadDesign, input.analyticalResults, input.simulationResults, input.evidenceLink, verdict?.id ?? null,
    status.id, input.nextAction, user.id, ctx.at, ctx.at);

  const row = getIteration(db, iid)!;
  ctx.audit({
    action: 'create', entityType: 'iteration', entityId: iid, domainId: c.domainId, considerationId: c.id,
    newValue: row, event: 'iteration_logged',
  });
  ctx.follow(authorId, 'consideration', c.id);
  ctx.follow(user.id, 'consideration', c.id);
  ctx.notify(ctx.followers(c.id, c.domainId), {
    kind: 'iteration_logged', entityType: 'iteration', entityId: iid,
    title: `${iid} logged by ${row.authorName}${verdict ? ` - ${verdict.label}` : ''}`, body: c.title,
  });
  return iid;
}

const READ_ONLY = 'This iteration is closed and read-only. A manager can reopen it.';

export function updateIteration(ctx: WriteCtx, id: string, input: IterationUpdate) {
  const { db, user } = ctx;
  const it = getIteration(db, id);
  if (!it) throw notFound('Iteration');
  if (!canEditIteration(user, it)) throw forbidden('Only the author, the consideration owner or a manager can edit this iteration');
  if (it.statusBehaviour === 'closed') throw conflict(READ_ONLY);
  if (input.version !== it.version) throw stale(it);

  if (changed(input, it, 'authorId')) activeUser(db, input.authorId!, 'Author');
  if (changed(input, it, 'verdictId') && input.verdictId !== null) checkLookup(db, 'verdict', input.verdictId!, it.verdictId);
  if (changed(input, it, 'statusId')) checkLookup(db, 'iteration_status', input.statusId!, it.statusId);

  const next = {
    date: input.date ?? it.date,
    authorId: input.authorId ?? it.authorId,
    designInput: input.designInput ?? it.designInput,
    cadDesign: input.cadDesign ?? it.cadDesign,
    analyticalResults: input.analyticalResults ?? it.analyticalResults,
    simulationResults: input.simulationResults ?? it.simulationResults,
    evidenceLink: input.evidenceLink ?? it.evidenceLink,
    verdictId: input.verdictId === undefined ? it.verdictId : input.verdictId,
    statusId: input.statusId ?? it.statusId,
    nextAction: input.nextAction ?? it.nextAction,
  };
  const r = db.prepare(
    `UPDATE iterations SET date = ?, author_id = ?, design_input = ?, cad_design = ?, analytical_results = ?,
       simulation_results = ?, evidence_link = ?, verdict_id = ?, status_id = ?, next_action = ?,
       updated_at = ?, version = version + 1
     WHERE id = ? AND version = ?`,
  ).run(next.date, next.authorId, next.designInput, next.cadDesign, next.analyticalResults, next.simulationResults,
    next.evidenceLink, next.verdictId, next.statusId, next.nextAction, ctx.at, id, input.version);
  if (r.changes === 0) throw stale(getIteration(db, id));

  ctx.auditChanges(
    { entityType: 'iteration', entityId: id, domainId: it.domainId, considerationId: it.considerationId },
    {
      date: [it.date, next.date],
      author: [it.authorName, userName(db, next.authorId)],
      designInput: [it.designInput, next.designInput],
      cadDesign: [it.cadDesign, next.cadDesign],
      analyticalResults: [it.analyticalResults, next.analyticalResults],
      simulationResults: [it.simulationResults, next.simulationResults],
      evidenceLink: [it.evidenceLink, next.evidenceLink],
      verdict: [it.verdictLabel, lookupLabel(db, next.verdictId)],
      status: [it.statusLabel, lookupLabel(db, next.statusId)],
      nextAction: [it.nextAction, next.nextAction],
    },
    { verdict: 'iteration_verdict', status: 'iteration_status' },
  );

  if (next.statusId !== it.statusId || next.verdictId !== it.verdictId) {
    const parts = [];
    if (next.verdictId !== it.verdictId) parts.push(`verdict ${lookupLabel(db, next.verdictId) ?? 'cleared'}`);
    if (next.statusId !== it.statusId) parts.push(`now ${lookupLabel(db, next.statusId)}`);
    ctx.notify([...ctx.followers(it.considerationId, it.domainId), next.authorId], {
      kind: 'iteration_status', entityType: 'iteration', entityId: id,
      title: `${id} ${parts.join(', ')} (${user.name})`, body: it.considerationTitle,
    });
  }
  return getIteration(db, id)!;
}

export function reopenIteration(ctx: WriteCtx, id: string, version: number) {
  const { db, user } = ctx;
  if (!isManager(user)) throw forbidden('Only a manager can reopen a closed iteration');
  const it = getIteration(db, id);
  if (!it) throw notFound('Iteration');
  if (it.statusBehaviour !== 'closed') throw conflict(`${id} is not closed`);
  if (version !== it.version) throw stale(it);
  const status = lookupByBehaviour(db, 'iteration_status', 'in_progress');
  db.prepare('UPDATE iterations SET status_id = ?, updated_at = ?, version = version + 1 WHERE id = ?')
    .run(status.id, ctx.at, id);
  ctx.audit({
    action: 'reopen', entityType: 'iteration', entityId: id, domainId: it.domainId, considerationId: it.considerationId,
    field: 'status', oldValue: it.statusLabel, newValue: status.label, event: 'iteration_status',
  });
  ctx.notify([...ctx.followers(it.considerationId, it.domainId), it.authorId], {
    kind: 'iteration_status', entityType: 'iteration', entityId: id,
    title: `${id} reopened by ${user.name}`, body: it.considerationTitle,
  });
  return getIteration(db, id)!;
}

// ---------- flags ----------

export function createFlag(ctx: WriteCtx, input: FlagCreate): string {
  const { db, user } = ctx;
  const it = getIteration(db, input.iterationId);
  if (!it) throw badRequest(`Iteration ${input.iterationId} not found`);
  if (it.statusBehaviour === 'withdrawn') throw conflict(`${it.id} is withdrawn; flags cannot be raised from it`);
  const type = input.typeId ? checkLookup(db, 'flag_type', input.typeId) : defaultLookup(db, 'flag_type');
  const assignee = activeUser(db, input.assignedToId, 'Assigned to');
  const affected = activeDomain(db, input.affectedDomainId);
  const status = defaultLookup(db, 'flag_status');

  const seq = nextSeq(db, scopes.flag(it.id));
  const fid = formatId.flag(it.id, seq);
  db.prepare(
    `INSERT INTO flags (id, iteration_id, seq, raised_by_id, date_raised, type_id, assigned_to_id, affected_domain_id,
       request, due_date, status_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(fid, it.id, seq, user.id, input.dateRaised ?? today(), type.id, assignee.id, affected.id, input.request,
    input.dueDate ?? null, status.id, ctx.at, ctx.at);

  const row = getFlag(db, fid)!;
  ctx.audit({
    action: 'create', entityType: 'flag', entityId: fid, domainId: it.domainId, considerationId: it.considerationId,
    newValue: row, event: 'flag_raised',
  });
  ctx.notify([assignee.id], {
    kind: 'flag_assigned', entityType: 'flag', entityId: fid,
    title: `${user.name} assigned you ${fid} (${type.label}${input.dueDate ? `, due ${input.dueDate}` : ''})`,
    body: input.request,
  });
  const affectedFollowers = db
    .prepare("SELECT user_id FROM follows WHERE entity_type = 'domain' AND entity_id = ?")
    .pluck().all(String(affected.id)) as number[];
  ctx.notify([...ctx.followers(it.considerationId, it.domainId), ...affectedFollowers], {
    kind: 'flag_raised', entityType: 'flag', entityId: fid,
    title: `${fid} raised by ${user.name} for ${assignee.name} (${affected.code})`, body: input.request,
  });
  return fid;
}

export function updateFlag(ctx: WriteCtx, id: string, input: FlagUpdate) {
  const { db, user } = ctx;
  const f = getFlag(db, id);
  if (!f) throw notFound('Flag');

  const requestChanged = (['typeId', 'assignedToId', 'affectedDomainId', 'request', 'dueDate'] as const)
    .some((k) => changed(input, f, k));
  const responseChanged = changed(input, f, 'response');
  const statusChanged = changed(input, f, 'statusId');
  if (requestChanged && !canEditFlagRequest(user, f)) throw forbidden('Only the person who raised the flag or a manager can change the request');
  if (responseChanged && !canRespondToFlag(user, f)) throw forbidden('Only the assignee or a manager can respond to this flag');
  if (statusChanged && !canSetFlagStatus(user, f)) throw forbidden('Only the assignee, the person who raised it or a manager can change its status');
  if (input.version !== f.version) throw stale(f);

  if (changed(input, f, 'typeId')) checkLookup(db, 'flag_type', input.typeId!, f.typeId);
  if (changed(input, f, 'assignedToId')) activeUser(db, input.assignedToId!, 'Assigned to');
  if (changed(input, f, 'affectedDomainId')) activeDomain(db, input.affectedDomainId!);
  const newStatus = statusChanged ? checkLookup(db, 'flag_status', input.statusId!, f.statusId) : null;

  const next = {
    typeId: input.typeId ?? f.typeId,
    assignedToId: input.assignedToId ?? f.assignedToId,
    affectedDomainId: input.affectedDomainId ?? f.affectedDomainId,
    request: input.request ?? f.request,
    dueDate: input.dueDate === undefined ? f.dueDate : input.dueDate,
    statusId: input.statusId ?? f.statusId,
    response: input.response ?? f.response,
    dateClosed: f.dateClosed,
  };
  const closing = newStatus?.behaviour === 'closed' && f.statusBehaviour !== 'closed';
  if (newStatus) next.dateClosed = newStatus.behaviour === 'closed' ? (closing ? today() : f.dateClosed) : null;

  const r = db.prepare(
    `UPDATE flags SET type_id = ?, assigned_to_id = ?, affected_domain_id = ?, request = ?, due_date = ?, status_id = ?,
       response = ?, date_closed = ?, updated_at = ?, version = version + 1
     WHERE id = ? AND version = ?`,
  ).run(next.typeId, next.assignedToId, next.affectedDomainId, next.request, next.dueDate, next.statusId,
    next.response, next.dateClosed, ctx.at, id, input.version);
  if (r.changes === 0) throw stale(getFlag(db, id));

  ctx.auditChanges(
    { entityType: 'flag', entityId: id, domainId: f.sourceDomainId, considerationId: f.considerationId },
    {
      type: [f.typeLabel, lookupLabel(db, next.typeId)],
      assignedTo: [f.assignedToName, userName(db, next.assignedToId)],
      affectedDomain: [f.affectedDomainCode, domainCode(db, next.affectedDomainId)],
      request: [f.request, next.request],
      dueDate: [f.dueDate, next.dueDate],
      status: [f.statusLabel, lookupLabel(db, next.statusId)],
      response: [f.response, next.response],
      dateClosed: [f.dateClosed, next.dateClosed],
    },
    { status: 'flag_status', response: 'flag_answered', assignedTo: 'flag_assigned' },
  );

  // One notification per person describing everything that changed.
  const reassigned = next.assignedToId !== f.assignedToId;
  if (reassigned) {
    ctx.notify([next.assignedToId], {
      kind: 'flag_assigned', entityType: 'flag', entityId: id,
      title: `${user.name} assigned you ${id} (${lookupLabel(db, next.typeId)}${next.dueDate ? `, due ${next.dueDate}` : ''})`,
      body: next.request,
    });
  }
  const parts: string[] = [];
  if (responseChanged) parts.push('answered');
  if (statusChanged) parts.push(closing ? 'closed' : `set to ${newStatus!.label}`);
  if (reassigned) parts.push(`reassigned to ${userName(db, next.assignedToId)}`);
  if (requestChanged && !reassigned) parts.push('request updated');
  if (parts.length) {
    const kind = closing ? 'flag_closed' : responseChanged ? 'flag_answered' : statusChanged ? 'flag_status' : 'flag_updated';
    const people = [f.raisedById, f.assignedToId, next.assignedToId];
    if (statusChanged) people.push(...ctx.followers(f.considerationId, f.sourceDomainId));
    ctx.notify(people, {
      kind, entityType: 'flag', entityId: id,
      title: `${id} ${parts.join(', ')} by ${user.name}`,
      body: responseChanged ? next.response : next.request,
    });
  }
  return getFlag(db, id)!;
}

export function considerationFromFlag(ctx: WriteCtx, flagId: string, input: Omit<ConsiderationCreate, 'domainId' | 'originFlagId'> & { domainId?: number }): string {
  const f = getFlag(ctx.db, flagId);
  if (!f) throw notFound('Flag');
  return createConsideration(ctx, { ...input, domainId: input.domainId ?? f.affectedDomainId, originFlagId: flagId });
}

// ---------- combined entry form ----------

export interface EntryResult {
  considerationId: string | null;
  iterationId: string | null;
  flagIds: string[];
}

/** New consideration (optional) + iteration (optional) + flags, all in one transaction. */
export function createEntry(ctx: WriteCtx, input: EntryCreate): EntryResult {
  const out: EntryResult = { considerationId: null, iterationId: null, flagIds: [] };
  if (input.consideration) out.considerationId = createConsideration(ctx, input.consideration);
  if (input.iteration) {
    const considerationId = input.iteration.considerationId ?? out.considerationId;
    if (!considerationId) throw badRequest('iteration: choose a consideration or create a new one');
    out.iterationId = createIteration(ctx, { ...input.iteration, considerationId });
  }
  input.flags.forEach((fl, i) => {
    const iterationId = fl.iterationId ?? out.iterationId;
    if (!iterationId) throw badRequest(`flags.${i}: choose a source iteration or log a new one`);
    out.flagIds.push(createFlag(ctx, { ...fl, iterationId }));
  });
  return out;
}
