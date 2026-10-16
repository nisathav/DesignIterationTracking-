import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { fmtDateTime } from '../hooks';
import { ErrorBox, Section } from '../components/ui';

interface Maintenance {
  backups: Array<{ file: string; size: number; at: string }>;
  keepDays: number;
  backupDir: string;
  lastDigestWeek: string | null;
}

const size = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function BackupsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['maintenance'], queryFn: () => api.get<Maintenance>('/api/admin/maintenance') });
  const [msg, setMsg] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    setMsg('');
    try {
      setMsg(await fn());
      qc.invalidateQueries({ queryKey: ['maintenance'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  if (!q.data) return null;
  const d = q.data;
  return (
    <div className="admin">
      <div className="page-head">
        <h1>Backups &amp; digest</h1>
      </div>
      <Section
        title="Backups"
        actions={
          <button type="button" className="btn small primary" disabled={busy} onClick={() => act(async () => `Backup written: ${(await api.post<{ backup: { file: string } }>('/api/admin/backup')).backup.file}`)}>
            Back up now
          </button>
        }
      >
        <p>
          The database is copied every night from 02:00 (or as soon as the tracker runs, if the PC was off) to <code>{d.backupDir}</code>. Uploaded
          files are copied to its <code>uploads</code> folder. Copies older than {d.keepDays} days are deleted. To keep backups off this PC, copy that
          folder to a network drive (see the README).
        </p>
        {msg && <div className="ok-box">{msg}</div>}
        <ErrorBox error={error} />
        {d.backups.length ? (
          <table className="list compact backups">
            <thead>
              <tr>
                <th>File</th>
                <th>Size</th>
                <th>Written</th>
              </tr>
            </thead>
            <tbody>
              {d.backups.map((b) => (
                <tr key={b.file}>
                  <td className="mono">{b.file}</td>
                  <td>{size(b.size)}</td>
                  <td>{fmtDateTime(b.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="hint-box">No backup yet. The first one is made tonight, or press Back up now.</p>
        )}
        <p className="muted small">To restore a backup, follow "Restore a backup" in the README (stop the tracker, copy the file back, start it).</p>
      </Section>

      <Section
        title="Weekly digest"
        actions={
          <button type="button" className="btn small" disabled={busy} onClick={() => act(async () => `Digest sent to ${(await api.post<{ sent: number }>('/api/admin/digest')).sent} people.`)}>
            Send last week's digest now
          </button>
        }
      >
        <p>
          Every Monday from 07:00, each person gets a summary of the past week in the domains and considerations they follow, and what is waiting on
          them. It appears under the bell, and is emailed when email is set up.
        </p>
        <p className="muted small">{d.lastDigestWeek ? `Last sent for the week ending ${d.lastDigestWeek}.` : 'Not sent yet.'}</p>
      </Section>
    </div>
  );
}
