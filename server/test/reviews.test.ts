import { afterEach, describe, expect, it } from 'vitest';
import { escalateOverdueFlags } from '../src/scheduler.js';
import { setNow } from '../src/time.js';
import { makeApp, newConsideration, type TestApp } from './helpers.js';

let t: TestApp;
afterEach(async () => {
  setNow(null);
  await t?.close();
});

const kinds = (t: TestApp, name: string) =>
  t.db.prepare('SELECT kind FROM notifications WHERE user_id = ? ORDER BY id').pluck().all(t.userId(name)) as string[];

/**
 * Nisath owns SH-C01. Upul logs I01 and asks Nilan and Kulunu to review it,
 * and sends Sajith an FYI.
 */
async function scenario() {
  t = await makeApp();
  const nisath = await t.as('Nisath');
  const upul = await t.as('Upul');
  await nisath.post('/api/considerations', newConsideration(t, 'SH'));
  const review = t.lookupId('flag_type', 'Review');
  await upul.post('/api/entries', {
    iteration: { considerationId: 'SH-C01', verdictId: t.lookupId('verdict', 'Pass') },
    flags: [
      { typeId: review, assignedToId: t.userId('Nilan'), affectedDomainId: t.domainId('CK'), request: 'Review chuck gap' },
      { typeId: review, assignedToId: t.userId('Kulunu'), affectedDomainId: t.domainId('DC'), request: 'Review flange load' },
      { typeId: t.lookupId('flag_type', 'FYI'), assignedToId: t.userId('Sajith'), affectedDomainId: t.domainId('SL'), request: 'FYI' },
    ],
  });
  return { nisath, upul, nilan: await t.as('Nilan'), kulunu: await t.as('Kulunu'), oscar: await t.as('Oscar'), sajith: await t.as('Sajith') };
}

async function review(c: Awaited<ReturnType<typeof scenario>>['nilan'], flagId: string, outcome: string, close = true) {
  const f = (await c.get(`/api/flags/${flagId}`)).body.flag;
  return c.patch(`/api/flags/${flagId}`, {
    version: f.version, reviewOutcome: outcome, ...(close ? { statusId: t.lookupId('flag_status', 'Closed') } : {}),
  });
}

async function close(c: Awaited<ReturnType<typeof scenario>>['nisath'], iterationId: string, extra: Record<string, unknown> = {}) {
  const it = (await c.get(`/api/iterations/${iterationId}`)).body.iteration;
  return c.patch(`/api/iterations/${iterationId}`, { version: it.version, statusId: t.lookupId('iteration_status', 'Closed'), ...extra });
}

describe('closing an iteration under review', () => {
  it('needs every review closed and approved, then the consideration owner closes it', async () => {
    const { nisath, upul, nilan, kulunu } = await scenario();
    let it = (await nisath.get('/api/iterations/SH-C01-I01')).body.iteration;
    expect(it).toMatchObject({ reviewCount: 2, reviewApprovedCount: 0 });

    const early = await close(nisath, 'SH-C01-I01');
    expect(early.status).toBe(409);
    expect(early.body.message).toContain('SH-C01-I01-F1 (open)');

    expect((await review(nilan, 'SH-C01-I01-F1', 'approved')).status).toBe(200);
    // An outcome given but the review still open does not count yet.
    expect((await review(kulunu, 'SH-C01-I01-F2', 'approved_with_comments', false)).status).toBe(200);
    expect((await close(nisath, 'SH-C01-I01')).status).toBe(409);
    const f2 = (await kulunu.get('/api/flags/SH-C01-I01-F2')).body.flag;
    await kulunu.patch('/api/flags/SH-C01-I01-F2', { version: f2.version, statusId: t.lookupId('flag_status', 'Closed') });

    it = (await nisath.get('/api/iterations/SH-C01-I01')).body.iteration;
    expect(it).toMatchObject({ reviewCount: 2, reviewApprovedCount: 2 });
    expect((await nisath.get('/api/my-items')).body.readyToClose.map((i: any) => i.id)).toEqual(['SH-C01-I01']);

    // The author is not the owner, so cannot close; the FYI flag does not block.
    expect((await close(upul, 'SH-C01-I01')).status).toBe(403);
    const closed = await close(nisath, 'SH-C01-I01');
    expect(closed.status).toBe(200);
    expect(closed.body.statusLabel).toBe('Closed');
    expect((await nisath.get('/api/my-items')).body.readyToClose).toEqual([]);
  });

  it('lets a manager close without approvals only with a reason, which is recorded', async () => {
    const { oscar, nisath } = await scenario();
    const noReason = await close(oscar, 'SH-C01-I01');
    expect(noReason.status).toBe(409);
    expect(noReason.body.details).toEqual({ needsOverrideReason: true });
    const ok = await close(oscar, 'SH-C01-I01', { closeOverrideReason: 'Design frozen for the build; reviews continue offline' });
    expect(ok.status).toBe(200);
    expect(ok.body.closeOverrideReason).toBe('Design frozen for the build; reviews continue offline');
    const history = (await oscar.get('/api/history?entityType=iteration&entityId=SH-C01-I01')).body;
    expect(history).toContainEqual(expect.objectContaining({ field: 'closeOverride', newValue: 'Design frozen for the build; reviews continue offline' }));
    expect(kinds(t, 'Nisath')).toContain('iteration_status');
    // Reopening clears the override.
    const reopened = await oscar.post('/api/iterations/SH-C01-I01/reopen', { version: ok.body.version });
    expect(reopened.body.closeOverrideReason).toBeNull();
  });

  it('only the owner or a manager can log an iteration as Closed, and closed iterations take no new reviews', async () => {
    const { upul, nisath } = await scenario();
    const closedStatus = t.lookupId('iteration_status', 'Closed');
    expect((await upul.post('/api/iterations', { considerationId: 'SH-C01', statusId: closedStatus })).status).toBe(403);
    const ok = await nisath.post('/api/iterations', { considerationId: 'SH-C01', statusId: closedStatus });
    expect(ok.status).toBe(201);
    const reviewOnClosed = await nisath.post('/api/flags', {
      iterationId: ok.body.id, typeId: t.lookupId('flag_type', 'Review'), assignedToId: t.userId('Nilan'), affectedDomainId: t.domainId('CK'), request: 'x',
    });
    expect(reviewOnClosed.status).toBe(409);
    const fyiOnClosed = await nisath.post('/api/flags', {
      iterationId: ok.body.id, typeId: t.lookupId('flag_type', 'FYI'), assignedToId: t.userId('Nilan'), affectedDomainId: t.domainId('CK'), request: 'x',
    });
    expect(fyiOnClosed.status).toBe(201);
  });
});

describe('review outcomes', () => {
  it('only the reviewer or a manager gives the outcome; only Review flags have one', async () => {
    const { upul, sajith, oscar } = await scenario();
    expect((await review(upul, 'SH-C01-I01-F1', 'approved', false)).status).toBe(403);
    expect((await review(sajith, 'SH-C01-I01-F3', 'approved', false)).status).toBe(400);
    expect((await review(oscar, 'SH-C01-I01-F1', 'changes_needed', false)).status).toBe(200);
  });

  it('tells the author and owner about "Changes needed", and the managers when it happens twice', async () => {
    const { nilan, kulunu, upul, nisath } = await scenario();
    await review(nilan, 'SH-C01-I01-F1', 'changes_needed');
    expect(kinds(t, 'Upul')).toContain('review_changes_needed');
    expect(kinds(t, 'Nisath')).toContain('review_changes_needed');
    expect(kinds(t, 'Oscar')).not.toContain('repeated_changes_needed');
    expect((await upul.get('/api/my-items')).body.changesNeeded.map((i: any) => i.id)).toEqual(['SH-C01-I01']);
    // A "Changes needed" review blocks closing.
    expect((await close(nisath, 'SH-C01-I01')).body.message).toContain('changes needed');

    await review(kulunu, 'SH-C01-I01-F2', 'changes_needed');
    expect(kinds(t, 'Oscar')).toContain('repeated_changes_needed');
  });

  it('tells the managers when an iteration is closed with verdict Fail', async () => {
    const { nisath } = await scenario();
    await nisath.post('/api/iterations', { considerationId: 'SH-C01', verdictId: t.lookupId('verdict', 'Fail') });
    expect(kinds(t, 'Oscar')).not.toContain('iteration_failed');
    await close(nisath, 'SH-C01-I02');
    expect(kinds(t, 'Oscar')).toContain('iteration_failed');
  });
});

describe('escalation to the managers', () => {
  it('can be raised by either side, is resolved by a manager, and shows in the feed', async () => {
    const { nilan, sajith, oscar, upul } = await scenario();
    expect((await sajith.post('/api/flags/SH-C01-I01-F1/escalate', { reason: 'not mine' })).status).toBe(403);
    const esc = await nilan.post('/api/flags/SH-C01-I01-F1/escalate', { reason: 'Gap target conflicts with CK seal spec' });
    expect(esc.status).toBe(200);
    expect(esc.body).toMatchObject({ escalated: true, escalatedByName: 'Nilan', escalationReason: 'Gap target conflicts with CK seal spec' });
    expect(kinds(t, 'Oscar')).toContain('flag_escalated');
    expect(kinds(t, 'Upul')).toContain('flag_escalated');
    expect((await upul.post('/api/flags/SH-C01-I01-F1/escalate', { reason: 'again' })).status).toBe(409);
    expect((await oscar.get('/api/my-items')).body.escalated.map((f: any) => f.id)).toEqual(['SH-C01-I01-F1']);
    expect((await oscar.get('/api/flags?escalated=1')).body.map((f: any) => f.id)).toEqual(['SH-C01-I01-F1']);

    expect((await upul.post('/api/flags/SH-C01-I01-F1/resolve-escalation', { resolution: 'x' })).status).toBe(403);
    const res = await oscar.post('/api/flags/SH-C01-I01-F1/resolve-escalation', { resolution: 'Keep 0.5 mm; CK to update seal spec' });
    expect(res.body).toMatchObject({ escalated: false, escalationResolvedByName: 'Oscar' });
    expect(kinds(t, 'Nilan')).toContain('flag_escalation_resolved');
    expect((await oscar.get('/api/my-items')).body.escalated).toEqual([]);
    const events = (await oscar.get('/api/feed?type=flag')).body.items.map((e: any) => e.event);
    expect(events.slice(0, 2)).toEqual(['flag_escalation_resolved', 'flag_escalated']);
  });

  it('tells the managers once when a flag is 3 days overdue, again after the due date moves', async () => {
    setNow(new Date('2026-10-05T09:00:00'));
    const { nilan } = await scenario();
    let f = (await nilan.get('/api/flags/SH-C01-I01-F1')).body.flag;
    await (await t.as('Upul')).patch(`/api/flags/${f.id}`, { version: f.version, dueDate: '2026-10-06' });

    setNow(new Date('2026-10-08T09:00:00'));
    expect(escalateOverdueFlags(t.svc)).toEqual([]); // 2 days late
    setNow(new Date('2026-10-09T09:00:00'));
    expect(escalateOverdueFlags(t.svc)).toEqual(['SH-C01-I01-F1']);
    expect(escalateOverdueFlags(t.svc)).toEqual([]); // only once
    const n = t.db.prepare("SELECT title FROM notifications WHERE user_id = ? AND kind = 'flag_overdue'").pluck().all(t.userId('Oscar'));
    expect(n).toEqual(['SH-C01-I01-F1 is 3 days overdue (Nilan, due 2026-10-06)']);

    f = (await nilan.get('/api/flags/SH-C01-I01-F1')).body.flag;
    await (await t.as('Upul')).patch(`/api/flags/${f.id}`, { version: f.version, dueDate: '2026-10-05' });
    expect(escalateOverdueFlags(t.svc)).toEqual(['SH-C01-I01-F1']);
  });
});
