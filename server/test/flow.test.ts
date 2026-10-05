import { afterEach, describe, expect, it } from 'vitest';
import { setNow } from '../src/time.js';
import { makeApp, newConsideration, type TestApp } from './helpers.js';

let t: TestApp;
afterEach(async () => {
  setNow(null);
  await t?.close();
});

const unread = (t: TestApp, name: string) =>
  t.db.prepare('SELECT kind, entity_id AS entityId, title FROM notifications WHERE user_id = ? AND is_read = 0 ORDER BY id')
    .all(t.userId(name)) as Array<{ kind: string; entityId: string; title: string }>;

describe('parent and origin linking', () => {
  it('links a root consideration\'s iterations in order', async () => {
    t = await makeApp();
    const u = await t.as('Nisath');
    await u.post('/api/considerations', newConsideration(t, 'SH'));
    const i1 = (await u.post('/api/iterations', { considerationId: 'SH-C01' })).body;
    const i2 = (await u.post('/api/iterations', { considerationId: 'SH-C01' })).body;
    const i3 = (await u.post('/api/iterations', { considerationId: 'SH-C01' })).body;
    expect(i1.parentIterationId).toBeNull();
    expect(i1.parentFlagId).toBeNull();
    expect(i2.parentIterationId).toBe('SH-C01-I01');
    expect(i3.parentIterationId).toBe('SH-C01-I02');
    expect(i3.parentFlagId).toBeNull();
  });

  it('uses the origin flag as parent of the first iteration of a spawned consideration', async () => {
    t = await makeApp();
    const nisath = await t.as('Nisath');
    const nilan = await t.as('Nilan');
    await nisath.post('/api/entries', {
      consideration: newConsideration(t, 'SH'),
      iteration: {},
      flags: [{ assignedToId: t.userId('Nilan'), affectedDomainId: t.domainId('CK'), request: 'Seal ring gets too hot' }],
    });
    const spawned = await nilan.post('/api/flags/SH-C01-I01-F1/consideration', {
      subsystemId: t.subsystemId('CK', 'Seal Ring'), title: 'Seal ring temperature', targetMetric: '< 150 C',
    });
    expect(spawned.status).toBe(201);
    expect(spawned.body.consideration.id).toBe('CK-C01');
    expect(spawned.body.consideration.originFlagId).toBe('SH-C01-I01-F1');
    expect(spawned.body.consideration.domainCode).toBe('CK');
    expect(spawned.body.consideration.ownerName).toBe('Nilan');
    expect(spawned.body.flag.resultingConsiderationId).toBe('CK-C01');

    const k1 = (await nilan.post('/api/iterations', { considerationId: 'CK-C01' })).body;
    const k2 = (await nilan.post('/api/iterations', { considerationId: 'CK-C01' })).body;
    expect(k1.parentFlagId).toBe('SH-C01-I01-F1');
    expect(k1.parentIterationId).toBeNull();
    expect(k2.parentIterationId).toBe('CK-C01-I01');
    expect(k2.parentFlagId).toBeNull();

    const detail = (await nisath.get('/api/considerations/SH-C01')).body;
    expect(detail.iterations[0].flags[0].resultingConsiderationId).toBe('CK-C01');
    expect(detail.spawned.map((c: any) => c.id)).toEqual(['CK-C01']);
    const ck = (await nisath.get('/api/considerations/CK-C01')).body;
    expect(ck.originFlag.id).toBe('SH-C01-I01-F1');
  });

  it('accepts an origin flag from the entry form and links the flag back', async () => {
    t = await makeApp();
    const nisath = await t.as('Nisath');
    const nilan = await t.as('Nilan');
    await nisath.post('/api/entries', {
      consideration: newConsideration(t, 'SH'), iteration: {},
      flags: [{ assignedToId: t.userId('Nilan'), affectedDomainId: t.domainId('CK'), request: 'x' }],
    });
    const res = await nilan.post('/api/entries', {
      consideration: newConsideration(t, 'CK', { originFlagId: 'SH-C01-I01-F1' }),
      iteration: { verdictId: t.lookupId('verdict', 'Fail') },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ considerationId: 'CK-C01', iterationId: 'CK-C01-I01' });
    const it1 = (await nilan.get('/api/iterations/CK-C01-I01')).body.iteration;
    expect(it1.parentFlagId).toBe('SH-C01-I01-F1');
    const f = (await nilan.get('/api/flags/SH-C01-I01-F1')).body.flag;
    expect(f.resultingConsiderationId).toBe('CK-C01');

    // A flag leads to at most one consideration.
    const again = await nilan.post('/api/flags/SH-C01-I01-F1/consideration', { subsystemId: t.subsystemId('CK', 'Seal Ring'), title: 'dup' });
    expect(again.status).toBe(409);
    expect(t.db.prepare("SELECT count(*) FROM considerations WHERE domain_id = ?").pluck().get(t.domainId('CK'))).toBe(1);
  });
});

describe('flag to consideration flow', () => {
  it('runs end to end with notifications, audit and feed', async () => {
    setNow(new Date('2026-10-05T09:00:00'));
    t = await makeApp();
    const nisath = await t.as('Nisath');
    const nilan = await t.as('Nilan');
    const oscar = await t.as('Oscar');

    // Nisath logs a consideration, an iteration and a review flag for Nilan in one submit.
    const entry = await nisath.post('/api/entries', {
      consideration: newConsideration(t, 'SH', { title: 'Faceplate uniformity' }),
      iteration: {
        designInput: 'Hole pattern B', simulationResults: 'dT = 3.1 K', verdictId: t.lookupId('verdict', 'Conditional Pass'),
      },
      flags: [{
        typeId: t.lookupId('flag_type', 'Review'), assignedToId: t.userId('Nilan'), affectedDomainId: t.domainId('CK'),
        request: 'Check chuck clearance with new faceplate', dueDate: '2026-10-09',
      }],
    });
    expect(entry.body).toEqual({ considerationId: 'SH-C01', iterationId: 'SH-C01-I01', flagIds: ['SH-C01-I01-F1'] });
    const it1 = (await nisath.get('/api/iterations/SH-C01-I01')).body.iteration;
    expect(it1.authorName).toBe('Nisath');
    expect(it1.date).toBe('2026-10-05');
    expect(it1.statusLabel).toBe('Awaiting review');
    const c1 = (await nisath.get('/api/considerations/SH-C01')).body.consideration;
    expect(c1.ownerName).toBe('Nisath'); // domain owner by default

    // Nilan is told once, even though he also follows CK (the affected domain) as its owner.
    expect(unread(t, 'Nilan')).toEqual([expect.objectContaining({ kind: 'flag_assigned', entityId: 'SH-C01-I01-F1' })]);
    // Oscar follows nothing, Nisath made the change: neither is notified.
    expect(unread(t, 'Oscar')).toEqual([]);
    expect(unread(t, 'Nisath')).toEqual([]);

    const mine = (await nilan.get('/api/my-items')).body;
    expect(mine.assigned.map((f: any) => f.id)).toEqual(['SH-C01-I01-F1']);
    expect(mine.assigned[0]).toMatchObject({ sourceDomainCode: 'SH', affectedDomainCode: 'CK', sourceVerdictLabel: 'Conditional Pass', overdue: false });
    expect((await nisath.get('/api/my-items')).body.raised.map((f: any) => f.id)).toEqual(['SH-C01-I01-F1']);

    // Nilan answers and starts a consideration in his own domain.
    let f = (await nilan.get('/api/flags/SH-C01-I01-F1')).body.flag;
    f = (await nilan.patch(`/api/flags/${f.id}`, { version: f.version, response: 'Clearance drops to 0.4 mm', statusId: t.lookupId('flag_status', 'In progress') })).body;
    expect(f.response).toBe('Clearance drops to 0.4 mm');
    expect(unread(t, 'Nisath').map((n) => n.kind)).toEqual(['flag_answered']);

    const spawn = await nilan.post(`/api/flags/${f.id}/consideration`, {
      subsystemId: t.subsystemId('CK', 'Cooling Chuck'), title: 'Chuck to faceplate clearance', targetMetric: '>= 0.5 mm',
    });
    expect(spawn.body.consideration.id).toBe('CK-C01');
    expect(unread(t, 'Nisath').map((n) => n.kind)).toEqual(['flag_answered', 'flag_spawned']);

    // Overdue: move the clock past the due date.
    setNow(new Date('2026-10-12T09:00:00'));
    expect((await nilan.get('/api/my-items')).body.assigned[0].overdue).toBe(true);
    expect((await oscar.get('/api/flags?overdue=1')).body.map((x: any) => x.id)).toEqual(['SH-C01-I01-F1']);

    // Close the flag: date closed is set and both parties (minus the actor) are told.
    f = (await nilan.get(`/api/flags/${f.id}`)).body.flag;
    const closed = await nilan.patch(`/api/flags/${f.id}`, { version: f.version, statusId: t.lookupId('flag_status', 'Closed') });
    expect(closed.body).toMatchObject({ statusLabel: 'Closed', dateClosed: '2026-10-12', overdue: false });
    expect(unread(t, 'Nisath').map((n) => n.kind)).toEqual(['flag_answered', 'flag_spawned', 'flag_closed']);
    expect((await nilan.get('/api/my-items')).body.assigned).toEqual([]);

    // Audit trail: field-level rows for the flag.
    const history = (await oscar.get(`/api/history?entityType=flag&entityId=${f.id}`)).body as any[];
    const fields = history.map((h) => [h.action, h.field, h.oldValue, h.newValue]);
    expect(fields).toEqual([
      ['create', null, null, null],
      ['update', 'status', 'Open', 'In progress'],
      ['update', 'response', '', 'Clearance drops to 0.4 mm'],
      ['link', 'resultingConsiderationId', null, 'CK-C01'],
      ['update', 'status', 'In progress', 'Closed'],
      ['update', 'dateClosed', null, '2026-10-12'],
    ]);

    // Feed: newest first, built from the audit log.
    const feed = (await oscar.get('/api/feed')).body;
    expect(feed.items.map((e: any) => `${e.event} ${e.entityId}`)).toEqual([
      'flag_status SH-C01-I01-F1',
      'consideration_created CK-C01',
      'flag_answered SH-C01-I01-F1',
      'flag_status SH-C01-I01-F1',
      'flag_raised SH-C01-I01-F1',
      'iteration_logged SH-C01-I01',
      'consideration_created SH-C01',
    ]);
    const logged = feed.items.find((e: any) => e.event === 'iteration_logged');
    expect(logged).toMatchObject({ userName: 'Nisath', domainCode: 'SH', domainColour: '#DDEBF7', verdictLabel: 'Conditional Pass' });
    const raised = feed.items.find((e: any) => e.event === 'flag_raised');
    expect(raised).toMatchObject({ affectedDomainCode: 'CK', assignedToName: 'Nilan' });

    // Domain filter on CK also shows the SH flag that affects CK.
    const ck = (await oscar.get(`/api/feed?domain=${t.domainId('CK')}`)).body.items.map((e: any) => e.entityId);
    expect(new Set(ck)).toEqual(new Set(['SH-C01-I01-F1', 'CK-C01']));
    // Type filter by category.
    const flagsOnly = (await oscar.get('/api/feed?type=flag')).body.items;
    expect(flagsOnly.every((e: any) => e.event.startsWith('flag_'))).toBe(true);
    // Person filter.
    expect((await oscar.get(`/api/feed?person=${t.userId('Nisath')}`)).body.items.map((e: any) => e.event))
      .toEqual(['flag_raised', 'iteration_logged', 'consideration_created']);
  });

  it('notifies followers of new iterations and status changes, and supports the Following filter', async () => {
    t = await makeApp();
    const nisath = await t.as('Nisath');
    const sajith = await t.as('Sajith');
    const kulunu = await t.as('Kulunu');
    await nisath.post('/api/considerations', newConsideration(t, 'SH'));
    await nisath.post('/api/considerations', newConsideration(t, 'SH'));
    await kulunu.post('/api/considerations', newConsideration(t, 'DC'));

    expect((await sajith.put('/api/follows', { entityType: 'consideration', entityId: 'SH-C02' })).status).toBe(200);
    await nisath.post('/api/iterations', { considerationId: 'SH-C01' });
    await nisath.post('/api/iterations', { considerationId: 'SH-C02' });
    expect(unread(t, 'Sajith').map((n) => n.entityId)).toEqual(['SH-C02-I01']);
    // Nisath owns SH (follows it) but made the changes herself.
    expect(unread(t, 'Nisath')).toEqual([]);

    // Kulunu logs on Nisath's consideration: Nisath (domain owner + author) and Sajith are notified.
    await kulunu.post('/api/iterations', { considerationId: 'SH-C02' });
    expect(unread(t, 'Nisath').map((n) => n.entityId)).toEqual(['SH-C02-I02']);

    const c2 = (await nisath.get('/api/considerations/SH-C02')).body.consideration;
    await nisath.patch('/api/considerations/SH-C02', { version: c2.version, statusId: t.lookupId('consideration_status', 'Closed') });
    expect(unread(t, 'Sajith').map((n) => n.kind)).toEqual(['iteration_logged', 'iteration_logged', 'consideration_status']);
    // Closed consideration takes no new iterations.
    expect((await kulunu.post('/api/iterations', { considerationId: 'SH-C02' })).status).toBe(409);

    const following = (await sajith.get('/api/considerations?following=1')).body.map((c: any) => c.id);
    expect(following).toEqual(['SH-C02']);
    const feed = (await sajith.get('/api/feed?following=1')).body.items;
    expect(feed.every((e: any) => e.considerationId === 'SH-C02')).toBe(true);
    expect((await sajith.del('/api/follows?entityType=consideration&entityId=SH-C02')).body.following).toBe(false);
    expect((await sajith.get('/api/considerations?following=1')).body).toEqual([]);
  });

  it('records comments in the feed and the since-last-visit marker', async () => {
    setNow(new Date('2026-10-05T09:00:00Z'));
    t = await makeApp();
    const nisath = await t.as('Nisath');
    await nisath.post('/api/considerations', newConsideration(t, 'SH'));
    expect((await nisath.post('/api/feed/seen')).body.lastVisit).toBeNull();
    setNow(new Date('2026-10-05T10:00:00Z'));
    const c = await nisath.post('/api/comments', { entityType: 'consideration', entityId: 'SH-C01', body: 'Need the 3D model first' });
    expect(c.status).toBe(201);
    const feed = (await nisath.get('/api/feed')).body;
    expect(feed.lastVisit).toBe('2026-10-05T09:00:00.000Z');
    expect(feed.items[0]).toMatchObject({ event: 'comment_added', entityId: 'SH-C01', text: 'Need the 3D model first' });
    expect((await nisath.get('/api/comments?entityType=consideration&entityId=SH-C01')).body).toHaveLength(1);
  });
});
