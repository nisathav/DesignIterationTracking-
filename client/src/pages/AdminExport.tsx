import { useState } from 'react';
import { useMeta } from '../hooks';
import { DomainBadge, Field, Section } from '../components/ui';

const SHEETS: Array<[string, string]> = [
  ['Summary', 'When and by whom it was exported, what it covers, and counts per domain and per person (open flags, overdue, reviews to do).'],
  ['Considerations', 'One row per consideration: domain, sub-system, title, target, owner, origin, status, latest verdict, open flags, last activity.'],
  ['Iterations', 'The iteration log: parent, date, author, design input, CAD, analytical and simulation results, evidence, verdict, status, reviews approved, next step.'],
  ['Flags', 'Reviews, FYIs and actions: who raised it, who it is for, affected domain, due date (overdue in red), status, review outcome, response, resulting consideration, escalation.'],
  ['Comments', 'Optional. Every comment on the exported records.'],
  ['Change history', 'Optional. Every field change with old and new value, for the dates you choose.'],
  ['Setup', 'Domains, owners and sub-systems.'],
];

/** Manager-only: download everything (or a selection) as one organised .xlsx file. */
export function ExportPage() {
  const meta = useMeta();
  const [domains, setDomains] = useState<number[]>([]); // empty = all
  const [openOnly, setOpenOnly] = useState(false);
  const [comments, setComments] = useState(true);
  const [history, setHistory] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const toggle = (id: number) => setDomains((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));
  const params = new URLSearchParams();
  if (domains.length) params.set('domain', domains.join(','));
  if (openOnly) params.set('openOnly', '1');
  if (comments) params.set('comments', '1');
  if (history) {
    params.set('history', '1');
    if (from) params.set('historyFrom', from);
    if (to) params.set('historyTo', to);
  }
  const url = `/api/export.xlsx${params.toString() ? `?${params}` : ''}`;

  return (
    <div className="admin export-page">
      <div className="page-head">
        <h1>Export to Excel</h1>
        <p className="muted">Download the tracker as one Excel workbook, with a sheet for each kind of record. Rows are coloured by domain, verdicts green / amber / red, and every ID links back to the tracker.</p>
      </div>

      <Section title="What to include">
        <div className="export-options">
          <div className="field">
            <span className="field-label">Domains</span>
            <div className="chip-row">
              <label className={`chip ${domains.length === 0 ? 'on' : ''}`}>
                <input type="checkbox" checked={domains.length === 0} onChange={() => setDomains([])} /> All domains
              </label>
              {meta.domains.map((d) => (
                <label key={d.id} className={`chip ${domains.includes(d.id) ? 'on' : ''}`}>
                  <input type="checkbox" checked={domains.includes(d.id)} onChange={() => toggle(d.id)} />
                  <DomainBadge code={d.code} colour={d.colour} /> {d.name}
                </label>
              ))}
            </div>
            <span className="field-hint">A domain export also includes flags from other domains that affect it.</span>
          </div>

          <div className="field">
            <span className="field-label">Considerations</span>
            <div className="chip-row">
              <label className={`chip ${!openOnly ? 'on' : ''}`}>
                <input type="radio" name="scope" checked={!openOnly} onChange={() => setOpenOnly(false)} /> All (open, closed and withdrawn)
              </label>
              <label className={`chip ${openOnly ? 'on' : ''}`}>
                <input type="radio" name="scope" checked={openOnly} onChange={() => setOpenOnly(true)} /> Open only (with their open flags)
              </label>
            </div>
          </div>

          <div className="field">
            <span className="field-label">Extra sheets</span>
            <label className="check">
              <input type="checkbox" checked={comments} onChange={(e) => setComments(e.target.checked)} /> Comments
            </label>
            <label className="check">
              <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} /> Change history (every field change)
            </label>
            {history && (
              <div className="row gap wrap history-range">
                <Field label="From">
                  <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </Field>
                <Field label="To">
                  <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </Field>
                <span className="muted small">Leave empty for all dates.</span>
              </div>
            )}
          </div>

          <div className="form-actions">
            <a className="btn primary" href={url} download>
              Download Excel file
            </a>
            <span className="muted small">The file is named DesignTracker_{new Date().toISOString().slice(0, 10)}.xlsx</span>
          </div>
        </div>
      </Section>

      <Section title="Sheets in the workbook">
        <table className="sheet-list">
          <tbody>
            {SHEETS.filter(([name]) => (name === 'Comments' ? comments : name === 'Change history' ? history : true)).map(([name, text]) => (
              <tr key={name}>
                <th>{name}</th>
                <td>{text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
