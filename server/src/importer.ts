import ExcelJS from 'exceljs';
import type { DB } from './db/db.js';
import type { SessionUser } from './context.js';
import { formatId } from './ids.js';
import { defaultLookup } from './lookups.js';
import { localDate, nowIso, today } from './time.js';
import { randomUUID } from 'node:crypto';

// Imports considerations, iterations and flags from a workbook laid out like
// the Excel export (or the original Excel tracker). Rules:
// - existing IDs are never changed: rows whose ID already exists are skipped;
// - a row without an ID gets the next free one;
// - everything is checked first; any error and nothing is saved;
// - a preview (dry run) shows what would happen without saving.

export interface ImportIssue {
  sheet: string;
  row: number;
  message: string;
}

export interface ImportResult {
  dryRun: boolean;
  created: { considerations: string[]; iterations: string[]; flags: string[] };
  skipped: Array<ImportIssue & { id: string }>;
  errors: ImportIssue[];
}

type Raw = Record<string, string | Date | null>;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const ALIASES: Record<string, Record<string, string[]>> = {
  considerations: {
    id: ['consideration id'],
    domain: ['domain'],
    subsystem: ['sub system', 'subsystem'],
    title: ['title'],
    target: ['requirement target metric', 'design consideration requirement target metric', 'target metric'],
    owner: ['owner'],
    origin: ['origin flag id blank root', 'origin'],
    status: ['status'],
    notes: ['notes'],
    dateRaised: ['date raised'],
  },
  iterations: {
    id: ['iteration id'],
    consideration: ['consideration id'],
    date: ['date'],
    author: ['author'],
    designInput: ['design input variable changes'],
    cad: ['cad design rev file'],
    analytical: ['analytical results'],
    simulation: ['simulation results'],
    evidence: ['evidence link folder'],
    verdict: ['assessment verdict', 'verdict'],
    status: ['status'],
    nextAction: ['action next step'],
  },
  flags: {
    id: ['flag id'],
    iteration: ['source iteration id'],
    raisedBy: ['raised by'],
    dateRaised: ['date raised'],
    type: ['type'],
    assignedTo: ['assigned to'],
    affected: ['affected domain'],
    request: ['what is asked side effect'],
    due: ['due date'],
    status: ['status'],
    response: ['response outcome'],
    resulting: ['resulting consideration id'],
    dateClosed: ['date closed'],
    reviewOutcome: ['review outcome'],
  },
};

const SHEET_NAMES: Record<string, string[]> = {
  considerations: ['considerations'],
  iterations: ['iterations', 'iteration log'],
  flags: ['flags'],
};

function cellValue(v: ExcelJS.CellValue): string | Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return cellValue((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join('');
    if ('text' in v) return String((v as ExcelJS.CellHyperlinkValue).text);
    if ('error' in v) return null;
  }
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** Rows of one sheet as {field: value}, with the header row found among the first rows. */
function readSheet(wb: ExcelJS.Workbook, kind: keyof typeof ALIASES): Array<{ row: number; data: Raw }> | null {
  const ws = wb.worksheets.find((w) => SHEET_NAMES[kind].includes(norm(w.name)));
  if (!ws) return null;
  const aliases = ALIASES[kind];
  let headerRow = 0;
  let map: Record<number, string> = {};
  for (let r = 1; r <= Math.min(6, ws.rowCount); r++) {
    const found: Record<number, string> = {};
    ws.getRow(r).eachCell((cell, col) => {
      const h = norm(String(cellValue(cell.value) ?? ''));
      for (const [field, names] of Object.entries(aliases)) if (names.includes(h) && !Object.values(found).includes(field)) found[col] = field;
    });
    if (Object.values(found).includes('id')) {
      headerRow = r;
      map = found;
      break;
    }
  }
  if (!headerRow) return null;
  const out: Array<{ row: number; data: Raw }> = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const data: Raw = {};
    let any = false;
    for (const [col, field] of Object.entries(map)) {
      const v = cellValue(ws.getRow(r).getCell(Number(col)).value);
      data[field] = v;
      if (v !== null) any = true;
    }
    if (any) out.push({ row: r, data });
  }
  return out;
}

const str = (v: string | Date | null | undefined) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim());

/** Excel date or text (YYYY-MM-DD, DD/MM/YYYY, 5-Oct-2026) -> YYYY-MM-DD, or null. */
function day(v: string | Date | null | undefined): string | null | 'bad' {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dmy = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? 'bad' : localDate(parsed);
}

class Rollback extends Error {}

export async function importWorkbook(db: DB, buffer: Buffer, user: SessionUser, dryRun: boolean): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    return { dryRun, created: { considerations: [], iterations: [], flags: [] }, skipped: [], errors: [{ sheet: '-', row: 0, message: 'This is not an Excel (.xlsx) file.' }] };
  }
  const sheets = {
    considerations: readSheet(wb, 'considerations'),
    iterations: readSheet(wb, 'iterations'),
    flags: readSheet(wb, 'flags'),
  };
  const result: ImportResult = { dryRun, created: { considerations: [], iterations: [], flags: [] }, skipped: [], errors: [] };
  if (!sheets.considerations && !sheets.iterations && !sheets.flags) {
    result.errors.push({ sheet: '-', row: 0, message: 'No sheet called Considerations, Iterations (or Iteration Log) or Flags with an ID column was found.' });
    return result;
  }

  const err = (sheet: string, row: number, message: string) => result.errors.push({ sheet, row, message });
  const users = db.prepare('SELECT id, name, active FROM users').all() as Array<{ id: number; name: string; active: number }>;
  const userByName = (name: string) => users.find((u) => u.name.toLowerCase() === name.toLowerCase());
  const domains = db.prepare('SELECT id, code, owner_id AS ownerId FROM domains').all() as Array<{ id: number; code: string; ownerId: number | null }>;
  const domainByCode = (code: string) => domains.find((d) => d.code === code.toUpperCase());
  const lookup = (category: string, label: string) =>
    db.prepare('SELECT id, behaviour FROM lookup_values WHERE category = ? AND lower(label) = lower(?)').get(category, label) as { id: number; behaviour: string } | undefined;
  const exists = (table: string, id: string) => !!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id);
  const batch = `import-${randomUUID()}`;
  const at = nowIso();
  const audit = db.prepare(
    `INSERT INTO audit_log (batch_id, at, user_id, action, entity_type, entity_id, domain_id, consideration_id, new_value)
     VALUES (?, ?, ?, 'import', ?, ?, ?, ?, 'imported from Excel')`,
  );
  const bump = db.prepare('INSERT INTO counters (scope, value) VALUES (?, ?) ON CONFLICT(scope) DO UPDATE SET value = max(value, excluded.value)');
  const nextFree = (scope: string) => {
    const v = (db.prepare('SELECT value FROM counters WHERE scope = ?').pluck().get(scope) as number | undefined) ?? 0;
    bump.run(scope, v + 1);
    return v + 1;
  };
  const originLinks: Array<{ consId: string; flagId: string; sheet: string; row: number }> = [];
  const resultingLinks: Array<{ flagId: string; consId: string; sheet: string; row: number }> = [];
  const touchedConsiderations = new Set<string>();

  const run = () => {
    // ---------- considerations ----------
    for (const { row, data } of sheets.considerations ?? []) {
      const S = 'Considerations';
      const d = domainByCode(str(data.domain));
      const title = str(data.title);
      if (!d) { err(S, row, `Unknown domain "${str(data.domain)}". Add it in Domains & lists first.`); continue; }
      if (!title) { err(S, row, 'Title is empty.'); continue; }
      let id = str(data.id).toUpperCase();
      let seq: number;
      if (id) {
        const m = id.match(/^([A-Z]{2,3})-C(\d+)$/);
        if (!m || m[1] !== d.code) { err(S, row, `ID ${id} does not match domain ${d.code} (expected like ${d.code}-C01).`); continue; }
        if (exists('considerations', id)) { result.skipped.push({ sheet: S, row, id, message: 'already in the tracker, left unchanged' }); continue; }
        seq = Number(m[2]);
        if (db.prepare('SELECT 1 FROM considerations WHERE domain_id = ? AND seq = ?').get(d.id, seq)) { err(S, row, `Number ${seq} is already used in ${d.code}.`); continue; }
        bump.run(`C:${d.id}`, seq);
      } else {
        seq = nextFree(`C:${d.id}`);
        id = formatId.consideration(d.code, seq);
      }
      const sub = db.prepare('SELECT id FROM subsystems WHERE domain_id = ? AND lower(name) = lower(?)').pluck().get(d.id, str(data.subsystem)) as number | undefined;
      if (!sub) { err(S, row, `Sub-system "${str(data.subsystem)}" is not in ${d.code}. Add it in Domains & lists first.`); continue; }
      const ownerName = str(data.owner);
      const owner = ownerName ? userByName(ownerName) : users.find((u) => u.id === d.ownerId);
      if (!owner) { err(S, row, ownerName ? `Unknown person "${ownerName}". Add them in Users first.` : 'No owner given and the domain has no owner.'); continue; }
      const statusLabel = str(data.status);
      const status = statusLabel ? lookup('consideration_status', statusLabel) : defaultLookup(db, 'consideration_status');
      if (!status) { err(S, row, `Unknown status "${statusLabel}".`); continue; }
      const raised = day(data.dateRaised);
      if (raised === 'bad') { err(S, row, `Date raised "${str(data.dateRaised)}" is not a date.`); continue; }
      const createdAt = raised ? new Date(`${raised}T09:00:00`).toISOString() : at;
      db.prepare(
        `INSERT INTO considerations (id, seq, domain_id, subsystem_id, title, target_metric, owner_id, status_id, notes, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, seq, d.id, sub, title, str(data.target), owner.id, status.id, str(data.notes), user.id, createdAt, at);
      audit.run(batch, at, user.id, 'consideration', id, d.id, id);
      db.prepare("INSERT OR IGNORE INTO follows (user_id, entity_type, entity_id, created_at) VALUES (?, 'consideration', ?, ?)").run(owner.id, id, at);
      if (str(data.origin)) originLinks.push({ consId: id, flagId: str(data.origin).toUpperCase(), sheet: S, row });
      result.created.considerations.push(id);
      touchedConsiderations.add(id);
    }

    // ---------- iterations (in ID order so parents line up) ----------
    const itRows = [...(sheets.iterations ?? [])].sort((a, b) => str(a.data.id).localeCompare(str(b.data.id), undefined, { numeric: true }));
    for (const { row, data } of itRows) {
      const S = 'Iterations';
      const consId = str(data.consideration).toUpperCase() || str(data.id).toUpperCase().replace(/-I\d+$/, '');
      const cons = db.prepare('SELECT c.id, c.domain_id AS domainId FROM considerations c WHERE c.id = ?').get(consId) as { id: string; domainId: number } | undefined;
      if (!cons) { err(S, row, `Consideration ${consId || '(empty)'} does not exist.`); continue; }
      let id = str(data.id).toUpperCase();
      let seq: number;
      if (id) {
        const m = id.match(/^(.*)-I(\d+)$/);
        if (!m || m[1] !== cons.id) { err(S, row, `ID ${id} does not belong to ${cons.id} (expected like ${cons.id}-I01).`); continue; }
        if (exists('iterations', id)) { result.skipped.push({ sheet: S, row, id, message: 'already in the tracker, left unchanged' }); continue; }
        seq = Number(m[2]);
        bump.run(`I:${cons.id}`, seq);
      } else {
        seq = nextFree(`I:${cons.id}`);
        id = formatId.iteration(cons.id, seq);
      }
      const authorName = str(data.author);
      const author = authorName ? userByName(authorName) : users.find((u) => u.id === user.id);
      if (!author) { err(S, row, `Unknown person "${authorName}". Add them in Users first.`); continue; }
      const date = day(data.date);
      if (date === 'bad') { err(S, row, `Date "${str(data.date)}" is not a date.`); continue; }
      const verdictLabel = str(data.verdict);
      const verdict = verdictLabel ? lookup('verdict', verdictLabel) : null;
      if (verdictLabel && !verdict) { err(S, row, `Unknown verdict "${verdictLabel}".`); continue; }
      const statusLabel = str(data.status);
      const status = statusLabel ? lookup('iteration_status', statusLabel) : defaultLookup(db, 'iteration_status');
      if (!status) { err(S, row, `Unknown status "${statusLabel}".`); continue; }
      db.prepare(
        `INSERT INTO iterations (id, consideration_id, seq, date, author_id, design_input, cad_design, analytical_results, simulation_results,
           evidence_link, verdict_id, status_id, next_action, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, cons.id, seq, date ?? today(), author.id, str(data.designInput), str(data.cad), str(data.analytical), str(data.simulation),
        str(data.evidence), verdict?.id ?? null, status.id, str(data.nextAction), user.id, at, at);
      audit.run(batch, at, user.id, 'iteration', id, cons.domainId, cons.id);
      result.created.iterations.push(id);
      touchedConsiderations.add(cons.id);
    }

    // ---------- flags ----------
    const flRows = [...(sheets.flags ?? [])].sort((a, b) => str(a.data.id).localeCompare(str(b.data.id), undefined, { numeric: true }));
    for (const { row, data } of flRows) {
      const S = 'Flags';
      const itId = str(data.iteration).toUpperCase() || str(data.id).toUpperCase().replace(/-F\d+$/, '');
      const it = db.prepare('SELECT i.id, i.author_id AS authorId, c.id AS consId, c.domain_id AS domainId FROM iterations i JOIN considerations c ON c.id = i.consideration_id WHERE i.id = ?')
        .get(itId) as { id: string; authorId: number; consId: string; domainId: number } | undefined;
      if (!it) { err(S, row, `Source iteration ${itId || '(empty)'} does not exist.`); continue; }
      let id = str(data.id).toUpperCase();
      let seq: number;
      if (id) {
        const m = id.match(/^(.*)-F(\d+)$/);
        if (!m || m[1] !== it.id) { err(S, row, `ID ${id} does not belong to ${it.id} (expected like ${it.id}-F1).`); continue; }
        if (exists('flags', id)) { result.skipped.push({ sheet: S, row, id, message: 'already in the tracker, left unchanged' }); continue; }
        seq = Number(m[2]);
        bump.run(`F:${it.id}`, seq);
      } else {
        seq = nextFree(`F:${it.id}`);
        id = formatId.flag(it.id, seq);
      }
      const raisedName = str(data.raisedBy);
      const raiser = raisedName ? userByName(raisedName) : users.find((u) => u.id === it.authorId);
      if (!raiser) { err(S, row, `Unknown person "${raisedName}".`); continue; }
      const assignee = userByName(str(data.assignedTo));
      if (!assignee) { err(S, row, str(data.assignedTo) ? `Unknown person "${str(data.assignedTo)}".` : 'Assigned to is empty.'); continue; }
      const affected = domainByCode(str(data.affected));
      if (!affected) { err(S, row, `Unknown affected domain "${str(data.affected)}".`); continue; }
      const request = str(data.request);
      if (!request) { err(S, row, 'What is asked is empty.'); continue; }
      const typeLabel = str(data.type);
      const type = typeLabel ? lookup('flag_type', typeLabel) : defaultLookup(db, 'flag_type');
      if (!type) { err(S, row, `Unknown type "${typeLabel}".`); continue; }
      const statusLabel = str(data.status);
      const status = statusLabel ? lookup('flag_status', statusLabel) : defaultLookup(db, 'flag_status');
      if (!status) { err(S, row, `Unknown status "${statusLabel}".`); continue; }
      const outcomeLabel = norm(str(data.reviewOutcome));
      const outcome = outcomeLabel === 'approved' ? 'approved' : outcomeLabel === 'approved with comments' ? 'approved_with_comments' : outcomeLabel === 'changes needed' ? 'changes_needed' : null;
      if (outcomeLabel && !outcome) { err(S, row, `Unknown review outcome "${str(data.reviewOutcome)}".`); continue; }
      const raised = day(data.dateRaised);
      const due = day(data.due);
      const closed = day(data.dateClosed);
      if (raised === 'bad' || due === 'bad' || closed === 'bad') { err(S, row, 'One of the dates is not a date.'); continue; }
      db.prepare(
        `INSERT INTO flags (id, iteration_id, seq, raised_by_id, date_raised, type_id, assigned_to_id, affected_domain_id, request, due_date,
           status_id, response, date_closed, review_outcome, review_outcome_by, review_outcome_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, it.id, seq, raiser.id, raised ?? today(), type.id, assignee.id, affected.id, request, due, status.id, str(data.response),
        status.behaviour === 'closed' ? closed ?? today() : null, outcome, outcome ? assignee.id : null, outcome ? at : null, at, at);
      audit.run(batch, at, user.id, 'flag', id, it.domainId, it.consId);
      if (str(data.resulting)) resultingLinks.push({ flagId: id, consId: str(data.resulting).toUpperCase(), sheet: S, row });
      result.created.flags.push(id);
      touchedConsiderations.add(it.consId);
    }

    // ---------- links between flags and considerations ----------
    for (const l of originLinks) {
      if (!exists('flags', l.flagId)) { err(l.sheet, l.row, `Origin flag ${l.flagId} does not exist.`); continue; }
      db.prepare('UPDATE considerations SET origin_flag_id = ? WHERE id = ?').run(l.flagId, l.consId);
      db.prepare('UPDATE flags SET resulting_consideration_id = coalesce(resulting_consideration_id, ?) WHERE id = ?').run(l.consId, l.flagId);
    }
    for (const l of resultingLinks) {
      if (!exists('considerations', l.consId)) { err(l.sheet, l.row, `Resulting consideration ${l.consId} does not exist.`); continue; }
      db.prepare('UPDATE flags SET resulting_consideration_id = ? WHERE id = ?').run(l.consId, l.flagId);
      db.prepare('UPDATE considerations SET origin_flag_id = coalesce(origin_flag_id, ?) WHERE id = ?').run(l.flagId, l.consId);
    }
    // Parents: previous iteration of the consideration, or its origin flag for the first one.
    for (const cid of touchedConsiderations) {
      const origin = db.prepare('SELECT origin_flag_id FROM considerations WHERE id = ?').pluck().get(cid) as string | null;
      const its = db.prepare('SELECT id FROM iterations WHERE consideration_id = ? ORDER BY seq').pluck().all(cid) as string[];
      its.forEach((iid, n) => {
        db.prepare('UPDATE iterations SET parent_iteration_id = ?, parent_flag_id = ? WHERE id = ?').run(n ? its[n - 1] : null, n ? null : origin, iid);
      });
    }

    if (result.errors.length || dryRun) throw new Rollback();
  };

  try {
    db.transaction(run).immediate();
  } catch (e) {
    if (!(e instanceof Rollback)) {
      result.errors.push({ sheet: '-', row: 0, message: (e as Error).message });
    }
  }
  if (result.errors.length) result.created = { considerations: [], iterations: [], flags: [] };
  return result;
}
