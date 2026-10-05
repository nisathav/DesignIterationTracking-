import { useEffect, useState, type ReactNode } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { domainColours } from '../colours';
import { fmtDateTime, useMeta } from '../hooks';
import type { FeedItem } from '../types';
import { MyItemsView } from '../components/MyItems';
import { DomainBadge, IdLink, VerdictBadge } from '../components/ui';

// "Since my last visit" is the time of the previous visit, taken once per page load.
let lastVisitMarker: Promise<string | null> | null = null;
function useLastVisit() {
  const [value, setValue] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    lastVisitMarker ??= api.post<{ lastVisit: string | null }>('/api/feed/seen').then((r) => r.lastVisit);
    lastVisitMarker.then(setValue);
  }, []);
  return value;
}

const EVENT_TYPES = [
  { value: 'consideration', label: 'Considerations' },
  { value: 'iteration', label: 'Iterations' },
  { value: 'flag', label: 'Flags' },
  { value: 'comment', label: 'Comments' },
];

export function HomePage() {
  const meta = useMeta();
  const [params, setParams] = useSearchParams();
  const lastVisit = useLastVisit();
  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const v = (k: string) => params.get(k) ?? '';
  const filters = params.toString();

  const feed = useInfiniteQuery({
    queryKey: ['feed', filters],
    queryFn: ({ pageParam }) =>
      api.get<{ items: FeedItem[] }>(`/api/feed?${filters}${filters ? '&' : ''}limit=50${pageParam ? `&before=${pageParam}` : ''}`),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.items.length === 50 ? last.items[last.items.length - 1].id : undefined),
  });
  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];
  const firstOld = lastVisit ? items.findIndex((i) => i.at <= lastVisit) : -1;
  const newCount = lastVisit ? (firstOld === -1 ? items.length : firstOld) : 0;

  return (
    <div className="home">
      <div className="home-feed">
        <div className="page-head row">
          <h1>Team activity</h1>
          {lastVisit && newCount > 0 && <span className="new-pill">{newCount} new since your last visit</span>}
        </div>
        <div className="filters">
          <select value={v('domain')} onChange={(e) => set('domain', e.target.value)} title="Domain">
            <option value="">All domains</option>
            {meta.domains.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} - {d.name}
              </option>
            ))}
          </select>
          <select value={v('person')} onChange={(e) => set('person', e.target.value)} title="Person">
            <option value="">Anyone</option>
            {meta.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <select value={v('type')} onChange={(e) => set('type', e.target.value)} title="Event type">
            <option value="">All events</option>
            {EVENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <span className="daterange">
            <input type="date" value={v('from')} onChange={(e) => set('from', e.target.value)} title="From" />
            <span className="muted">to</span>
            <input type="date" value={v('to')} onChange={(e) => set('to', e.target.value)} title="To" />
          </span>
          <label className="check">
            <input type="checkbox" checked={v('following') === '1'} onChange={(e) => set('following', e.target.checked ? '1' : null)} /> Following
          </label>
          {filters && (
            <button type="button" className="btn tiny ghost" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
              Clear
            </button>
          )}
        </div>

        <ol className="feed">
          {items.map((item, n) => (
            <FeedEntry key={item.id} item={item} isNew={!!lastVisit && n < newCount} markerBefore={n === newCount && newCount > 0} />
          ))}
          {feed.isSuccess && items.length === 0 && <li className="empty muted">No activity yet. New considerations, iterations, flags and comments appear here as they happen.</li>}
        </ol>
        {feed.hasNextPage && (
          <button type="button" className="btn small" onClick={() => feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>
            {feed.isFetchingNextPage ? 'Loading...' : 'Show older'}
          </button>
        )}
      </div>
      <aside className="home-side panel">
        <header className="panel-head">
          <h2>My items</h2>
        </header>
        <div className="panel-body">
          <MyItemsView compact />
        </div>
      </aside>
    </div>
  );
}

function FeedEntry({ item, isNew, markerBefore }: { item: FeedItem; isNew: boolean; markerBefore: boolean }) {
  const c = domainColours(item.domainColour ?? '#DDDDDD');
  const { text, detail } = describe(item);
  return (
    <>
      {markerBefore && (
        <li className="feed-marker">
          <span>Since your last visit</span>
        </li>
      )}
      <li className={`feed-item ${isNew ? 'new' : ''}`} style={{ borderLeftColor: c.accent }}>
        <div className="feed-line">
          {item.domainCode && <DomainBadge code={item.domainCode} colour={item.domainColour!} />}
          <strong>{item.userName ?? 'Tracker'}</strong> <span>{text}</span>
          <span className="spacer" />
          <span className="muted small nowrap" title={fmtDateTime(item.at)}>
            {timeAgo(item.at)}
          </span>
        </div>
        {detail && <div className="feed-detail">{detail}</div>}
        {item.considerationTitle && item.entityType !== 'consideration' && (
          <div className="feed-context muted small">
            <IdLink id={item.considerationId} /> {item.considerationTitle}
          </div>
        )}
      </li>
    </>
  );
}

const clip = (s: string | null | undefined, n = 220) => (s && s.length > n ? `${s.slice(0, n)}...` : s);

function describe(i: FeedItem): { text: ReactNode; detail?: ReactNode } {
  const id = <IdLink id={i.entityId} />;
  const change = (
    <>
      {i.from ? <span className="old-inline">{i.from}</span> : null}
      {i.from ? ' → ' : ''}
      <strong>{i.to}</strong>
    </>
  );
  switch (i.event) {
    case 'consideration_created':
      return {
        text: <>created consideration {id} <strong>{i.title}</strong>{i.originFlagId ? <> from flag <IdLink id={i.originFlagId} /></> : null}</>,
        detail: i.ownerName ? <span className="muted">Owner {i.ownerName}{i.subsystemName ? ` · ${i.subsystemName}` : ''}</span> : undefined,
      };
    case 'consideration_status':
      return { text: <>changed {id} status: {change}</> };
    case 'iteration_logged':
      return {
        text: <>logged iteration {id}{i.authorName && i.authorName !== i.userName ? ` for ${i.authorName}` : ''}</>,
        detail: (
          <>
            <VerdictBadge label={i.verdictLabel ?? null} behaviour={i.verdictBehaviour ?? null} /> <span className="muted">{i.statusLabel}</span>
          </>
        ),
      };
    case 'iteration_verdict':
      return { text: <>set the verdict of {id}: {change}</> };
    case 'iteration_status':
      return { text: <>changed {id}: {change}</> };
    case 'flag_raised':
      return {
        text: (
          <>
            raised {i.typeLabel} {id} for <strong>{i.assignedToName}</strong>
            {i.affectedDomainCode && (
              <>
                {' '}
                affecting <DomainBadge code={i.affectedDomainCode} colour={i.affectedDomainColour!} />
              </>
            )}
          </>
        ),
        detail: clip(i.text),
      };
    case 'flag_answered':
      return { text: <>answered {id}</>, detail: clip(i.to) };
    case 'flag_review':
      return { text: <>reviewed {id}: <strong className={i.to === 'Changes needed' ? 'overdue-text' : 'ok-text'}>{i.to}</strong></> };
    case 'flag_status':
      return { text: <>{i.to === 'Closed' ? 'closed' : 'updated'} {id}{i.to !== 'Closed' ? <>: {change}</> : null}</> };
    case 'flag_assigned':
      return { text: <>reassigned {id} to <strong>{i.to}</strong></> };
    case 'flag_escalated':
      return { text: <>escalated {id} to the managers</>, detail: clip(i.to) };
    case 'flag_escalation_resolved':
      return { text: <>resolved the escalation on {id}</>, detail: clip(i.to) };
    case 'comment_added':
      return { text: <>commented on {id}</>, detail: clip(i.text) };
    default:
      return { text: <>updated {id}</> };
  }
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}
