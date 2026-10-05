import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { domainColours } from '../colours';
import { fmtDate, useMe } from '../hooks';
import type { Flag, Iteration, MyItems } from '../types';
import { DomainBadge, EscalatedBadge, IdLink, ReviewBadge, StatusBadge, VerdictBadge } from './ui';

export function useMyItems() {
  return useQuery({ queryKey: ['my-items'], queryFn: () => api.get<MyItems>('/api/my-items') });
}

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}...` : s);

function FlagLine({ f, show }: { f: Flag; show: 'assignee' | 'raiser' | 'status' }) {
  const c = domainColours(f.sourceDomainColour);
  return (
    <li className={`mi-row ${f.overdue ? 'overdue' : ''}`} style={{ borderLeftColor: c.accent }}>
      <div className="mi-top">
        <IdLink id={f.id} />
        <span className="muted">{f.typeLabel}</span>
        <span className="muted">→</span>
        <DomainBadge code={f.affectedDomainCode} colour={f.affectedDomainColour} />
        {f.escalated && <EscalatedBadge />}
        <span className="spacer" />
        {show === 'status' ? (
          <>
            <StatusBadge label={f.statusLabel} behaviour={f.statusBehaviour} />
            {f.typeBehaviour === 'review' && <ReviewBadge outcome={f.reviewOutcome} />}
          </>
        ) : (
          <span className={f.overdue ? 'overdue-text' : 'muted'}>{f.dueDate ? `due ${fmtDate(f.dueDate)}` : 'no due date'}</span>
        )}
      </div>
      <div className="mi-text">{short(f.request, 140)}</div>
      <div className="mi-meta muted">
        {show === 'assignee' && <>from {f.raisedByName}</>}
        {show === 'raiser' && <>for {f.assignedToName}</>}
        {show === 'status' && <>assigned to {f.assignedToName}</>}
        {' · '}
        {f.considerationTitle}
      </div>
    </li>
  );
}

function IterationLine({ it, note }: { it: Iteration; note: ReactNode }) {
  const c = domainColours(it.domainColour);
  return (
    <li className="mi-row" style={{ borderLeftColor: c.accent }}>
      <div className="mi-top">
        <IdLink id={it.id} />
        <VerdictBadge label={it.verdictLabel} behaviour={it.verdictBehaviour} />
        <span className="spacer" />
        <span className="muted">{note}</span>
      </div>
      <div className="mi-text">{it.considerationTitle}</div>
    </li>
  );
}

function Group({ title, count, children, empty }: { title: string; count: number; children: ReactNode; empty?: string }) {
  if (!count && !empty) return null;
  return (
    <div className="mi-group">
      <h3>
        {title} <span className="count-pill">{count}</span>
      </h3>
      {count ? <ul className="mi-list">{children}</ul> : <div className="muted small mi-empty">{empty}</div>}
    </div>
  );
}

/** Everything waiting on the signed-in user. `compact` is the home-page side panel. */
export function MyItemsView({ compact = false }: { compact?: boolean }) {
  const { data: me } = useMe();
  const q = useMyItems();
  if (!q.data) return <div className="muted small">Loading...</div>;
  const d = q.data;
  const raisedOpen = d.raised.filter((f) => f.statusBehaviour !== 'closed');
  const raised = compact ? raisedOpen : d.raised;
  const limit = compact ? 8 : 500;
  return (
    <div className={`my-items ${compact ? 'compact' : ''}`}>
      {me?.role === 'manager' && (
        <Group title="Escalated to managers" count={d.escalated.length}>
          {d.escalated.slice(0, limit).map((f) => (
            <FlagLine key={f.id} f={f} show="raiser" />
          ))}
        </Group>
      )}
      <Group title="Assigned to me" count={d.assigned.length} empty="Nothing open is assigned to you.">
        {d.assigned.slice(0, limit).map((f) => (
          <FlagLine key={f.id} f={f} show="assignee" />
        ))}
      </Group>
      <Group title="Ready to close (all reviews approved)" count={d.readyToClose.length}>
        {d.readyToClose.slice(0, limit).map((it) => (
          <IterationLine key={it.id} it={it} note={`${it.reviewCount} review${it.reviewCount > 1 ? 's' : ''} approved`} />
        ))}
      </Group>
      <Group title="Changes needed on my iterations" count={d.changesNeeded.length}>
        {d.changesNeeded.slice(0, limit).map((it) => (
          <IterationLine key={it.id} it={it} note={<span className="overdue-text">changes needed</span>} />
        ))}
      </Group>
      <Group title={compact ? 'Raised by me (open)' : 'Raised by me'} count={raised.length} empty="You have not raised any flags.">
        {raised.slice(0, limit).map((f) => (
          <FlagLine key={f.id} f={f} show="status" />
        ))}
      </Group>
      {compact && (
        <Link to="/my-items" className="small">
          Open My Items →
        </Link>
      )}
    </div>
  );
}

export function MyItemsPage() {
  return (
    <div>
      <div className="page-head">
        <h1>My items</h1>
        <p className="muted">Flags assigned to you (by due date, overdue in red), iterations waiting for you, and the flags you raised.</p>
      </div>
      <section className="panel">
        <div className="panel-body">
          <MyItemsView />
        </div>
      </section>
    </div>
  );
}
