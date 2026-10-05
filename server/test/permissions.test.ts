import { afterEach, describe, expect, it } from 'vitest';
import { client, login, makeApp, newConsideration, type TestApp } from './helpers.js';

let t: TestApp;
afterEach(async () => t?.close());

/** Nisath: SH-C01 with iteration I01 and flag F1 assigned to Nilan. */
async function scenario() {
  t = await makeApp();
  const nisath = await t.as('Nisath');
  await nisath.post('/api/entries', {
    consideration: newConsideration(t, 'SH'),
    iteration: { designInput: 'v1' },
    flags: [{ assignedToId: t.userId('Nilan'), affectedDomainId: t.domainId('CK'), request: 'Check it' }],
  });
  return {
    nisath, nilan: await t.as('Nilan'), upul: await t.as('Upul'), kulunu: await t.as('Kulunu'), oscar: await t.as('Oscar'),
  };
}

const version = async (c: Awaited<ReturnType<typeof scenario>>['oscar'], url: string, key: string) =>
  (await c.get(url)).body[key].version as number;

describe('authentication', () => {
  it('requires a session for every API route', async () => {
    t = await makeApp();
    const anon = client(t.app);
    for (const url of ['/api/considerations', '/api/meta', '/api/feed', '/api/my-items', '/api/stream']) {
      expect((await anon.get(url)).status).toBe(401);
    }
    expect((await anon.post('/api/entries', {})).status).toBe(401);
  });

  it('rejects wrong passwords and inactive users', async () => {
    t = await makeApp();
    const bad = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { name: 'Nilan', password: 'nope-nope' } });
    expect(bad.statusCode).toBe(401);
    t.db.prepare("UPDATE users SET active = 0 WHERE name = 'Upul'").run();
    await expect(login(t.app, 'Upul')).rejects.toThrow();
  });

  it('first run lets the manager set a password, once', async () => {
    t = await makeApp({ passwords: false });
    const anon = client(t.app);
    expect((await anon.get('/api/setup')).body).toEqual({ needsSetup: true, managerName: 'Oscar' });
    // Designers cannot sign in before the manager gives them a password.
    const noPw = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { name: 'Nilan', password: 'whatever1' } });
    expect(JSON.parse(noPw.body).error).toBe('no_password');

    const setup = await anon.post('/api/setup', { name: 'Oscar', password: 'manager-pass' });
    expect(setup.status).toBe(200);
    expect(setup.body).toMatchObject({ name: 'Oscar', role: 'manager' });
    expect((await anon.get('/api/setup')).body.needsSetup).toBe(false);
    expect((await anon.post('/api/setup', { name: 'Mallory', password: 'takeover1' })).status).toBe(403);

    const oscar = await login(t.app, 'Oscar', 'manager-pass');
    const reset = await oscar.post(`/api/users/${t.userId('Nilan')}/password`, { password: 'temporary1' });
    expect(reset.body.mustChangePassword).toBe(1);

    // Nilan must choose a new password before using the app.
    const nilan = await login(t.app, 'Nilan', 'temporary1');
    const otherTab = await login(t.app, 'Nilan', 'temporary1');
    expect((await nilan.get('/api/considerations')).body.error).toBe('password_change_required');
    expect((await nilan.post('/api/auth/password', { newPassword: 'nilans-own' })).status).toBe(200);
    expect((await nilan.get('/api/considerations')).status).toBe(200);
    // Other sessions were signed out by the change; the new password works.
    expect((await otherTab.get('/api/auth/me')).status).toBe(401);
    expect((await (await login(t.app, 'Nilan', 'nilans-own')).get('/api/auth/me')).body.name).toBe('Nilan');
  });
});

describe('manager-only admin', () => {
  it('blocks designers from admin endpoints', async () => {
    const { nisath, oscar } = await scenario();
    const calls: Array<[string, string, unknown?]> = [
      ['GET', '/api/users'],
      ['POST', '/api/users', { name: 'Eve', password: 'password1' }],
      ['POST', `/api/users/${t.userId('Nilan')}/password`, { password: 'password1' }],
      ['POST', '/api/domains', { code: 'PC', name: 'Pyrolysis', colour: '#EEEEEE' }],
      ['POST', `/api/domains/${t.domainId('SH')}/subsystems`, { name: 'Gas Box' }],
      ['POST', '/api/lookups', { category: 'verdict', label: 'Pending', behaviour: 'fail' }],
    ];
    for (const [method, url, body] of calls) {
      const res = method === 'GET' ? await nisath.get(url) : await nisath.post(url, body);
      expect([url, res.status]).toEqual([url, 403]);
    }
    const created = await oscar.post('/api/domains', { code: 'pc', name: 'Pyrolysis Chamber', colour: '#f8d7e3', ownerId: t.userId('Sajith') });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ code: 'PC', colour: '#F8D7E3', ownerName: 'Sajith' });
    const sub = await oscar.post(`/api/domains/${created.body.id}/subsystems`, { name: 'Reactor' });
    expect(sub.status).toBe(201);
    // Owner of a new domain follows it by default.
    const follows = (await (await t.as('Sajith')).get('/api/follows')).body;
    expect(follows).toContainEqual(expect.objectContaining({ entityType: 'domain', entityId: String(created.body.id) }));
    // Everyone can read the dropdown data.
    const meta = (await nisath.get('/api/meta')).body;
    expect(meta.domains.map((d: any) => d.code)).toEqual(['SH', 'CK', 'DC', 'SL', 'PC']);
  });

  it('freezes a domain code once it has been used in an ID', async () => {
    const { oscar } = await scenario();
    const domains = (await oscar.get('/api/meta')).body.domains;
    const sh = domains.find((d: any) => d.code === 'SH');
    const dc = domains.find((d: any) => d.code === 'DC');
    expect((await oscar.patch(`/api/domains/${sh.id}`, { version: sh.version, code: 'SX' })).status).toBe(409);
    const renamed = await oscar.patch(`/api/domains/${dc.id}`, { version: dc.version, code: 'TD' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.code).toBe('TD');
  });

  it('keeps at least one active manager', async () => {
    const { oscar } = await scenario();
    const me = (await oscar.get('/api/users')).body.find((u: any) => u.name === 'Oscar');
    expect((await oscar.patch(`/api/users/${me.id}`, { version: me.version, role: 'designer' })).status).toBe(409);
  });

  it('lets a lookup be renamed but not given a meaning that does not exist', async () => {
    const { oscar } = await scenario();
    expect((await oscar.post('/api/lookups', { category: 'verdict', label: 'Pending', behaviour: 'maybe' })).status).toBe(400);
    const pass = (await oscar.get('/api/meta')).body.lookups.find((l: any) => l.label === 'Pass');
    const renamed = await oscar.patch(`/api/lookups/${pass.id}`, { version: pass.version, label: 'Passed' });
    expect(renamed.body).toMatchObject({ label: 'Passed', behaviour: 'pass' });
  });
});

describe('editing rules', () => {
  it('consideration: owner, creator or manager', async () => {
    const { nisath, upul, oscar } = await scenario();
    const url = '/api/considerations/SH-C01';
    expect((await upul.patch(url, { version: await version(oscar, url, 'consideration'), title: 'x' })).status).toBe(403);
    expect((await nisath.patch(url, { version: await version(oscar, url, 'consideration'), title: 'by owner' })).status).toBe(200);
    expect((await oscar.patch(url, { version: await version(oscar, url, 'consideration'), title: 'by manager' })).status).toBe(200);
    // Creator who is not the owner.
    const created = await upul.post('/api/considerations', newConsideration(t, 'SH', { ownerId: t.userId('Nisath') }));
    expect(created.body.ownerName).toBe('Nisath');
    expect((await upul.patch(`/api/considerations/${created.body.id}`, { version: created.body.version, notes: 'mine' })).status).toBe(200);
  });

  it('sub-system must belong to the consideration\'s domain', async () => {
    const { nisath, oscar } = await scenario();
    const bad = await nisath.post('/api/considerations', newConsideration(t, 'SH', { subsystemId: t.subsystemId('CK', 'Seal Ring') }));
    expect(bad.status).toBe(400);
    const url = '/api/considerations/SH-C01';
    const res = await nisath.patch(url, { version: await version(oscar, url, 'consideration'), subsystemId: t.subsystemId('SL', 'EFEM') });
    expect(res.status).toBe(400);
  });

  it('iteration: author, consideration owner or manager; read-only once closed', async () => {
    const { nisath, nilan, upul, oscar } = await scenario();
    // Upul logs I02 on Nisath's consideration.
    await upul.post('/api/iterations', { considerationId: 'SH-C01', designInput: 'v2' });
    const url = '/api/iterations/SH-C01-I02';
    expect((await nilan.patch(url, { version: await version(oscar, url, 'iteration'), designInput: 'x' })).status).toBe(403);
    expect((await upul.patch(url, { version: await version(oscar, url, 'iteration'), designInput: 'author' })).status).toBe(200);
    expect((await nisath.patch(url, { version: await version(oscar, url, 'iteration'), designInput: 'owner' })).status).toBe(200);

    const closed = await upul.patch(url, { version: await version(oscar, url, 'iteration'), statusId: t.lookupId('iteration_status', 'Closed'), verdictId: t.lookupId('verdict', 'Pass') });
    expect(closed.body.statusLabel).toBe('Closed');
    for (const who of [upul, nisath, oscar]) {
      const res = await who.patch(url, { version: await version(oscar, url, 'iteration'), designInput: 'late edit' });
      expect(res.status).toBe(409);
    }
    // Attachments are frozen too; comments are still allowed.
    expect((await upul.post('/api/attachments/link', { entityType: 'iteration', entityId: 'SH-C01-I02', url: '\\\\srv\\cad\\v2' })).status).toBe(409);
    expect((await upul.post('/api/comments', { entityType: 'iteration', entityId: 'SH-C01-I02', body: 'ok' })).status).toBe(201);

    expect((await nisath.post(`${url}/reopen`, { version: await version(oscar, url, 'iteration') })).status).toBe(403);
    const reopened = await oscar.post(`${url}/reopen`, { version: await version(oscar, url, 'iteration') });
    expect(reopened.body.statusLabel).toBe('In progress');
    expect((await upul.patch(url, { version: reopened.body.version, designInput: 'after reopen' })).status).toBe(200);
    const history = (await oscar.get('/api/history?entityType=iteration&entityId=SH-C01-I02')).body.map((h: any) => h.action);
    expect(history).toContain('reopen');
  });

  it('flag: raiser edits the request, assignee responds, both can close, others cannot', async () => {
    const { nisath, nilan, upul, oscar } = await scenario();
    const url = '/api/flags/SH-C01-I01-F1';
    const v = () => version(oscar, url, 'flag');
    expect((await nisath.patch(url, { version: await v(), response: 'answering my own flag' })).status).toBe(403);
    expect((await nilan.patch(url, { version: await v(), request: 'rewritten by assignee' })).status).toBe(403);
    expect((await upul.patch(url, { version: await v(), statusId: t.lookupId('flag_status', 'Closed') })).status).toBe(403);

    expect((await nisath.patch(url, { version: await v(), request: 'Check it, with drawing' })).status).toBe(200);
    expect((await nilan.patch(url, { version: await v(), response: 'Done' })).status).toBe(200);
    // Sending unchanged request fields alongside a response is fine for the assignee.
    const f = (await oscar.get(url)).body.flag;
    expect((await nilan.patch(url, { version: f.version, request: f.request, response: 'Done, see report' })).status).toBe(200);
    expect((await nisath.patch(url, { version: await v(), statusId: t.lookupId('flag_status', 'Closed') })).status).toBe(200);
    // Reassign by the raiser: new assignee is notified.
    const r = await nisath.patch(url, { version: await v(), assignedToId: t.userId('Kulunu') });
    expect(r.body.assignedToName).toBe('Kulunu');
    const n = t.db.prepare("SELECT kind FROM notifications WHERE user_id = ?").pluck().all(t.userId('Kulunu'));
    expect(n).toContain('flag_assigned');
  });

  it('only the assignee, raiser or a manager can start a consideration from a flag', async () => {
    const { upul, oscar } = await scenario();
    const body = { subsystemId: t.subsystemId('CK', 'Seal Ring'), title: 'From flag' };
    expect((await upul.post('/api/flags/SH-C01-I01-F1/consideration', body)).status).toBe(403);
    expect((await oscar.post('/api/flags/SH-C01-I01-F1/consideration', body)).status).toBe(201);
  });

  it('detects stale edits from two people working on the same record', async () => {
    const { nisath, oscar } = await scenario();
    const url = '/api/considerations/SH-C01';
    const loaded = (await nisath.get(url)).body.consideration;
    // Both open the record; Oscar saves first.
    expect((await oscar.patch(url, { version: loaded.version, notes: 'Oscar was here' })).status).toBe(200);
    const late = await nisath.patch(url, { version: loaded.version, notes: 'Nisath overwrites' });
    expect(late.status).toBe(409);
    expect(late.body.error).toBe('stale');
    expect(late.body.details.current.notes).toBe('Oscar was here');
    // Flags and iterations behave the same way.
    const f = (await nisath.get('/api/flags/SH-C01-I01-F1')).body.flag;
    await nisath.patch('/api/flags/SH-C01-I01-F1', { version: f.version, request: 'one' });
    expect((await nisath.patch('/api/flags/SH-C01-I01-F1', { version: f.version, request: 'two' })).body.error).toBe('stale');
  });

  it('validates input on the server', async () => {
    const { nisath } = await scenario();
    const cases: Array<[string, unknown]> = [
      ['/api/considerations', { ...newConsideration(t, 'SH'), title: '' }],
      ['/api/considerations', { ...newConsideration(t, 'SH'), title: 'x'.repeat(201) }],
      ['/api/iterations', { considerationId: 'SH-C01', date: '2026-02-30' }],
      ['/api/iterations', { considerationId: 'nonsense' }],
      ['/api/iterations', { considerationId: 'SH-C01', verdictId: t.lookupId('flag_status', 'Open') }],
      ['/api/flags', { iterationId: 'SH-C01-I01', assignedToId: t.userId('Nilan'), affectedDomainId: t.domainId('CK'), request: '  ' }],
      ['/api/flags', { iterationId: 'SH-C01-I01', assignedToId: t.userId('Nilan'), affectedDomainId: 999, request: 'x' }],
      ['/api/entries', {}],
    ];
    for (const [url, body] of cases) {
      const res = await nisath.post(url, body);
      expect([url, res.status]).toEqual([url, 400]);
    }
  });
});
