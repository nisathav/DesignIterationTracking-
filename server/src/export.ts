import ExcelJS from 'exceljs';
import type { DB } from './db/db.js';
import { recordPath } from './mailer.js';
import {
  listConsiderations, listFlags, listIterations, reviewOutcomeLabels, type ConsiderationRow, type FlagRow, type IterationRow,
} from './queries.js';
import { now, today } from './time.js';

// One organised workbook for managers: a summary, then one formatted sheet per
// record type. IDs link back to the tracker; rows carry their domain colour
// as in the old Excel tracker; verdicts and review outcomes are green/amber/red.

export interface ExportOptions {
  /** Domain ids to include; empty = all. */
  domains: number[];
  /** Only open considerations (and their iterations / open flags). */
  openOnly: boolean;
  includeComments: boolean;
  includeHistory: boolean;
  /** Activity log date range (YYYY-MM-DD), only with includeHistory. */
  historyFrom?: string;
  historyTo?: string;
  /** Base URL for links, e.g. http://192.168.1.25:8080 */
  baseUrl: string;
  exportedBy: string;
}

const BRAND = 'FF234867';
const argb = (hex: string | null | undefined) => `FF${(hex ?? '#FFFFFF').replace('#', '').toUpperCase()}`;
const VERDICT: Record<string, { fill: string; font: string }> = {
  pass: { fill: 'FFC6EFCE', font: 'FF1E7B3C' },
  conditional: { fill: 'FFFFEB9C', font: 'FF8A5A00' },
  fail: { fill: 'FFFFC7CE', font: 'FF9C1C1C' },
};
const OUTCOME_TONE: Record<string, string> = { approved: 'pass', approved_with_comments: 'conditional', changes_needed: 'fail' };

/** Excel has no time zones: write the office wall-clock time. */
function excelDateTime(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()));
}
function excelDate(day: string | null | undefined): Date | null {
  if (!day) return null;
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

type CellValue = string | number | Date | null | { text: string; hyperlink: string };

interface Column<T> {
  header: string;
  width: number;
  value: (row: T) => CellValue;
  /** 'date' | 'datetime' formats; 'wrap' wraps long text. */
  kind?: 'date' | 'datetime' | 'wrap' | 'number' | 'link';
  style?: (row: T, cell: ExcelJS.Cell) => void;
}

function addTable<T>(
  wb: ExcelJS.Workbook,
  name: string,
  title: string,
  columns: Column<T>[],
  rows: T[],
  rowFill: (row: T) => string | null,
): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 2, xSplit: 1 }] });
  ws.columns = columns.map((c) => ({ width: c.width }));

  const titleRow = ws.getRow(1);
  titleRow.getCell(1).value = title;
  titleRow.getCell(1).font = { bold: true, size: 13, color: { argb: BRAND } };
  titleRow.height = 22;

  const head = ws.getRow(2);
  columns.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF8899AA' } } };
  });
  head.height = 30;

  rows.forEach((r, n) => {
    const row = ws.getRow(n + 3);
    const fill = rowFill(r);
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const v = c.value(r);
      cell.value = v === '' ? null : (v as ExcelJS.CellValue);
      cell.alignment = { vertical: 'top', wrapText: c.kind === 'wrap' };
      if (c.kind === 'date') cell.numFmt = 'dd-mmm-yyyy';
      if (c.kind === 'datetime') cell.numFmt = 'dd-mmm-yyyy hh:mm';
      if (c.kind === 'link' && v && typeof v === 'object' && 'hyperlink' in v) {
        cell.font = { color: { argb: 'FF1F4F80' }, underline: true, bold: true };
      }
      if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFC9D0D8' } } };
      c.style?.(r, cell);
    });
  });

  if (rows.length) ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: rows.length + 2, column: columns.length } };
  else ws.getRow(3).getCell(1).value = 'No records in this export.';
  return ws;
}

const colourVerdict = (behaviour: string | null | undefined) => (_: unknown, cell: ExcelJS.Cell) => {
  const t = behaviour ? VERDICT[behaviour] : undefined;
  if (!t) return;
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: t.fill } };
  cell.font = { bold: true, color: { argb: t.font } };
};

export async function buildWorkbook(db: DB, opt: ExportOptions): Promise<ExcelJS.Workbook> {
  const link = (id: string | null | undefined): CellValue => (id ? { text: id, hyperlink: `${opt.baseUrl}${recordPath(id)}` } : null);
  const domainFilter = opt.domains.length ? opt.domains : undefined;
  const ALL = 100_000;
  // Rows follow the domain order of the Setup sheet (as in the Excel tracker), then the running number.

  const considerations = listConsiderations(db, {
    domain: domainFilter, statusBehaviour: opt.openOnly ? ['open'] : undefined, sort: 'domain', limit: ALL,
  }, 0);
  const consIds = new Set(considerations.map((c) => c.id));
  const iterations = consIds.size
    ? listIterations(db, { consideration: [...consIds], sort: 'domain', dir: 'asc', limit: ALL }, 0)
    : [];
  // Flags raised from the included considerations, plus flags from elsewhere that affect the chosen domains.
  const flags = listFlags(db, { sort: 'domain', limit: ALL, statusBehaviour: opt.openOnly ? ['open', 'in_progress'] : undefined }, 0)
    .filter((f) => consIds.has(f.considerationId) || (domainFilter && domainFilter.includes(f.affectedDomainId)));

  const domains = db.prepare(
    `SELECT d.id, d.code, d.name, d.colour, u.name AS owner FROM domains d LEFT JOIN users u ON u.id = d.owner_id
     ${domainFilter ? `WHERE d.id IN (${domainFilter.map(() => '?').join(',')})` : ''} ORDER BY d.sort_order, d.code`,
  ).all(...(domainFilter ?? [])) as Array<{ id: number; code: string; name: string; colour: string; owner: string | null }>;
  const tint = new Map(domains.map((d) => [d.code, argb(d.colour)]));
  for (const d of db.prepare('SELECT code, colour FROM domains').all() as Array<{ code: string; colour: string }>) {
    if (!tint.has(d.code)) tint.set(d.code, argb(d.colour));
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Design Iteration Tracker';
  wb.created = now();

  // ---------- Summary ----------
  const ws = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 26 }, { width: 30 }, { width: 14 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 14 }, { width: 12 }, { width: 14 }, { width: 14 }];
  ws.getCell('A1').value = 'Design Iteration Tracker';
  ws.getCell('A1').font = { bold: true, size: 16, color: { argb: BRAND } };
  const meta: Array<[string, CellValue]> = [
    ['Exported', excelDateTime(new Date().toISOString())],
    ['Exported by', opt.exportedBy],
    ['Domains', domainFilter ? domains.map((d) => d.code).join(', ') : 'All domains'],
    ['Considerations', opt.openOnly ? 'Open only' : 'All (open, closed and withdrawn)'],
    ['Records', `${considerations.length} considerations, ${iterations.length} iterations, ${flags.length} flags`],
  ];
  meta.forEach(([k, v], i) => {
    const r = ws.getRow(i + 3);
    r.getCell(1).value = k;
    r.getCell(1).font = { bold: true, color: { argb: 'FF5F6B78' } };
    r.getCell(2).value = v as ExcelJS.CellValue;
    if (v instanceof Date) r.getCell(2).numFmt = 'dd-mmm-yyyy hh:mm';
  });

  const header = (rowNo: number, labels: string[]) => {
    const r = ws.getRow(rowNo);
    labels.forEach((l, i) => {
      const c = r.getCell(i + 1);
      c.value = l;
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
      c.alignment = { wrapText: true, vertical: 'middle' };
    });
    r.height = 30;
  };
  const section = (rowNo: number, text: string) => {
    const c = ws.getCell(`A${rowNo}`);
    c.value = text;
    c.font = { bold: true, size: 12, color: { argb: BRAND } };
  };

  let rowNo = meta.length + 5;
  section(rowNo++, 'By domain');
  header(rowNo++, ['Domain', 'Name', 'Owner', 'Considerations', 'Open', 'Iterations', 'Pass', 'Conditional', 'Fail', 'Open flags raised', 'Open flags affecting']);
  const today0 = today();
  for (const d of domains) {
    const cs = considerations.filter((c) => c.domainCode === d.code);
    const its = iterations.filter((i) => i.domainCode === d.code);
    const openFlags = flags.filter((f) => f.statusBehaviour !== 'closed');
    const values: CellValue[] = [
      d.code, d.name, d.owner ?? '', cs.length, cs.filter((c) => c.statusBehaviour === 'open').length, its.length,
      its.filter((i) => i.verdictBehaviour === 'pass').length, its.filter((i) => i.verdictBehaviour === 'conditional').length,
      its.filter((i) => i.verdictBehaviour === 'fail').length,
      openFlags.filter((f) => f.sourceDomainCode === d.code).length, openFlags.filter((f) => f.affectedDomainCode === d.code).length,
    ];
    const r = ws.getRow(rowNo++);
    values.forEach((v, i) => {
      const c = r.getCell(i + 1);
      c.value = v as ExcelJS.CellValue;
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(d.colour) } };
      if (i === 0) c.font = { bold: true };
    });
  }

  rowNo++;
  section(rowNo++, 'By person');
  header(rowNo++, ['Person', 'Role', 'Open flags assigned', 'Overdue', 'Reviews to do', 'Iterations authored', 'Flags raised', 'Considerations owned']);
  const people = db.prepare("SELECT id, name, role FROM users WHERE active = 1 ORDER BY name").all() as Array<{ id: number; name: string; role: string }>;
  for (const p of people) {
    const assigned = flags.filter((f) => f.assignedToId === p.id && f.statusBehaviour !== 'closed');
    const values: CellValue[] = [
      p.name, p.role === 'manager' ? 'Manager' : 'Designer', assigned.length,
      assigned.filter((f) => f.dueDate && f.dueDate < today0).length,
      assigned.filter((f) => f.typeBehaviour === 'review').length,
      iterations.filter((i) => i.authorId === p.id).length,
      flags.filter((f) => f.raisedById === p.id).length,
      considerations.filter((c) => c.ownerId === p.id).length,
    ];
    const r = ws.getRow(rowNo++);
    values.forEach((v, i) => {
      const c = r.getCell(i + 1);
      c.value = v as ExcelJS.CellValue;
      c.border = { bottom: { style: 'hair', color: { argb: 'FFC9D0D8' } } };
      if (i === 3 && Number(v) > 0) c.font = { bold: true, color: { argb: 'FF9C1C1C' } };
    });
  }
  rowNo++;
  ws.getCell(`A${rowNo}`).value = 'Rows in the other sheets are coloured by domain. IDs are links to the tracker (they open when you are on the office network).';
  ws.getCell(`A${rowNo}`).font = { italic: true, color: { argb: 'FF5F6B78' } };

  // ---------- Considerations ----------
  addTable<ConsiderationRow>(wb, 'Considerations', 'Considerations', [
    { header: 'Consideration ID', width: 16, kind: 'link', value: (c) => link(c.id) },
    { header: 'Domain', width: 9, value: (c) => c.domainCode },
    { header: 'Sub-system', width: 22, value: (c) => c.subsystemName },
    { header: 'Title', width: 36, kind: 'wrap', value: (c) => c.title },
    { header: 'Requirement / Target Metric', width: 40, kind: 'wrap', value: (c) => c.targetMetric },
    { header: 'Owner', width: 12, value: (c) => c.ownerName },
    { header: 'Origin (Flag ID, blank = Root)', width: 18, kind: 'link', value: (c) => link(c.originFlagId) },
    { header: 'Status', width: 11, value: (c) => c.statusLabel },
    { header: 'Iterations', width: 10, kind: 'number', value: (c) => c.iterationCount },
    { header: 'Latest Iteration', width: 16, value: (c) => c.latestIterationId },
    { header: 'Latest Verdict', width: 16, value: (c) => c.latestVerdictLabel, style: (c, cell) => colourVerdict(c.latestVerdictBehaviour)(c, cell) },
    { header: 'Open Flags', width: 10, kind: 'number', value: (c) => c.openFlagCount },
    { header: 'Created By', width: 12, value: (c) => c.createdByName },
    { header: 'Date Raised', width: 13, kind: 'date', value: (c) => excelDateTime(c.createdAt) },
    { header: 'Last Activity', width: 17, kind: 'datetime', value: (c) => excelDateTime(c.lastActivityAt) },
    { header: 'Notes', width: 40, kind: 'wrap', value: (c) => c.notes },
  ], considerations, (c) => tint.get(c.domainCode) ?? null);

  // ---------- Iterations ----------
  addTable<IterationRow>(wb, 'Iterations', 'Iteration log', [
    { header: 'Iteration ID', width: 16, kind: 'link', value: (i) => link(i.id) },
    { header: 'Consideration ID', width: 15, kind: 'link', value: (i) => link(i.considerationId) },
    { header: 'Consideration', width: 30, kind: 'wrap', value: (i) => i.considerationTitle },
    { header: 'Parent ID', width: 17, value: (i) => i.parentIterationId ?? i.parentFlagId },
    { header: 'Domain', width: 9, value: (i) => i.domainCode },
    { header: 'Sub-system', width: 20, value: (i) => i.subsystemName },
    { header: 'Target Metric', width: 30, kind: 'wrap', value: (i) => i.targetMetric },
    { header: 'Date', width: 13, kind: 'date', value: (i) => excelDate(i.date) },
    { header: 'Author', width: 12, value: (i) => i.authorName },
    { header: 'Design Input / Variable Changes', width: 40, kind: 'wrap', value: (i) => i.designInput },
    { header: 'CAD Design (rev / file)', width: 22, kind: 'wrap', value: (i) => i.cadDesign },
    { header: 'Analytical Results', width: 36, kind: 'wrap', value: (i) => i.analyticalResults },
    { header: 'Simulation Results', width: 36, kind: 'wrap', value: (i) => i.simulationResults },
    { header: 'Evidence Link / Folder', width: 30, kind: 'wrap', value: (i) => i.evidenceLink },
    { header: 'Assessment / Verdict', width: 16, value: (i) => i.verdictLabel, style: (i, cell) => colourVerdict(i.verdictBehaviour)(i, cell) },
    { header: 'Status', width: 15, value: (i) => i.statusLabel },
    { header: 'Reviews Approved', width: 11, value: (i) => (i.reviewCount ? `${i.reviewApprovedCount} of ${i.reviewCount}` : '') },
    { header: 'Action / Next Step', width: 34, kind: 'wrap', value: (i) => i.nextAction },
    { header: 'Open Flags', width: 10, kind: 'number', value: (i) => i.openFlagCount },
    { header: 'Closed by Manager Override', width: 30, kind: 'wrap', value: (i) => i.closeOverrideReason },
  ], iterations, (i) => tint.get(i.domainCode) ?? null);

  // ---------- Flags ----------
  addTable<FlagRow>(wb, 'Flags', 'Flags (reviews, FYIs, actions)', [
    { header: 'Flag ID', width: 18, kind: 'link', value: (f) => link(f.id) },
    { header: 'Source Iteration ID', width: 16, kind: 'link', value: (f) => link(f.iterationId) },
    { header: 'Consideration', width: 28, kind: 'wrap', value: (f) => f.considerationTitle },
    { header: 'Source Domain', width: 9, value: (f) => f.sourceDomainCode },
    { header: 'Raised By', width: 12, value: (f) => f.raisedByName },
    { header: 'Date Raised', width: 13, kind: 'date', value: (f) => excelDate(f.dateRaised) },
    { header: 'Type', width: 9, value: (f) => f.typeLabel },
    { header: 'Assigned To', width: 12, value: (f) => f.assignedToName },
    {
      header: 'Affected Domain', width: 10, value: (f) => f.affectedDomainCode,
      style: (f, cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(f.affectedDomainColour) } };
        cell.font = { bold: true };
      },
    },
    { header: 'What Is Asked / Side Effect', width: 44, kind: 'wrap', value: (f) => f.request },
    {
      header: 'Due Date', width: 13, kind: 'date', value: (f) => excelDate(f.dueDate),
      style: (f, cell) => { if (f.overdue) cell.font = { bold: true, color: { argb: 'FF9C1C1C' } }; },
    },
    { header: 'Status', width: 12, value: (f) => f.statusLabel },
    { header: 'Overdue', width: 9, value: (f) => (f.overdue ? 'Yes' : '') },
    {
      header: 'Review Outcome', width: 18, value: (f) => (f.reviewOutcome ? reviewOutcomeLabels[f.reviewOutcome] : ''),
      style: (f, cell) => colourVerdict(f.reviewOutcome ? OUTCOME_TONE[f.reviewOutcome] : null)(f, cell),
    },
    { header: 'Reviewed By', width: 12, value: (f) => f.reviewOutcomeByName },
    { header: 'Response / Outcome', width: 44, kind: 'wrap', value: (f) => f.response },
    { header: 'Resulting Consideration ID', width: 15, kind: 'link', value: (f) => link(f.resultingConsiderationId) },
    { header: 'Date Closed', width: 13, kind: 'date', value: (f) => excelDate(f.dateClosed) },
    { header: 'Escalated', width: 10, value: (f) => (f.escalated ? 'Open' : f.escalatedAt ? 'Resolved' : '') },
    { header: 'Escalation Reason', width: 32, kind: 'wrap', value: (f) => f.escalationReason },
    { header: 'Manager Decision', width: 32, kind: 'wrap', value: (f) => f.escalationResolution },
    { header: 'Source Sub-system', width: 20, value: (f) => f.sourceSubsystemName },
    { header: 'Source Verdict', width: 15, value: (f) => f.sourceVerdictLabel, style: (f, cell) => colourVerdict(f.sourceVerdictBehaviour)(f, cell) },
  ], flags, (f) => tint.get(f.sourceDomainCode) ?? null);

  // ---------- Comments (optional) ----------
  if (opt.includeComments) {
    const consIdList = [...consIds];
    const comments = consIdList.length
      ? (db.prepare(
        `SELECT c.entity_type AS entityType, c.entity_id AS entityId, u.name AS author, c.body, c.created_at AS createdAt
         FROM comments c JOIN users u ON u.id = c.author_id ORDER BY c.entity_id, c.id`,
      ).all() as Array<{ entityType: string; entityId: string; author: string; body: string; createdAt: string }>)
        .filter((c) => consIdList.some((id) => c.entityId === id || c.entityId.startsWith(`${id}-`)))
      : [];
    addTable(wb, 'Comments', 'Comments', [
      { header: 'Record', width: 18, kind: 'link', value: (c) => link(c.entityId) },
      { header: 'On', width: 13, value: (c) => c.entityType.charAt(0).toUpperCase() + c.entityType.slice(1) },
      { header: 'By', width: 12, value: (c) => c.author },
      { header: 'When', width: 17, kind: 'datetime', value: (c) => excelDateTime(c.createdAt) },
      { header: 'Comment', width: 80, kind: 'wrap', value: (c) => c.body },
    ], comments, (c) => tint.get(c.entityId.split('-')[0]) ?? null);
  }

  // ---------- Change history (optional) ----------
  if (opt.includeHistory) {
    const where = ["a.entity_type IN ('consideration','iteration','flag')"];
    const params: unknown[] = [];
    if (opt.historyFrom) { where.push('a.at >= ?'); params.push(new Date(`${opt.historyFrom}T00:00:00`).toISOString()); }
    if (opt.historyTo) { where.push('a.at <= ?'); params.push(new Date(`${opt.historyTo}T23:59:59.999`).toISOString()); }
    const consIdList = [...consIds];
    const rows = (db.prepare(
      `SELECT a.at, u.name AS who, a.action, a.entity_id AS entityId, a.consideration_id AS considerationId, a.field,
         a.old_value AS oldValue, CASE WHEN a.action = 'create' THEN NULL ELSE a.new_value END AS newValue
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE ${where.join(' AND ')} ORDER BY a.id`,
    ).all(...params) as Array<{ at: string; who: string | null; action: string; entityId: string; considerationId: string | null; field: string | null; oldValue: string | null; newValue: string | null }>)
      .filter((r) => r.considerationId && consIdList.includes(r.considerationId));
    addTable(wb, 'Change history', 'Change history (every field change)', [
      { header: 'When', width: 17, kind: 'datetime', value: (r) => excelDateTime(r.at) },
      { header: 'Who', width: 12, value: (r) => r.who ?? 'server' },
      { header: 'Record', width: 18, kind: 'link', value: (r) => link(r.entityId) },
      { header: 'Action', width: 10, value: (r) => r.action },
      { header: 'Field', width: 20, value: (r) => r.field },
      { header: 'Old Value', width: 40, kind: 'wrap', value: (r) => r.oldValue },
      { header: 'New Value', width: 40, kind: 'wrap', value: (r) => r.newValue },
    ], rows, (r) => tint.get(r.entityId.split('-')[0]) ?? null);
  }

  // ---------- Setup (reference) ----------
  const subs = db.prepare(
    `SELECT d.code, d.name, u.name AS owner, s.name AS subsystem, s.active, d.colour FROM domains d
     LEFT JOIN users u ON u.id = d.owner_id LEFT JOIN subsystems s ON s.domain_id = d.id ORDER BY d.sort_order, s.sort_order`,
  ).all() as Array<{ code: string; name: string; owner: string | null; subsystem: string | null; active: number | null; colour: string }>;
  addTable(wb, 'Setup', 'Domains and sub-systems', [
    { header: 'Code', width: 8, value: (r) => r.code },
    { header: 'Domain', width: 40, value: (r) => r.name },
    { header: 'Owner', width: 14, value: (r) => r.owner },
    { header: 'Sub-system', width: 30, value: (r) => r.subsystem },
    { header: 'In use', width: 8, value: (r) => (r.subsystem ? (r.active ? 'Yes' : 'No') : '') },
  ], subs, (r) => argb(r.colour));

  return wb;
}
