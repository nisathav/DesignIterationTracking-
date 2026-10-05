import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { daysSince, fmtDate, useMeta } from '../hooks';
import type { Consideration, Flag, Iteration, LookupCategory } from '../types';
import { DomainBadge, IdLink, Loading, StatusBadge, VerdictBadge, domainStyle } from '../components/ui';

// Filters live in the URL so a filtered list can be bookmarked or shared.

type FilterKey = 'domain' | 'subsystem' | 'person' | 'verdict' | 'status' | 'type' | 'affectedDomain' | 'from' | 'to' | 'q' | 'following' | 'overdue';

interface FilterSpec {
  keys: FilterKey[];
  personLabel: string;
  statusCategory: LookupCategory;
  dateLabel: string;
}

function useListParams() {
  const [params, setParams] = useSearchParams();
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };
  return { params, set };
}

function FilterBar({ spec, count }: { spec: FilterSpec; count: number | undefined }) {
  const meta = useMeta();
  const { params, set } = useListParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  // Debounce free-text search.
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('q') ?? '') !== q) set({ q });
    }, 300);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const v = (k: string) => params.get(k) ?? '';
  const domainId = v('domain') ? Number(v('domain')) : null;
  const has = (k: FilterKey) => spec.keys.includes(k);
  const anyFilter = [...params.keys()].some((k) => k !== 'sort' && k !== 'dir');

  return (
    <div className="filters">
      <input className="search" placeholder="Search ID, text, names..." value={q} onChange={(e) => setQ(e.target.value)} />
      {has('domain') && (
        <select value={v('domain')} onChange={(e) => set({ domain: e.target.value, subsystem: null })} title="Domain">
          <option value="">All domains</option>
          {meta.domains.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code} - {d.name}
            </option>
          ))}
        </select>
      )}
      {has('subsystem') && (
        <select value={v('subsystem')} onChange={(e) => set({ subsystem: e.target.value })} disabled={!domainId} title="Sub-system">
          <option value="">{domainId ? 'All sub-systems' : 'Sub-system (pick domain)'}</option>
          {meta.subsystemsOf(domainId).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
      {has('affectedDomain') && (
        <select value={v('affectedDomain')} onChange={(e) => set({ affectedDomain: e.target.value })} title="Affected domain">
          <option value="">Any affected domain</option>
          {meta.domains.map((d) => (
            <option key={d.id} value={d.id}>
              affects {d.code}
            </option>
          ))}
        </select>
      )}
      {has('person') && (
        <select value={v('person')} onChange={(e) => set({ person: e.target.value })} title={spec.personLabel}>
          <option value="">{spec.personLabel}: anyone</option>
          {meta.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      )}
      {has('type') && (
        <select value={v('type')} onChange={(e) => set({ type: e.target.value })} title="Type">
          <option value="">Any type</option>
          {meta.lookups('flag_type', -1).map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      )}
      {has('verdict') && (
        <select value={v('verdict')} onChange={(e) => set({ verdict: e.target.value })} title="Verdict">
          <option value="">Any verdict</option>
          {meta.lookups('verdict', -1).map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      )}
      {has('status') && (
        <select value={v('status')} onChange={(e) => set({ status: e.target.value })} title="Status">
          <option value="">Any status</option>
          {meta.lookups(spec.statusCategory, -1).map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      )}
      {has('from') && (
        <span className="daterange" title={spec.dateLabel}>
          <span className="muted small">{spec.dateLabel}</span>
          <input type="date" value={v('from')} onChange={(e) => set({ from: e.target.value })} />
          <span className="muted">to</span>
          <input type="date" value={v('to')} onChange={(e) => set({ to: e.target.value })} />
        </span>
      )}
      {has('overdue') && (
        <label className="check">
          <input type="checkbox" checked={v('overdue') === '1'} onChange={(e) => set({ overdue: e.target.checked ? '1' : null })} /> Overdue
        </label>
      )}
      <label className="check">
        <input type="checkbox" checked={v('following') === '1'} onChange={(e) => set({ following: e.target.checked ? '1' : null })} /> Following
      </label>
      {anyFilter && (
        <button
          type="button"
          className="btn tiny ghost"
          onClick={() => {
            setQ('');
            set(Object.fromEntries([...params.keys()].filter((k) => k !== 'sort' && k !== 'dir').map((k) => [k, null])));
          }}
        >
          Clear filters
        </button>
      )}
      <span className="count muted">{count === undefined ? '' : `${count} shown`}</span>
    </div>
  );
}

/** Column header that sorts on the server (the sort never touches IDs). */
function Th({ k, children, className }: { k?: string; children: ReactNode; className?: string }) {
  const { params, set } = useListParams();
  if (!k) return <th className={className}>{children}</th>;
  const active = params.get('sort') === k;
  const dir = params.get('dir') === 'desc' ? 'desc' : 'asc';
  return (
    <th className={`sortable ${active ? 'active' : ''} ${className ?? ''}`} onClick={() => set({ sort: k, dir: active && dir === 'asc' ? 'desc' : 'asc' })}>
      {children}
      <span className="sort-arrow">{active ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
    </th>
  );
}

function useList<T>(path: string, personParam: string) {
  const { params } = useListParams();
  const query = new URLSearchParams(params);
  // The person filter means different things per list (owner, author, assignee...).
  if (query.get('person') && personParam !== 'person') {
    query.set(personParam, query.get('person')!);
    query.delete('person');
  }
  const url = `${path}?${query.toString()}`;
  return useQuery({ queryKey: [path.split('/')[2], 'list', url], queryFn: () => api.get<T[]>(url), placeholderData: (prev) => prev });
}

const truncate = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n)}...` : s);

// ---------- considerations ----------

export function ConsiderationListPage() {
  const list = useList<Consideration>('/api/considerations', 'owner');
  return (
    <div>
      <div className="page-head row">
        <h1>Considerations</h1>
        <Link className="btn primary small" to="/new">
          + New entry
        </Link>
      </div>
      <FilterBar
        spec={{ keys: ['domain', 'subsystem', 'person', 'verdict', 'status', 'from', 'q', 'following'], personLabel: 'Owner', statusCategory: 'consideration_status', dateLabel: 'Created' }}
        count={list.data?.length}
      />
      {list.isLoading ? (
        <Loading />
      ) : (
        <div className="table-wrap">
          <table className="list">
            <thead>
              <tr>
                <Th k="id">ID</Th>
                <Th k="domain">Domain</Th>
                <Th k="subsystem">Sub-system</Th>
                <Th k="title">Title</Th>
                <th>Target metric</th>
                <Th k="owner">Owner</Th>
                <Th k="status">Status</Th>
                <th className="num">Iter.</th>
                <Th k="verdict">Latest verdict</Th>
                <th className="num">Open flags</th>
                <Th k="activity">Last activity</Th>
              </tr>
            </thead>
            <tbody>
              {list.data?.map((c) => (
                <tr key={c.id} className="domain-row" style={domainStyle(c.domainColour)}>
                  <td className="nowrap">
                    <IdLink id={c.id} />
                  </td>
                  <td>
                    <DomainBadge code={c.domainCode} colour={c.domainColour} title={c.domainName} />
                  </td>
                  <td>{c.subsystemName}</td>
                  <td className="strong">{c.title}</td>
                  <td className="muted">{truncate(c.targetMetric, 80)}</td>
                  <td>{c.ownerName}</td>
                  <td>
                    <StatusBadge label={c.statusLabel} behaviour={c.statusBehaviour} />
                  </td>
                  <td className="num">{c.iterationCount}</td>
                  <td>
                    <VerdictBadge label={c.latestVerdictLabel} behaviour={c.latestVerdictBehaviour} />
                  </td>
                  <td className="num">{c.openFlagCount || ''}</td>
                  <td className="nowrap muted">{c.lastActivityAt ? `${daysSince(c.lastActivityAt)} d ago` : ''}</td>
                </tr>
              ))}
              {list.data?.length === 0 && <EmptyRow cols={11} />}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------- iterations ----------

export function IterationListPage() {
  const list = useList<Iteration>('/api/iterations', 'person');
  return (
    <div>
      <div className="page-head row">
        <h1>Iterations</h1>
      </div>
      <FilterBar
        spec={{ keys: ['domain', 'subsystem', 'person', 'verdict', 'status', 'from', 'q', 'following'], personLabel: 'Author', statusCategory: 'iteration_status', dateLabel: 'Date' }}
        count={list.data?.length}
      />
      {list.isLoading ? (
        <Loading />
      ) : (
        <div className="table-wrap">
          <table className="list">
            <thead>
              <tr>
                <Th k="id">ID</Th>
                <Th k="date">Date</Th>
                <Th k="domain">Domain</Th>
                <Th k="subsystem">Sub-system</Th>
                <th>Consideration</th>
                <Th k="author">Author</Th>
                <th>Design input</th>
                <Th k="verdict">Verdict</Th>
                <Th k="status">Status</Th>
                <th className="num">Open flags</th>
                <th>Next step</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.map((i) => (
                <tr key={i.id} className="domain-row" style={domainStyle(i.domainColour)}>
                  <td className="nowrap">
                    <IdLink id={i.id} />
                  </td>
                  <td className="nowrap">{fmtDate(i.date)}</td>
                  <td>
                    <DomainBadge code={i.domainCode} colour={i.domainColour} />
                  </td>
                  <td>{i.subsystemName}</td>
                  <td>{i.considerationTitle}</td>
                  <td>{i.authorName}</td>
                  <td className="muted">{truncate(i.designInput, 90)}</td>
                  <td>
                    <VerdictBadge label={i.verdictLabel} behaviour={i.verdictBehaviour} />
                  </td>
                  <td>
                    <StatusBadge label={i.statusLabel} behaviour={i.statusBehaviour} />
                  </td>
                  <td className="num">{i.openFlagCount || ''}</td>
                  <td className="muted">{truncate(i.nextAction, 80)}</td>
                </tr>
              ))}
              {list.data?.length === 0 && <EmptyRow cols={11} />}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------- flags ----------

export function FlagListPage() {
  const list = useList<Flag>('/api/flags', 'person');
  return (
    <div>
      <div className="page-head row">
        <h1>Flags</h1>
      </div>
      <FilterBar
        spec={{ keys: ['domain', 'subsystem', 'affectedDomain', 'person', 'type', 'verdict', 'status', 'from', 'q', 'following', 'overdue'], personLabel: 'Person', statusCategory: 'flag_status', dateLabel: 'Raised' }}
        count={list.data?.length}
      />
      {list.isLoading ? <Loading /> : <FlagTable flags={list.data ?? []} sortable />}
    </div>
  );
}

export function FlagTable({ flags, sortable = false, compact = false }: { flags: Flag[]; sortable?: boolean; compact?: boolean }) {
  const H = sortable ? Th : ({ children }: { k?: string; children: ReactNode }) => <th>{children}</th>;
  return (
    <div className="table-wrap">
      <table className={`list ${compact ? 'compact' : ''}`}>
        <thead>
          <tr>
            <H k="id">ID</H>
            <H k="type">Type</H>
            {!compact && <H k="domain">From</H>}
            <H k="affected">Affects</H>
            <H k="assignee">Assigned to</H>
            {!compact && <H k="raisedBy">Raised by</H>}
            <th>What is asked / side effect</th>
            <H k="due">Due</H>
            <H k="status">Status</H>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {flags.map((f) => (
            <tr key={f.id} className={`domain-row ${f.overdue ? 'overdue' : ''}`} style={domainStyle(f.sourceDomainColour, !compact)}>
              <td className="nowrap">
                <IdLink id={f.id} />
              </td>
              <td>{f.typeLabel}</td>
              {!compact && (
                <td>
                  <DomainBadge code={f.sourceDomainCode} colour={f.sourceDomainColour} />
                </td>
              )}
              <td>
                <DomainBadge code={f.affectedDomainCode} colour={f.affectedDomainColour} title={f.affectedDomainName} />
              </td>
              <td className="nowrap">{f.assignedToName}</td>
              {!compact && <td className="nowrap">{f.raisedByName}</td>}
              <td>
                {truncate(f.request, 140)}
                {f.response && <div className="response">↳ {truncate(f.response, 140)}</div>}
              </td>
              <td className={`nowrap ${f.overdue ? 'overdue-text' : ''}`}>{fmtDate(f.dueDate)}</td>
              <td>
                <StatusBadge label={f.statusLabel} behaviour={f.statusBehaviour} />
              </td>
              <td>
                <IdLink id={f.resultingConsiderationId} />
              </td>
            </tr>
          ))}
          {flags.length === 0 && <EmptyRow cols={10} />}
        </tbody>
      </table>
    </div>
  );
}

function EmptyRow({ cols }: { cols: number }) {
  return (
    <tr>
      <td colSpan={cols} className="empty">
        Nothing to show.
      </td>
    </tr>
  );
}
