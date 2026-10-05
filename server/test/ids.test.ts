import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { formatId, nextSeq } from '../src/ids.js';
import { makeApp, newConsideration, type TestApp } from './helpers.js';

let t: TestApp;
afterEach(async () => t?.close());

describe('ID format', () => {
  it('pads consideration and iteration numbers to two digits, flags unpadded', () => {
    expect(formatId.consideration('SH', 1)).toBe('SH-C01');
    expect(formatId.consideration('SH', 123)).toBe('SH-C123');
    expect(formatId.iteration('SH-C01', 3)).toBe('SH-C01-I03');
    expect(formatId.flag('SH-C01-I03', 1)).toBe('SH-C01-I03-F1');
    expect(formatId.flag('SH-C01-I03', 12)).toBe('SH-C01-I03-F12');
  });

  it('refuses to hand out numbers outside a transaction', async () => {
    t = await makeApp();
    expect(() => nextSeq(t.db, 'C:1')).toThrow(/inside a transaction/);
  });
});

describe('ID generation', () => {
  it('numbers considerations per domain, iterations per consideration and flags per iteration', async () => {
    t = await makeApp();
    const u = await t.as('Nisath');
    const c1 = await u.post('/api/considerations', newConsideration(t, 'SH'));
    const c2 = await u.post('/api/considerations', newConsideration(t, 'SH'));
    const k1 = await u.post('/api/considerations', newConsideration(t, 'CK'));
    expect([c1.body.id, c2.body.id, k1.body.id]).toEqual(['SH-C01', 'SH-C02', 'CK-C01']);

    const i1 = await u.post('/api/iterations', { considerationId: 'SH-C01' });
    const i2 = await u.post('/api/iterations', { considerationId: 'SH-C01' });
    const j1 = await u.post('/api/iterations', { considerationId: 'SH-C02' });
    expect([i1.body.id, i2.body.id, j1.body.id]).toEqual(['SH-C01-I01', 'SH-C01-I02', 'SH-C02-I01']);

    const flag = { assignedToId: t.userId('Nilan'), affectedDomainId: t.domainId('CK'), request: 'Check seal load' };
    const f1 = await u.post('/api/flags', { ...flag, iterationId: 'SH-C01-I02' });
    const f2 = await u.post('/api/flags', { ...flag, iterationId: 'SH-C01-I02' });
    const g1 = await u.post('/api/flags', { ...flag, iterationId: 'SH-C01-I01' });
    expect([f1.body.id, f2.body.id, g1.body.id]).toEqual(['SH-C01-I02-F1', 'SH-C01-I02-F2', 'SH-C01-I01-F1']);
  });

  it('never reuses a number, even after the record is withdrawn', async () => {
    t = await makeApp();
    const u = await t.as('Nisath');
    const c1 = (await u.post('/api/considerations', newConsideration(t, 'SH'))).body;
    const withdrawn = t.lookupId('consideration_status', 'Withdrawn');
    const w = await u.patch(`/api/considerations/${c1.id}`, { version: c1.version, statusId: withdrawn });
    expect(w.status).toBe(200);
    expect(w.body.statusLabel).toBe('Withdrawn');
    const c2 = await u.post('/api/considerations', newConsideration(t, 'SH'));
    expect(c2.body.id).toBe('SH-C02');
  });

  it('IDs cannot be supplied or changed by the client', async () => {
    t = await makeApp();
    const u = await t.as('Nisath');
    const bad = await u.post('/api/considerations', { ...newConsideration(t, 'SH'), id: 'SH-C99' });
    expect(bad.status).toBe(400);
    const c = (await u.post('/api/considerations', newConsideration(t, 'SH'))).body;
    const patch = await u.patch(`/api/considerations/${c.id}`, { version: c.version, id: 'SH-C42' });
    expect(patch.status).toBe(400);
    const domainChange = await u.patch(`/api/considerations/${c.id}`, { version: c.version, domainId: t.domainId('CK') });
    expect(domainChange.status).toBe(400);
  });

  it('previews the next ID without consuming it', async () => {
    t = await makeApp();
    const u = await t.as('Nisath');
    const p1 = await u.get(`/api/ids/next?domainId=${t.domainId('SH')}`);
    const p2 = await u.get(`/api/ids/next?domainId=${t.domainId('SH')}`);
    expect(p1.body.consideration).toBe('SH-C01');
    expect(p2.body.consideration).toBe('SH-C01');
    await u.post('/api/considerations', newConsideration(t, 'SH'));
    const p3 = await u.get(`/api/ids/next?domainId=${t.domainId('SH')}&considerationId=SH-C01`);
    expect(p3.body).toEqual({ consideration: 'SH-C02', iteration: 'SH-C01-I01' });
  });

  it('gives unique, gap-free IDs to many simultaneous saves', async () => {
    t = await makeApp();
    const users = await Promise.all(['Nisath', 'Nilan', 'Kulunu', 'Upul', 'Sajith', 'Oscar'].map((n) => t.as(n)));
    const results = await Promise.all(
      Array.from({ length: 60 }, (_, i) => users[i % users.length].post('/api/entries', {
        consideration: newConsideration(t, 'SH', { title: `parallel ${i}` }),
        iteration: {},
        flags: [
          { assignedToId: t.userId('Nilan'), affectedDomainId: t.domainId('CK'), request: 'a' },
          { assignedToId: t.userId('Upul'), affectedDomainId: t.domainId('SL'), request: 'b' },
        ],
      })),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const ids = results.map((r) => r.body.considerationId).sort();
    expect(new Set(ids).size).toBe(60);
    expect(ids).toEqual(Array.from({ length: 60 }, (_, i) => formatId.consideration('SH', i + 1)).sort());
    for (const r of results) {
      expect(r.body.iterationId).toBe(`${r.body.considerationId}-I01`);
      expect(r.body.flagIds).toEqual([`${r.body.considerationId}-I01-F1`, `${r.body.considerationId}-I01-F2`]);
    }
  });

  it('is race-free across separate processes writing to the same database file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dit-'));
    const file = path.join(dir, 'tracker.db');
    t = await makeApp({ file });
    const u = await t.as('Oscar');
    const base = (await u.post('/api/considerations', newConsideration(t, 'SH'))).body.id as string;

    const run = promisify(execFile);
    const fixture = path.resolve('server/test/fixtures/hammer.ts');
    const procs = Array.from({ length: 4 }, () =>
      run(process.execPath, ['--import', 'tsx', fixture, file, '25', base], { cwd: process.cwd() }));
    const outputs = (await Promise.all(procs)).map((p) => JSON.parse(p.stdout) as string[]);
    const all = outputs.flat();

    const considerations = all.filter((x) => !x.includes('-I'));
    const iterations = all.filter((x) => x.includes('-I'));
    expect(new Set(considerations).size).toBe(100);
    expect(new Set(iterations).size).toBe(100);
    expect(considerations.sort()).toEqual(Array.from({ length: 100 }, (_, i) => formatId.consideration('SH', i + 2)).sort());
    expect(iterations.sort()).toEqual(Array.from({ length: 100 }, (_, i) => formatId.iteration(base, i + 1)).sort());
    await t.close();
    t = undefined as unknown as TestApp;
    fs.rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it('saves an entry all-or-nothing', async () => {
    t = await makeApp();
    const u = await t.as('Nisath');
    const res = await u.post('/api/entries', {
      consideration: newConsideration(t, 'SH'),
      iteration: {},
      flags: [{ assignedToId: 9999, affectedDomainId: t.domainId('CK'), request: 'bad assignee' }],
    });
    expect(res.status).toBe(400);
    expect(t.db.prepare('SELECT count(*) FROM considerations').pluck().get()).toBe(0);
    expect(t.db.prepare('SELECT count(*) FROM iterations').pluck().get()).toBe(0);
    const ok = await u.post('/api/entries', { consideration: newConsideration(t, 'SH') });
    expect(ok.body.considerationId).toBe('SH-C01');
  });
});
