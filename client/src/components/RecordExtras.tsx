import { useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../api';
import { fmtDateTime } from '../hooks';
import type { Attachment, Comment, HistoryRow } from '../types';
import { ErrorBox, EvidenceLink } from './ui';

type Entity = 'consideration' | 'iteration' | 'flag';
type Tab = 'comments' | 'files' | 'history';

const FIELD_LABELS: Record<string, string> = {
  targetMetric: 'Target metric', designInput: 'Design input', cadDesign: 'CAD design', analyticalResults: 'Analytical results',
  simulationResults: 'Simulation results', evidenceLink: 'Evidence link', nextAction: 'Action / next step', assignedTo: 'Assigned to',
  affectedDomain: 'Affected domain', dueDate: 'Due date', dateClosed: 'Date closed', resultingConsiderationId: 'Resulting consideration',
};
const fieldLabel = (f: string | null) => (f ? FIELD_LABELS[f] ?? f.charAt(0).toUpperCase() + f.slice(1) : '');

/** Comments, attachments and change history of one record, behind small tabs. */
export function RecordExtras({ entityType, entityId, readOnly = false }: { entityType: Entity; entityId: string; readOnly?: boolean }) {
  const [tab, setTab] = useState<Tab | null>(null);
  const ref = qs({ entityType, entityId });
  const comments = useQuery({ queryKey: ['comments', entityType, entityId], queryFn: () => api.get<Comment[]>(`/api/comments${ref}`) });
  const files = useQuery({ queryKey: ['attachments', entityType, entityId], queryFn: () => api.get<Attachment[]>(`/api/attachments${ref}`) });
  const toggle = (t: Tab) => setTab(tab === t ? null : t);
  return (
    <div className="extras">
      <div className="extras-tabs">
        <button type="button" className={`tab ${tab === 'comments' ? 'on' : ''}`} onClick={() => toggle('comments')}>
          Comments ({comments.data?.length ?? 0})
        </button>
        <button type="button" className={`tab ${tab === 'files' ? 'on' : ''}`} onClick={() => toggle('files')}>
          Attachments ({files.data?.length ?? 0})
        </button>
        <button type="button" className={`tab ${tab === 'history' ? 'on' : ''}`} onClick={() => toggle('history')}>
          History
        </button>
      </div>
      {tab === 'comments' && <Comments entityType={entityType} entityId={entityId} items={comments.data ?? []} />}
      {tab === 'files' && <Attachments entityType={entityType} entityId={entityId} items={files.data ?? []} readOnly={readOnly} />}
      {tab === 'history' && <History entityType={entityType} entityId={entityId} />}
    </div>
  );
}

function Comments({ entityType, entityId, items }: { entityType: Entity; entityId: string; items: Comment[] }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/api/comments', { entityType, entityId, body });
      setBody('');
      qc.invalidateQueries({ queryKey: ['comments', entityType, entityId] });
    } catch (err) {
      setError(err);
    }
  };
  return (
    <div className="extras-body">
      {items.map((c) => (
        <div key={c.id} className="comment">
          <div className="comment-head">
            <strong>{c.authorName}</strong> <span className="muted small">{fmtDateTime(c.createdAt)}</span>
          </div>
          <div className="multiline">{c.body}</div>
        </div>
      ))}
      <form className="comment-form" onSubmit={submit}>
        <textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment..." required />
        <button className="btn small">Comment</button>
      </form>
      <ErrorBox error={error} />
    </div>
  );
}

function Attachments({ entityType, entityId, items, readOnly }: { entityType: Entity; entityId: string; items: Attachment[]; readOnly: boolean }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['attachments', entityType, entityId] });

  const addLink = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/api/attachments/link', { entityType, entityId, url, label });
      setUrl('');
      setLabel('');
      refresh();
    } catch (err) {
      setError(err);
    }
  };
  const upload = async (file: File) => {
    setError(null);
    setBusy(true);
    const fd = new FormData();
    fd.append('entityType', entityType);
    fd.append('entityId', entityId);
    fd.append('file', file);
    try {
      await api.post('/api/attachments/upload', fd);
      refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const remove = async (id: number) => {
    if (!confirm('Remove this attachment? It stays in the history.')) return;
    try {
      await api.post(`/api/attachments/${id}/withdraw`);
      refresh();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div className="extras-body">
      {items.length === 0 && <div className="muted small">No attachments.</div>}
      <ul className="attachments">
        {items.map((a) => (
          <li key={a.id}>
            {a.kind === 'file' ? (
              <a href={`/api/attachments/${a.id}/file`}>{a.label}</a>
            ) : a.url && a.label !== a.url ? (
              <>
                {a.label}: <EvidenceLink value={a.url} />
              </>
            ) : (
              <EvidenceLink value={a.url ?? ''} />
            )}
            <span className="muted small">
              {' '}
              {a.size ? `${Math.max(1, Math.round(a.size / 1024))} KB, ` : ''}
              {a.uploadedByName}, {fmtDateTime(a.createdAt)}
            </span>
            {!readOnly && (
              <button type="button" className="btn tiny ghost" onClick={() => remove(a.id)}>
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {readOnly ? (
        <div className="muted small">Closed: attachments are read-only.</div>
      ) : (
        <div className="attach-forms">
          <form className="row gap" onSubmit={addLink}>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" />
            <input className="grow" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Link or network path, e.g. \\server\cad\SH\rev3" required />
            <button className="btn small">Add link</button>
          </form>
          <label className="btn small upload">
            {busy ? 'Uploading...' : 'Upload file'}
            <input ref={fileRef} type="file" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
        </div>
      )}
      <ErrorBox error={error} />
    </div>
  );
}

function History({ entityType, entityId }: { entityType: Entity; entityId: string }) {
  const q = useQuery({ queryKey: ['history', entityType, entityId], queryFn: () => api.get<HistoryRow[]>(`/api/history${qs({ entityType, entityId })}`) });
  return (
    <div className="extras-body">
      <table className="history">
        <tbody>
          {(q.data ?? []).map((h) => (
            <tr key={h.id}>
              <td className="nowrap muted">{fmtDateTime(h.at)}</td>
              <td className="nowrap">{h.userName ?? 'server console'}</td>
              <td>
                {h.action === 'create' ? (
                  <em>created</em>
                ) : h.action === 'comment' ? (
                  <em>commented</em>
                ) : h.action === 'reopen' ? (
                  <em>reopened ({h.oldValue} → {h.newValue})</em>
                ) : h.field === 'attachment' ? (
                  h.newValue === '(removed)' ? <>removed attachment {h.oldValue}</> : <>attached {h.newValue}</>
                ) : (
                  <>
                    <strong>{fieldLabel(h.field)}</strong>: <span className="old">{h.oldValue || '(empty)'}</span> → <span className="new">{h.newValue || '(empty)'}</span>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
