import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { domainColours, verdictClass } from '../colours';
import { DomainBadge, ErrorBox, Loading, recordPath } from '../components/ui';

interface TraceNode {
  kind: 'consideration' | 'iteration' | 'flag';
  id: string;
  label: string;
  domainCode: string;
  domainColour: string;
  status: string;
  statusBehaviour: string;
  tone: string | null;
  toneLabel: string | null;
  sub: string;
  children: TraceNode[];
}

const KIND: Record<TraceNode['kind'], string> = { consideration: 'Consideration', iteration: 'Iteration', flag: 'Flag' };

function NodeBox({ n, focus }: { n: TraceNode; focus: string }) {
  const c = domainColours(n.domainColour);
  return (
    <Link
      to={recordPath(n.id)}
      className={`tbox k-${n.kind} ${n.id === focus ? 'focus' : ''} ${n.statusBehaviour === 'closed' || n.statusBehaviour === 'withdrawn' ? 'done' : ''}`}
      style={{ borderLeftColor: c.accent, background: n.kind === 'consideration' ? c.tint : undefined }}
      title={`${KIND[n.kind]} ${n.id}: ${n.label}`}
    >
      <span className="tbox-top">
        <span className="tkind">{KIND[n.kind]}</span>
        {n.kind !== 'iteration' && <DomainBadge code={n.domainCode} colour={n.domainColour} />}
      </span>
      <span className="idlink">{n.id}</span>
      <span className="tlabel">{n.label}</span>
      <span className="tbox-bottom">
        <span className={`badge status s-${n.statusBehaviour}`}>{n.status}</span>
        {n.toneLabel && <span className={`badge verdict ${verdictClass(n.tone)}`}>{n.toneLabel}</span>}
      </span>
      <span className="tsub muted">{n.sub}</span>
    </Link>
  );
}

function TreeNode({ n, focus }: { n: TraceNode; focus: string }) {
  return (
    <div className="trow">
      <NodeBox n={n} focus={focus} />
      {n.children.length > 0 && (
        <div className="tchildren">
          {n.children.map((ch) => (
            <div key={ch.id} className="tchild">
              <TreeNode n={ch} focus={focus} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const countAll = (n: TraceNode): Record<string, number> => {
  const acc: Record<string, number> = { consideration: 0, iteration: 0, flag: 0 };
  const walk = (x: TraceNode) => {
    acc[x.kind]++;
    x.children.forEach(walk);
  };
  walk(n);
  return acc;
};
const domainsIn = (n: TraceNode): string[] => {
  const s = new Set<string>();
  const walk = (x: TraceNode) => {
    if (x.kind === 'consideration') s.add(x.domainCode);
    x.children.forEach(walk);
  };
  walk(n);
  return [...s];
};

/** Root consideration -> iterations -> flags -> spawned considerations, across domains. */
export function TracePage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['trace', id], queryFn: () => api.get<{ root: TraceNode; focus: string }>(`/api/considerations/${id}/trace`) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { root, focus } = q.data!;
  const counts = countAll(root);
  return (
    <div className="trace-page">
      <div className="page-head row">
        <div>
          <h1>Trace of {focus}</h1>
          <p className="muted">
            The whole chain {focus === root.id ? 'starting at this consideration' : <>from its root <Link to={recordPath(root.id)}>{root.id}</Link></>}: {counts.consideration}{' '}
            consideration{counts.consideration > 1 ? 's' : ''} across {domainsIn(root).join(', ')}, {counts.iteration} iteration{counts.iteration === 1 ? '' : 's'}, {counts.flag} flag
            {counts.flag === 1 ? '' : 's'}. Click any box to open it.
          </p>
        </div>
        <Link className="btn small" to={recordPath(focus)}>
          Back to {focus}
        </Link>
      </div>
      <div className="trace-scroll">
        <TreeNode n={root} focus={focus} />
      </div>
      <p className="muted small">
        Read left to right: a consideration, its iterations in order, the flags each iteration raised, and the considerations those flags led to.
        Flags show the domain they affect. Faded boxes are closed or withdrawn.
      </p>
    </div>
  );
}
