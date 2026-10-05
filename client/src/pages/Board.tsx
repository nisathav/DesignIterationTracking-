import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { domainColours } from '../colours';
import { daysSince, useMeta } from '../hooks';
import type { Consideration, Domain } from '../types';
import { Loading, VerdictBadge } from '../components/ui';

/** One column per domain with its open considerations. */
export function BoardPage() {
  const meta = useMeta();
  const list = useQuery({
    queryKey: ['considerations', 'board'],
    queryFn: () => api.get<Consideration[]>('/api/considerations?statusBehaviour=open&sort=id&limit=2000'),
  });
  if (!meta.data || list.isLoading) return <Loading />;
  const columns = meta.domains.filter((d) => d.active || list.data?.some((c) => c.domainId === d.id));
  return (
    <div>
      <div className="page-head">
        <h1>Domain overview</h1>
        <p className="muted">Open considerations per domain. Click a card to open it.</p>
      </div>
      <div className="board">
        {columns.map((d) => (
          <Column key={d.id} d={d} items={(list.data ?? []).filter((c) => c.domainId === d.id)} />
        ))}
      </div>
    </div>
  );
}

function Column({ d, items }: { d: Domain; items: Consideration[] }) {
  const meta = useMeta();
  const qc = useQueryClient();
  const c = domainColours(d.colour);
  const following = meta.isFollowing('domain', d.id);
  const toggle = async () => {
    if (following) await api.del(`/api/follows?entityType=domain&entityId=${d.id}`);
    else await api.put('/api/follows', { entityType: 'domain', entityId: String(d.id) });
    qc.invalidateQueries({ queryKey: ['meta'] });
  };
  const openFlags = items.reduce((n, x) => n + x.openFlagCount, 0);
  return (
    <section className="board-col">
      <header className="board-head" style={{ background: c.tint, borderTopColor: c.accent }}>
        <div className="row gap">
          <strong className="board-code" style={{ color: c.text }}>
            {d.code}
          </strong>
          <span className="board-name">{d.name}</span>
        </div>
        <div className="row gap small">
          <span className="muted">
            {d.ownerName ?? 'no owner'} · {items.length} open{openFlags ? ` · ${openFlags} open flags` : ''}
          </span>
          <span className="spacer" />
          <button type="button" className={`btn tiny ${following ? 'on' : 'ghost'}`} onClick={toggle} title="Get notified about this domain">
            {following ? '★ Following' : '☆ Follow'}
          </button>
        </div>
      </header>
      <div className="board-cards">
        {items.map((x) => {
          const days = daysSince(x.lastActivityAt);
          return (
            <Link key={x.id} to={`/considerations/${x.id}`} className="board-card" style={{ borderLeftColor: c.accent }}>
              <div className="row gap">
                <span className="idlink">{x.id}</span>
                <span className="spacer" />
                <VerdictBadge label={x.latestVerdictLabel} behaviour={x.latestVerdictBehaviour} />
              </div>
              <div className="board-title">{x.title}</div>
              <div className="board-meta">
                <span>{x.ownerName}</span>
                <span>{x.latestIterationId ? x.latestIterationId.replace(`${x.id}-`, '') : 'no iterations'}</span>
                {x.openFlagCount > 0 && <span className="flag-count">{x.openFlagCount} open flag{x.openFlagCount > 1 ? 's' : ''}</span>}
                <span className={days !== null && days > 14 ? 'stale-text' : ''}>{days === null ? '' : days === 0 ? 'today' : `${days} d ago`}</span>
              </div>
            </Link>
          );
        })}
        {items.length === 0 && <div className="muted small board-empty">No open considerations.</div>}
      </div>
    </section>
  );
}
