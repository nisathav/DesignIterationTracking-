import ExcelJS from 'exceljs';
import { afterEach, describe, expect, it } from 'vitest';
import { makeApp, newConsideration, type TestApp } from './helpers.js';

let t: TestApp;
afterEach(async () => t?.close());

async function download(name: string, query = '') {
  const c = await t.as(name);
  const res = await t.app.inject({ method: 'GET', url: `/api/export.xlsx${query}`, headers: { cookie: c.cookie, host: '192.168.1.25:8080' } });
  return res;
}

async function workbook(query = '') {
  const res = await download('Oscar', query);
  expect(res.statusCode).toBe(200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.rawPayload as unknown as ArrayBuffer);
  return { wb, res };
}

/** Column values of a sheet's data rows (row 1 = title, row 2 = headers). */
function column(ws: ExcelJS.Worksheet, header: string): unknown[] {
  const head = ws.getRow(2).values as unknown[];
  const col = head.indexOf(header);
  const out: unknown[] = [];
  ws.eachRow((row, n) => {
    if (n > 2) {
      const v = row.getCell(col).value as any;
      out.push(v && typeof v === 'object' && 'text' in v ? v.text : v);
    }
  });
  return out;
}

async function seed() {
  t = await makeApp();
  const nisath = await t.as('Nisath');
  const nilan = await t.as('Nilan');
  await nisath.post('/api/entries', {
    consideration: newConsideration(t, 'SH', { title: 'Faceplate uniformity' }),
    iteration: { designInput: 'Pattern B', verdictId: t.lookupId('verdict', 'Conditional Pass') },
    flags: [{ typeId: t.lookupId('flag_type', 'Review'), assignedToId: t.userId('Nilan'), affectedDomainId: t.domainId('CK'), request: 'Check gap', dueDate: '2020-01-01' }],
  });
  await nilan.post('/api/entries', { consideration: newConsideration(t, 'CK', { title: 'Seal temperature' }), iteration: { verdictId: t.lookupId('verdict', 'Fail') } });
  const c = (await nilan.get('/api/considerations/CK-C01')).body.consideration;
  await nilan.patch('/api/considerations/CK-C01', { version: c.version, statusId: t.lookupId('consideration_status', 'Closed') });
  await nisath.post('/api/comments', { entityType: 'iteration', entityId: 'SH-C01-I01', body: 'Mesh study attached' });
}

describe('Excel export', () => {
  it('is for managers only', async () => {
    await seed();
    expect((await download('Nisath')).statusCode).toBe(403);
    const res = await download('Oscar');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="DesignTracker_\d{4}-\d{2}-\d{2}\.xlsx"/);
  });

  it('has a summary and one organised sheet per record type', async () => {
    await seed();
    const { wb } = await workbook();
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Considerations', 'Iterations', 'Flags', 'Setup']);

    const cons = wb.getWorksheet('Considerations')!;
    expect(column(cons, 'Consideration ID')).toEqual(['SH-C01', 'CK-C01']);
    expect(column(cons, 'Status')).toEqual(['Open', 'Closed']);
    // IDs link back to the tracker at the address the manager used.
    expect((cons.getRow(3).getCell(1).value as any).hyperlink).toBe('http://192.168.1.25:8080/considerations/SH-C01');
    // Rows carry the domain colour; header is frozen with a filter.
    expect((cons.getRow(3).getCell(4).fill as any).fgColor.argb).toBe('FFDDEBF7');
    expect(cons.autoFilter).toBeTruthy();

    const its = wb.getWorksheet('Iterations')!;
    expect(column(its, 'Iteration ID')).toEqual(['SH-C01-I01', 'CK-C01-I01']);
    const verdictCol = (its.getRow(2).values as unknown[]).indexOf('Assessment / Verdict');
    expect((its.getRow(3).getCell(verdictCol).fill as any).fgColor.argb).toBe('FFFFEB9C'); // amber
    expect((its.getRow(4).getCell(verdictCol).fill as any).fgColor.argb).toBe('FFFFC7CE'); // red
    const date = its.getRow(3).getCell((its.getRow(2).values as unknown[]).indexOf('Date')).value;
    expect(date).toBeInstanceOf(Date);

    const flags = wb.getWorksheet('Flags')!;
    expect(column(flags, 'Flag ID')).toEqual(['SH-C01-I01-F1']);
    expect(column(flags, 'Overdue')).toEqual(['Yes']);
    expect(column(flags, 'Affected Domain')).toEqual(['CK']);

    const summary = wb.getWorksheet('Summary')!;
    const text = JSON.stringify(summary.getSheetValues());
    expect(text).toContain('Exported by');
    expect(text).toContain('Oscar');
  });

  it('can be limited to open considerations and chosen domains, with comments and history', async () => {
    await seed();
    const { wb } = await workbook(`?openOnly=1&comments=1&history=1`);
    expect(column(wb.getWorksheet('Considerations')!, 'Consideration ID')).toEqual(['SH-C01']);
    expect(column(wb.getWorksheet('Comments')!, 'Comment')).toEqual(['Mesh study attached']);
    const history = column(wb.getWorksheet('Change history')!, 'Record');
    expect(history).toContain('SH-C01-I01-F1');
    expect(history).not.toContain('CK-C01');

    const ck = (await workbook(`?domain=${t.domainId('CK')}`)).wb;
    expect(column(ck.getWorksheet('Considerations')!, 'Consideration ID')).toEqual(['CK-C01']);
    // The SH flag affects CK, so it is part of a CK export.
    expect(column(ck.getWorksheet('Flags')!, 'Flag ID')).toEqual(['SH-C01-I01-F1']);
  });
});
