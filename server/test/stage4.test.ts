import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { afterEach, describe, expect, it } from 'vitest';
import { runBackup, listBackups } from '../src/backup.js';
import { buildWorkbook } from '../src/export.js';
import { buildDigest, sendWeeklyDigest } from '../src/digest.js';
import { importWorkbook } from '../src/importer.js';
import { setNow } from '../src/time.js';
import { makeApp, newConsideration, type TestApp } from './helpers.js';

let t: TestApp;
let other: TestApp | null = null;
afterEach(async () => {
  setNow(null);
  await t?.close();
  await other?.close();
  other = null;
});

/** SH-C01 (I01 Pass, I02 Fail) with a review to CK that spawned CK-C01 (I01 Conditional). */
async function chain() {
  const nisath = await t.as('Nisath');
  const nilan = await t.as('Nilan');
  await nisath.post('/api/entries', {
    consideration: newConsideration(t, 'SH', { title: 'Faceplate uniformity' }),
    iteration: { designInput: 'Pattern A', verdictId: t.lookupId('verdict', 'Pass') },
  });
  await nisath.post('/api/entries', {
    iteration: { considerationId: 'SH-C01', designInput: 'Pattern B', verdictId: t.lookupId('verdict', 'Fail') },
    flags: [{ typeId: t.lookupId('flag_type', 'Review'), assignedToId: t.userId('Nilan'), affectedDomainId: t.domainId('CK'), request: 'Seal ring too hot?', dueDate: '2026-10-01' }],
  });
  await nilan.post('/api/flags/SH-C01-I02-F1/consideration', { subsystemId: t.subsystemId('CK', 'Seal Ring'), title: 'Seal ring temperature' });
  await nilan.post('/api/iterations', { considerationId: 'CK-C01', designInput: 'Copper insert', verdictId: t.lookupId('verdict', 'Conditional Pass') });
}

describe('dashboard', () => {
  it('counts per domain and per person', async () => {
    setNow(new Date('2026-10-16T10:00:00'));
    t = await makeApp();
    await chain();
    const d = (await (await t.as('Upul')).get('/api/dashboard')).body;
    const sh = d.domains.find((x: any) => x.code === 'SH');
    const ck = d.domains.find((x: any) => x.code === 'CK');
    expect(sh).toMatchObject({ considerations: 1, openConsiderations: 1, iterations: 2, pass: 1, fail: 1, conditional: 0, openFlagsRaised: 1 });
    expect(ck).toMatchObject({ considerations: 1, iterations: 1, conditional: 1, openFlagsAffecting: 1, overdueAffecting: 1 });
    const nilan = d.people.find((p: any) => p.name === 'Nilan');
    expect(nilan).toMatchObject({ openFlags: 1, reviewsToDo: 1, overdue: 1, iterationsAuthored: 1 });
    expect(d.weeks).toHaveLength(8);
  });
});

describe('trace', () => {
  it('shows the whole chain from the root, across domains, from any consideration in it', async () => {
    t = await makeApp();
    await chain();
    const fromCk = (await (await t.as('Upul')).get('/api/considerations/CK-C01/trace')).body;
    expect(fromCk.focus).toBe('CK-C01');
    const root = fromCk.root;
    expect(root.id).toBe('SH-C01');
    expect(root.children.map((c: any) => c.id)).toEqual(['SH-C01-I01', 'SH-C01-I02']);
    const flag = root.children[1].children[0];
    expect(flag).toMatchObject({ kind: 'flag', id: 'SH-C01-I02-F1', domainCode: 'CK' });
    expect(flag.children[0]).toMatchObject({ kind: 'consideration', id: 'CK-C01', domainCode: 'CK' });
    expect(flag.children[0].children[0]).toMatchObject({ id: 'CK-C01-I01', toneLabel: 'Conditional Pass' });
  });
});

describe('Excel import', () => {
  async function exported(app: TestApp) {
    const wb = await buildWorkbook(app.db, { domains: [], openOnly: false, includeComments: false, includeHistory: false, baseUrl: 'http://x', exportedBy: 'Oscar' });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
  const oscar = (app: TestApp) => ({ id: app.userId('Oscar'), name: 'Oscar', email: null, role: 'manager' as const, mustChangePassword: false });

  it('round-trips an export into an empty tracker, keeping IDs and links', async () => {
    t = await makeApp();
    await chain();
    const file = await exported(t);
    other = await makeApp();

    const preview = await importWorkbook(other.db, file, oscar(other), true);
    expect(preview.errors).toEqual([]);
    expect(preview.created).toEqual({ considerations: ['SH-C01', 'CK-C01'], iterations: ['CK-C01-I01', 'SH-C01-I01', 'SH-C01-I02'], flags: ['SH-C01-I02-F1'] });
    expect(other.db.prepare('SELECT count(*) FROM considerations').pluck().get()).toBe(0); // preview saves nothing

    const done = await importWorkbook(other.db, file, oscar(other), false);
    expect(done.errors).toEqual([]);
    const o = await other.as('Oscar');
    const ck = (await o.get('/api/considerations/CK-C01')).body;
    expect(ck.consideration.originFlagId).toBe('SH-C01-I02-F1');
    expect(ck.iterations[0].parentFlagId).toBe('SH-C01-I02-F1');
    const f = (await o.get('/api/flags/SH-C01-I02-F1')).body.flag;
    expect(f).toMatchObject({ resultingConsiderationId: 'CK-C01', assignedToName: 'Nilan', typeLabel: 'Review', dueDate: '2026-10-01' });
    const i2 = (await o.get('/api/iterations/SH-C01-I02')).body.iteration;
    expect(i2).toMatchObject({ parentIterationId: 'SH-C01-I01', verdictLabel: 'Fail', designInput: 'Pattern B' });
    // Numbering continues after the imported IDs.
    expect((await o.post('/api/considerations', newConsideration(other, 'SH'))).body.id).toBe('SH-C02');

    // Importing the same file again changes nothing.
    const again = await importWorkbook(other.db, file, oscar(other), false);
    expect(again.created).toEqual({ considerations: [], iterations: [], flags: [] });
    expect(again.skipped.map((s) => s.id)).toContain('SH-C01');
  });

  it('reports every problem and saves nothing when a row is wrong', async () => {
    t = await makeApp();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Considerations');
    ws.addRow(['Consideration ID', 'Domain', 'Sub-system', 'Title', 'Design Consideration / Requirement / Target Metric', 'Owner']);
    ws.addRow(['SH-C05', 'SH', 'Showerhead', 'Good row', '< 2 K', 'Nisath']);
    ws.addRow(['', 'XX', 'Showerhead', 'Bad domain', '', '']);
    ws.addRow(['', 'CK', 'Not a sub-system', 'Bad sub-system', '', '']);
    ws.addRow(['', 'SH', 'Showerhead', 'Bad owner', '', 'Somebody']);
    const res = await importWorkbook(t.db, Buffer.from(await wb.xlsx.writeBuffer()), oscar(t), false);
    expect(res.errors.map((e) => e.row)).toEqual([3, 4, 5]);
    expect(res.errors[0].message).toContain('Unknown domain "XX"');
    expect(res.created.considerations).toEqual([]);
    expect(t.db.prepare('SELECT count(*) FROM considerations').pluck().get()).toBe(0);
  });

  it('is available to managers only, as a file upload', async () => {
    t = await makeApp();
    await chain();
    const file = await exported(t);
    const boundary = '----dit';
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.xlsx"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      file,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const send = async (name: string) => t.app.inject({
      method: 'POST', url: '/api/import?dryRun=1', payload,
      headers: { cookie: (await t.as(name)).cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    expect((await send('Nisath')).statusCode).toBe(403);
    const res = await send('Oscar');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).skipped.length).toBe(6); // 2 considerations, 3 iterations, 1 flag: all already present
  });
});

describe('backups', () => {
  it('copies the database and keeps 30 days', async () => {
    t = await makeApp();
    await chain();
    const dir = t.svc.config.backupDir;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'tracker-2020-01-01.db'), 'old');
    const b = await runBackup(t.svc);
    expect(b.file).toMatch(/^tracker-\d{4}-\d{2}-\d{2}\.db$/);
    expect(b.size).toBeGreaterThan(10_000);
    expect(listBackups(t.svc).map((x) => x.file)).toEqual([b.file]); // the old one was pruned
    // A second backup the same day gets its own name.
    const b2 = await runBackup(t.svc);
    expect(b2.file).not.toBe(b.file);
    // The copy is a working database.
    const Database = (await import('better-sqlite3')).default;
    const copy = new Database(path.join(dir, b.file), { readonly: true });
    expect(copy.prepare('SELECT count(*) FROM considerations').pluck().get()).toBe(2);
    copy.close();
    const o = await t.as('Oscar');
    expect((await (await t.as('Nisath')).post('/api/admin/backup')).status).toBe(403);
    expect((await o.post('/api/admin/backup')).status).toBe(200);
  });
});

describe('weekly digest', () => {
  it('summarises followed activity and what is waiting on the person', async () => {
    setNow(new Date('2026-10-14T10:00:00')); // Wednesday
    t = await makeApp();
    await chain();
    setNow(new Date('2026-10-19T08:00:00')); // next Monday
    const sent = sendWeeklyDigest(t.svc);
    expect(sent).toBeGreaterThan(0);
    // Nisath owns SH (follows it): sees SH activity.
    const n = t.db.prepare("SELECT id, title, body FROM notifications WHERE user_id = ? AND kind = 'digest'").get(t.userId('Nisath')) as any;
    expect(n.title).toBe('Weekly digest: 12 Oct to 18 Oct');
    expect(n.body).toContain('2 iterations logged (1 Pass, 0 Conditional, 1 Fail)');
    expect(n.body).toContain('SH-C01 Faceplate uniformity');
    // Nilan has an open review waiting.
    const nilan = buildDigest(t.svc, t.userId('Nilan'), new Date('2026-10-12T00:00:00'), new Date('2026-10-19T00:00:00'))!;
    expect(nilan.body).toContain('Waiting on you: 1 open flag, 1 overdue');
    // Readable in full through its own endpoint.
    const res = await (await t.as('Nisath')).get(`/api/notifications/${n.id}`);
    expect(res.body.body).toBe(n.body);
    // Sajith follows nothing and has nothing open: no digest.
    expect(buildDigest(t.svc, t.userId('Sajith'), new Date('2026-10-12T00:00:00'), new Date('2026-10-19T00:00:00'))).toBeNull();
  });
});
