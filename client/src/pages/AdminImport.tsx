import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { ErrorBox, IdLink, Section } from '../components/ui';

interface Issue { sheet: string; row: number; message: string; id?: string }
interface ImportResult {
  dryRun: boolean;
  created: { considerations: string[]; iterations: string[]; flags: string[] };
  skipped: Issue[];
  errors: Issue[];
}

/** Manager-only: preview, then import considerations, iterations and flags from Excel. */
export function ImportPage() {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const send = async (dryRun: boolean) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await api.post<ImportResult>(`/api/import${dryRun ? '?dryRun=1' : ''}`, fd);
      setResult(res);
      if (!dryRun && !res.errors.length) qc.invalidateQueries();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const total = result ? result.created.considerations.length + result.created.iterations.length + result.created.flags.length : 0;
  return (
    <div className="admin">
      <div className="page-head">
        <h1>Import from Excel</h1>
        <p className="muted">
          Load considerations, iterations and flags from an Excel file laid out like the export (sheets Considerations, Iterations and Flags; the
          original tracker's Iteration Log sheet works too). Use it to bring in existing data or to move records from another tracker.
        </p>
      </div>

      <Section title="How it works">
        <ul className="steps">
          <li>Rows whose ID already exists are <b>skipped and left unchanged</b>. Rows without an ID get the next free one.</li>
          <li>Domains, sub-systems and people must already exist (add them in Domains &amp; lists and Users). Values like Status and Verdict must match the lists.</li>
          <li>Press <b>Check file</b> first: nothing is saved and every problem is listed with its sheet and row. Then <b>Import</b>.</li>
          <li>If any row has a problem, nothing is imported. Fix the file and try again.</li>
        </ul>
      </Section>

      <Section title="File">
        <div className="row gap wrap">
          <input type="file" accept=".xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }} />
          <button type="button" className="btn" disabled={!file || busy} onClick={() => send(true)}>
            {busy ? 'Working...' : 'Check file'}
          </button>
          <button type="button" className="btn primary" disabled={!file || busy || !result || !result.dryRun || result.errors.length > 0 || total === 0} onClick={() => send(false)}>
            Import
          </button>
        </div>
        <ErrorBox error={error} />
        {result && (
          <div className="import-result">
            {result.errors.length > 0 ? (
              <div className="error-box block">
                <b>{result.errors.length} problem{result.errors.length > 1 ? 's' : ''} found. Nothing was {result.dryRun ? 'checked as ready' : 'imported'}.</b>
                <table className="issues">
                  <tbody>
                    {result.errors.map((e, i) => (
                      <tr key={i}>
                        <td className="nowrap">{e.sheet}{e.row ? `, row ${e.row}` : ''}</td>
                        <td>{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="ok-box block">
                <b>
                  {result.dryRun ? 'Ready to import: ' : 'Imported: '}
                  {result.created.considerations.length} considerations, {result.created.iterations.length} iterations, {result.created.flags.length} flags.
                </b>
                {result.dryRun && total > 0 && <span> Press Import to save them.</span>}
                {!result.dryRun && <span> <Link to="/considerations">Open the considerations list</Link>.</span>}
                {total > 0 && (
                  <div className="id-cloud">
                    {[...result.created.considerations, ...result.created.iterations, ...result.created.flags].slice(0, 60).map((id) =>
                      result.dryRun ? <span key={id} className="idlink">{id}</span> : <IdLink key={id} id={id} />,
                    )}
                    {total > 60 && <span className="muted">and {total - 60} more</span>}
                  </div>
                )}
              </div>
            )}
            {result.skipped.length > 0 && (
              <details className="skipped">
                <summary>{result.skipped.length} row{result.skipped.length > 1 ? 's' : ''} skipped because the ID already exists</summary>
                <div className="id-cloud">
                  {result.skipped.map((s) => <span key={`${s.sheet}${s.row}`} className="idlink">{s.id}</span>)}
                </div>
              </details>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
