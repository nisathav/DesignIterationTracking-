import { afterEach, describe, expect, it } from 'vitest';
import { escalateOverdueFlags } from '../src/scheduler.js';
import { setTeamsSender } from '../src/teams.js';
import { setNow } from '../src/time.js';
import { makeApp, newConsideration, type TestApp } from './helpers.js';

let t: TestApp;
let sent: Array<{ url: string; body: any }> = [];
afterEach(async () => {
  setTeamsSender(null);
  setNow(null);
  await t?.close();
});

const WEBHOOK = 'https://prod-00.westeurope.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?sig=x';

async function setup(opts: { fail?: boolean; events?: Record<string, boolean> } = {}) {
  t = await makeApp();
  sent = [];
  setTeamsSender(async (url, body) => {
    sent.push({ url, body });
    if (opts.fail) throw new Error('Teams answered 404 Not Found');
  });
  t.db.prepare("UPDATE users SET email = lower(name) || '@company.com' WHERE name <> 'Sajith'").run();
  const oscar = await t.as('Oscar');
  const res = await oscar.put('/api/admin/teams', { enabled: true, webhookUrl: WEBHOOK, appUrl: 'http://192.168.1.25:8080', events: opts.events ?? {} });
  expect(res.status).toBe(200);
  return oscar;
}

const card = (i: number) => sent[i].body.attachments[0].content;
const texts = (i: number) => card(i).body.map((b: any) => b.text ?? '').join(' | ');

async function raiseReview(assignee: string, domain: string) {
  const nisath = await t.as('Nisath');
  await nisath.post('/api/entries', {
    consideration: newConsideration(t, 'SH', { title: 'Faceplate uniformity' }),
    iteration: {},
    flags: [{ typeId: t.lookupId('flag_type', 'Review'), assignedToId: t.userId(assignee), affectedDomainId: t.domainId(domain), request: 'Check the chuck gap', dueDate: '2026-10-20' }],
  });
  return nisath;
}

describe('Teams channel alerts', () => {
  it('posts a card that @mentions the assignee when a flag is raised', async () => {
    await setup();
    await raiseReview('Nilan', 'CK');
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(WEBHOOK);
    const c = card(0);
    expect(c.type).toBe('AdaptiveCard');
    expect(texts(0)).toContain('Review for you: SH-C01-I01-F1');
    expect(texts(0)).toContain('<at>Nilan</at>, Nisath asks you to review SH-C01-I01 (Faceplate uniformity).');
    expect(texts(0)).toContain('Check the chuck gap');
    expect(c.msteams.entities).toEqual([{ type: 'mention', text: '<at>Nilan</at>', mentioned: { id: 'nilan@company.com', name: 'Nilan' } }]);
    expect(c.actions[0]).toEqual({ type: 'Action.OpenUrl', title: 'Open in tracker', url: 'http://192.168.1.25:8080/flags/SH-C01-I01-F1' });
    expect(c.body.find((b: any) => b.type === 'FactSet').facts).toContainEqual({ title: 'Due', value: '2026-10-20' });
  });

  it('names people without an email in bold instead of mentioning them', async () => {
    await setup();
    await raiseReview('Sajith', 'SL');
    expect(texts(0)).toContain('**Sajith**, Nisath asks you to review');
    expect(card(0).msteams.entities).toEqual([]);
  });

  it('alerts the new assignee on reassignment, and the author/owner/raiser on a review outcome', async () => {
    await setup();
    const nisath = await raiseReview('Nilan', 'CK');
    let f = (await nisath.get('/api/flags/SH-C01-I01-F1')).body.flag;
    await nisath.patch('/api/flags/SH-C01-I01-F1', { version: f.version, assignedToId: t.userId('Kulunu') });
    expect(texts(1)).toContain('<at>Kulunu</at>, Nisath asks you to review');

    const kulunu = await t.as('Kulunu');
    f = (await kulunu.get('/api/flags/SH-C01-I01-F1')).body.flag;
    await kulunu.patch('/api/flags/SH-C01-I01-F1', { version: f.version, reviewOutcome: 'changes_needed', response: 'Gap too small', statusId: t.lookupId('flag_status', 'Closed') });
    expect(texts(2)).toContain('Review Changes needed: SH-C01-I01-F1');
    expect(card(2).msteams.entities.map((e: any) => e.mentioned.name)).toEqual(['Nisath']);
  });

  it('alerts the managers on escalation and on overdue flags', async () => {
    setNow(new Date('2026-10-16T09:00:00'));
    await setup();
    const nisath = await raiseReview('Nilan', 'CK');
    const f = (await nisath.get('/api/flags/SH-C01-I01-F1')).body.flag;
    await nisath.patch('/api/flags/SH-C01-I01-F1', { version: f.version, dueDate: '2026-10-10' });
    await (await t.as('Nilan')).post('/api/flags/SH-C01-I01-F1/escalate', { reason: 'Needs a decision on the gap' });
    const esc = sent.find((s) => s.body.attachments[0].content.body[0].text.startsWith('Escalated'))!;
    expect(esc.body.attachments[0].content.msteams.entities.map((e: any) => e.mentioned.id)).toEqual(['oscar@company.com']);

    escalateOverdueFlags(t.svc);
    const overdue = sent.find((s) => s.body.attachments[0].content.body[0].text.startsWith('Overdue'))!;
    expect(overdue.body.attachments[0].content.msteams.entities.map((e: any) => e.mentioned.name)).toEqual(['Nilan', 'Oscar']);
  });

  it('respects the on/off switches and never breaks a save when Teams fails', async () => {
    await setup({ fail: true, events: { flag_assigned: false } });
    const nisath = await raiseReview('Nilan', 'CK');
    expect(sent).toHaveLength(0); // switched off
    const oscar = await t.as('Oscar');
    await oscar.put('/api/admin/teams', { enabled: true, webhookUrl: WEBHOOK, appUrl: 'http://192.168.1.25:8080', events: { flag_assigned: true } });
    const f = (await nisath.get('/api/flags/SH-C01-I01-F1')).body.flag;
    const res = await nisath.patch('/api/flags/SH-C01-I01-F1', { version: f.version, assignedToId: t.userId('Kulunu') });
    expect(res.status).toBe(200); // the save succeeds although Teams refused
    await new Promise((r) => setTimeout(r, 10));
    const status = (await oscar.get('/api/admin/teams')).body.lastResult;
    expect(status).toMatchObject({ ok: false, message: 'Teams answered 404 Not Found' });
  });

  it('is managed by managers only and can send a test message', async () => {
    const oscar = await setup();
    expect((await (await t.as('Nisath')).get('/api/admin/teams')).status).toBe(403);
    expect((await oscar.put('/api/admin/teams', { enabled: true, webhookUrl: 'http://not-https', appUrl: 'http://x:8080', events: {} })).status).toBe(400);
    const test = await oscar.post('/api/admin/teams/test');
    expect(test.status).toBe(200);
    expect(texts(0)).toContain('<at>Oscar</at>, Teams alerts are connected.');
    // Disabled: nothing is posted.
    await oscar.put('/api/admin/teams', { enabled: false, webhookUrl: WEBHOOK, appUrl: 'http://192.168.1.25:8080', events: {} });
    await raiseReview('Nilan', 'CK');
    expect(sent).toHaveLength(1);
  });
});
