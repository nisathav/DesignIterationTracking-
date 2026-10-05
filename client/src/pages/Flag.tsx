import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { domainColours } from '../colours';
import { fmtDate } from '../hooks';
import type { Consideration, Flag, Iteration } from '../types';
import { RecordExtras } from '../components/RecordExtras';
import { DomainBadge, ErrorBox, IdLink, Loading, Multiline, StatusBadge, VerdictBadge } from '../components/ui';

// Read-only view for now; responding, closing and "create consideration from
// this flag" are added in stage 3.
export function FlagPage() {
  const { id = '' } = useParams();
  const q = useQuery({
    queryKey: ['flag', id],
    queryFn: () => api.get<{ flag: Flag; iteration: Iteration; resultingConsideration: Consideration | null }>(`/api/flags/${id}`),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { flag: f, iteration: it, resultingConsideration: rc } = q.data!;
  const col = domainColours(f.sourceDomainColour);
  return (
    <section className="panel cons-header" style={{ borderTopColor: col.accent }}>
      <div className="cons-title-row" style={{ background: col.tint }}>
        <DomainBadge code={f.sourceDomainCode} colour={f.sourceDomainColour} />
        <span className="cons-id">{f.id}</span>
        <h1>{f.typeLabel} for {f.assignedToName}</h1>
        <span className="muted">affects</span>
        <DomainBadge code={f.affectedDomainCode} colour={f.affectedDomainColour} title={f.affectedDomainName} />
        <StatusBadge label={f.statusLabel} behaviour={f.statusBehaviour} />
        {f.overdue && <span className="badge overdue-badge">Overdue</span>}
      </div>
      <div className="panel-body">
        <div className="target">
          <span className="field-label">What is asked / side effect</span>
          <div className="target-text multiline">{f.request}</div>
        </div>
        <dl className="facts">
          <dt>Raised by</dt>
          <dd>{f.raisedByName}, {fmtDate(f.dateRaised)}</dd>
          <dt>Due</dt>
          <dd className={f.overdue ? 'overdue-text' : ''}>{fmtDate(f.dueDate) || '-'}</dd>
          <dt>Source iteration</dt>
          <dd><IdLink id={f.iterationId} /> by {it.authorName}</dd>
          <dt>Consideration</dt>
          <dd><IdLink id={f.considerationId} /> {f.considerationTitle}</dd>
          <dt>Sub-system</dt>
          <dd>{f.sourceSubsystemName}</dd>
          <dt>Target</dt>
          <dd>{f.sourceTargetMetric || '-'}</dd>
          <dt>Source verdict</dt>
          <dd><VerdictBadge label={f.sourceVerdictLabel} behaviour={f.sourceVerdictBehaviour} /></dd>
          <dt>Resulting consideration</dt>
          <dd>{rc ? <><IdLink id={rc.id} /> {rc.title}</> : '-'}</dd>
          {f.dateClosed && <><dt>Closed</dt><dd>{fmtDate(f.dateClosed)}</dd></>}
        </dl>
        <div className="notes">
          <span className="field-label">Response / outcome</span>
          <Multiline text={f.response} empty="No response yet" />
        </div>
        <RecordExtras entityType="flag" entityId={f.id} />
      </div>
    </section>
  );
}
