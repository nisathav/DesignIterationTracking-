import { useQuery } from '@tanstack/react-query';
import { Fragment } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { fmtDateTime } from '../hooks';
import { ErrorBox, IdLink, Loading } from '../components/ui';

/** Turn record IDs in plain text into links. */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/([A-Z]{2,3}-C\d{2,}(?:-I\d{2,}(?:-F\d+)?)?)/);
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <IdLink key={i} id={p} /> : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}

export function DigestPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['notification', id], queryFn: () => api.get<{ title: string; body: string; createdAt: string }>(`/api/notifications/${id}`) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const n = q.data!;
  return (
    <section className="panel narrow-page">
      <header className="panel-head">
        <h1>{n.title}</h1>
        <span className="muted small">{fmtDateTime(n.createdAt)}</span>
      </header>
      <div className="panel-body digest-body">
        {n.body.split('\n').map((line, i) =>
          line.startsWith('- ') ? (
            <div key={i} className="digest-item">
              <Linkified text={line.slice(2)} />
            </div>
          ) : line ? (
            <p key={i} className={line.endsWith(':') ? 'digest-head' : ''}>
              <Linkified text={line} />
            </p>
          ) : null,
        )}
      </div>
    </section>
  );
}
