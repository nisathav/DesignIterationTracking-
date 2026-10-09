import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { domainColours } from '../colours';
import { fmtDateTime, useMeta } from '../hooks';
import type { FeedItem } from '../types';
import { MyItemsView } from '../components/MyItems';
import { DomainBadge, VerdictBadge, recordPath } from '../components/ui';
import { groupFeed, shortId, type Action, type Tone, type Topic } from '../feedGroups';

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
      api.get<{ items: FeedItem[] }>(`/api/feed?${filters}${filters ? '&' : ''}limit=100${pageParam ? `&before=${pageParam}` : ''}`),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.items.length === 100 ? last.items[last.items.length - 1].id : undefined),
  });
  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="home">
      <div className="home-feed">
        <div className="page-head row">
          <h1>Team activity</h1>
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

        <Feed items={items} lastVisit={lastVisit ?? null} loaded={feed.isSuccess} />
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

// ---------- grouped feed (days -> topics -> merged actions) ----------

const ICONS: Record<Tone, ReactNode> = {
  ok: <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  bad: <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  warn: (
    <>
      <path d="M4 2v12" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4.8 2.5h7.5l-1.8 3 1.8 3H4.8z" fill="currentColor" />
    </>
  ),
  esc: <path d="M8 2l6 11H2z" fill="currentColor" />,
  closed: (
    <>
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </>
  ),
  log: <circle cx="8" cy="8" r="4" fill="currentColor" />,
  new: <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  note: <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" fill="currentColor" />,
};

function Icon({ tone }: { tone: Tone }) {
  return (
    <span className={`ev-ico t-${tone}`} aria-hidden="true">
      <svg viewBox="0 0 16 16">{ICONS[tone]}</svg>
    </span>
  );
}

const joinWords = (words: string[]) =>
  words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;

const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** "Nisath approved and closed I02-F1" with linked record ids. */
function Sentence({ a, cid, links = true }: { a: Action; cid: string; links?: boolean }) {
  const ids = a.ids.map((id, n) => (
    <span key={id}>
      {n > 0 && (n === a.ids.length - 1 ? ' and ' : ', ')}
      {links ? (
        <Link className="idlink" to={recordPath(id)} onClick={(e) => e.stopPropagation()}>
          {shortId(id, cid)}
        </Link>
      ) : (
        <span className="idlink">{shortId(id, cid)}</span>
      )}
    </span>
  ));
  return (
    <>
      <strong>{a.userName}</strong> {joinWords(a.verbs)} {ids}
      {a.suffix ? ` ${a.suffix}` : ''}
    </>
  );
}

function Feed({ items, lastVisit, loaded }: { items: FeedItem[]; lastVisit: string | null; loaded: boolean }) {
  const days = useMemo(() => groupFeed(items, lastVisit), [items, lastVisit]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const allKeys = days.flatMap((d) => d.topics.map((t) => t.key));
  const allOpen = allKeys.length > 0 && allKeys.every((k) => open.has(k));
  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const newTotal = days.reduce((n, d) => n + d.topics.reduce((m, t) => m + t.newCount, 0), 0);

  if (loaded && !days.length) {
    return <div className="feed-empty muted">No activity yet. New considerations, iterations, flags and comments appear here as they happen.</div>;
  }
  return (
    <div className="feed2">
      <div className="feed-bar">
        {newTotal > 0 ? (
          <span className="newbar">
            <span className="newdot" />
            {newTotal} update{newTotal > 1 ? 's' : ''} since your last visit
          </span>
        ) : (
          <span className="muted small">{lastVisit ? 'Nothing new since your last visit' : ''}</span>
        )}
        <span className="spacer" />
        {allKeys.length > 0 && (
          <button type="button" className="btn tiny ghost" onClick={() => setOpen(allOpen ? new Set() : new Set(allKeys))}>
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        )}
      </div>
      {days.map((day) => (
        <section key={day.key} className="feed-day">
          <h3 className="day-head">{day.label}</h3>
          {day.topics.map((t) => (
            <TopicBlock key={t.key} t={t} open={open.has(t.key)} onToggle={() => toggle(t.key)} />
          ))}
        </section>
      ))}
    </div>
  );
}

function TopicBlock({ t, open, onToggle }: { t: Topic; open: boolean; onToggle: () => void }) {
  const c = domainColours(t.domainColour ?? '#DDDDDD');
  const n = t.actions.length;
  return (
    <div className={`topic ${open ? 'open' : ''} ${t.newCount ? 'has-new' : ''}`} style={{ borderLeftColor: c.accent }}>
      {/* Collapsed: only the consideration. Its history opens on click. */}
      <button type="button" className="topic-head" onClick={onToggle} aria-expanded={open} style={{ background: c.tint }}>
        <span className="chev" aria-hidden="true">
          ▸
        </span>
        {t.domainCode && <DomainBadge code={t.domainCode} colour={t.domainColour!} />}
        <span className="idlink">{t.considerationId}</span>
        <span className="topic-title">{t.title}</span>
        <span className="spacer" />
        {t.newCount > 0 && <span className="new-chip">{t.newCount} new</span>}
        <span className="muted small nowrap">{clock(t.latestAt)}</span>
      </button>
      {open && (
        <>
          <ol className="topic-history">
            {t.actions.map((a) => (
              <li key={a.key} className={`ev ${a.isNew ? 'is-new' : ''}`}>
                <Icon tone={a.tone} />
                <div className="ev-main">
                  <div>
                    <Sentence a={a} cid={t.considerationId} />
                    {a.verdict && (
                      <>
                        {' '}
                        <VerdictBadge label={a.verdict.label} behaviour={a.verdict.behaviour} />
                      </>
                    )}
                    {a.statusLabel && <span className="muted"> {a.statusLabel}</span>}
                  </div>
                  {a.quote && <div className="ev-quote">{a.quote.length > 300 ? `${a.quote.slice(0, 300)}...` : a.quote}</div>}
                </div>
                <span className="ev-time" title={fmtDateTime(a.at)}>
                  {clock(a.at)}
                </span>
              </li>
            ))}
          </ol>
          <div className="topic-foot">
            <span className="muted small">
              {n} update{n > 1 ? 's' : ''} by {t.people.join(', ')}
            </span>
            <Link className="small" to={recordPath(t.considerationId)}>
              Open {t.considerationId} →
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
