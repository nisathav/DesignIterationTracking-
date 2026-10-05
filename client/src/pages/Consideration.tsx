import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { domainColours } from '../colours';
import { fmtDate, fmtDateTime, useMe, useMeta } from '../hooks';
import type { Consideration, ConsiderationDetail, Flag, Iteration, Me } from '../types';
import { RecordExtras } from '../components/RecordExtras';
import { DomainBadge, ErrorBox, EvidenceLink, Field, IdLink, Loading, Multiline, StatusBadge, VerdictBadge } from '../components/ui';
import { FlagTable } from './Lists';

const canEditConsideration = (me: Me, c: Consideration) => me.role === 'manager' || c.ownerId === me.id || c.createdBy === me.id;
const canEditIteration = (me: Me, i: Iteration) => me.role === 'manager' || i.authorId === me.id || i.considerationOwnerId === me.id;

export function ConsiderationPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const q = useQuery({ queryKey: ['consideration', id], queryFn: () => api.get<ConsiderationDetail>(`/api/considerations/${id}`) });

  // Jump to an iteration when the URL has #SH-C01-I02.
  useEffect(() => {
    if (q.data && location.hash) {
      const el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      el?.scrollIntoView({ block: 'start' });
      el?.classList.add('flash');
      setTimeout(() => el?.classList.remove('flash'), 1600);
    }
  }, [q.data, location.hash]);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { consideration: c, originFlag, iterations, spawned } = q.data!;

  return (
    <div className="consideration-page">
      <Header c={c} originFlag={originFlag} />

      <div className="timeline-head row">
        <h2>Iterations ({iterations.length})</h2>
        {c.statusBehaviour === 'open' ? (
          <Link className="btn primary small" to={`/new?consideration=${c.id}`}>
            + Add iteration
          </Link>
        ) : (
          <span className="muted small">{c.statusLabel}: reopen the consideration to add iterations</span>
        )}
      </div>

      <ol className="timeline" style={{ ['--accent' as string]: domainColours(c.domainColour).accent }}>
        {originFlag && (
          <li className="timeline-origin">
            Started from flag <IdLink id={originFlag.id} /> raised by {originFlag.raisedByName} on {fmtDate(originFlag.dateRaised)} in{' '}
            <DomainBadge code={originFlag.sourceDomainCode} colour={originFlag.sourceDomainColour} /> <IdLink id={originFlag.considerationId} />
          </li>
        )}
        {iterations.map((it) => (
          <IterationCard key={it.id} it={it} flags={it.flags} spawned={spawned} />
        ))}
        {iterations.length === 0 && <li className="muted empty">No iterations logged yet.</li>}
      </ol>
    </div>
  );
}

// ---------- header ----------

function Header({ c, originFlag }: { c: Consideration; originFlag: Flag | null }) {
  const { data: me } = useMe();
  const meta = useMeta();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const following = meta.isFollowing('consideration', c.id);
  const col = domainColours(c.domainColour);

  const toggleFollow = async () => {
    if (following) await api.del(`/api/follows?entityType=consideration&entityId=${c.id}`);
    else await api.put('/api/follows', { entityType: 'consideration', entityId: c.id });
    qc.invalidateQueries({ queryKey: ['meta'] });
  };

  return (
    <section className="panel cons-header" style={{ borderTopColor: col.accent }}>
      <div className="cons-title-row" style={{ background: col.tint }}>
        <DomainBadge code={c.domainCode} colour={c.domainColour} title={c.domainName} />
        <span className="cons-id">{c.id}</span>
        <h1>{c.title}</h1>
        <StatusBadge label={c.statusLabel} behaviour={c.statusBehaviour} />
        <div className="spacer" />
        <button type="button" className={`btn small ${following ? 'on' : 'ghost'}`} onClick={toggleFollow} title="Followers are notified of new iterations, flags and status changes">
          {following ? '★ Following' : '☆ Follow'}
        </button>
        {me && canEditConsideration(me, c) && !editing && (
          <button type="button" className="btn small" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <ConsiderationEdit c={c} onDone={() => setEditing(false)} />
      ) : (
        <div className="panel-body">
          <div className="target">
            <span className="field-label">Requirement / target metric</span>
            <div className="target-text">{c.targetMetric || <span className="muted">No target set</span>}</div>
          </div>
          <dl className="facts">
            <dt>Domain</dt>
            <dd>
              {c.domainCode} - {c.domainName}
            </dd>
            <dt>Sub-system</dt>
            <dd>{c.subsystemName}</dd>
            <dt>Owner</dt>
            <dd>{c.ownerName}</dd>
            <dt>Origin</dt>
            <dd>
              {originFlag ? (
                <>
                  flag <IdLink id={originFlag.id} /> ({originFlag.typeLabel} from {originFlag.raisedByName})
                </>
              ) : (
                'Root consideration'
              )}
            </dd>
            <dt>Latest verdict</dt>
            <dd>
              <VerdictBadge label={c.latestVerdictLabel} behaviour={c.latestVerdictBehaviour} />
            </dd>
            <dt>Created</dt>
            <dd>
              {c.createdByName}, {fmtDateTime(c.createdAt)}
            </dd>
          </dl>
          {c.notes && (
            <div className="notes">
              <span className="field-label">Notes</span>
              <Multiline text={c.notes} />
            </div>
          )}
          <RecordExtras entityType="consideration" entityId={c.id} />
        </div>
      )}
    </section>
  );
}

function ConsiderationEdit({ c, onDone }: { c: Consideration; onDone: () => void }) {
  const meta = useMeta();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    subsystemId: c.subsystemId, title: c.title, targetMetric: c.targetMetric, ownerId: c.ownerId, statusId: c.statusId, notes: c.notes,
  });
  const [version, setVersion] = useState(c.version);
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.patch(`/api/considerations/${c.id}`, { version, ...form });
      await qc.invalidateQueries({ queryKey: ['consideration', c.id] });
      onDone();
    } catch (err) {
      setError(err);
    }
  };
  // On a stale edit, take the other person's version as the base and keep my changes on screen.
  const reload = () => {
    const current = (error as ApiError).details?.current as Consideration | undefined;
    if (current) setVersion(current.version);
    setError(null);
    qc.invalidateQueries({ queryKey: ['consideration', c.id] });
  };
  return (
    <form className="panel-body grid cols-4" onSubmit={submit}>
      <Field label="Title" wide>
        <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={200} />
      </Field>
      <Field label="Requirement / target metric" wide>
        <textarea rows={2} value={form.targetMetric} onChange={(e) => setForm({ ...form, targetMetric: e.target.value })} />
      </Field>
      <Field label="Sub-system">
        <select value={form.subsystemId} onChange={(e) => setForm({ ...form, subsystemId: Number(e.target.value) })}>
          {meta.subsystemsOf(c.domainId, c.subsystemId).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Owner">
        <select value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: Number(e.target.value) })}>
          {meta.users.filter((u) => u.active || u.id === c.ownerId).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Status">
        <select value={form.statusId} onChange={(e) => setForm({ ...form, statusId: Number(e.target.value) })}>
          {meta.lookups('consideration_status', c.statusId).map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Notes" wide>
        <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </Field>
      <div className="wide">
        <ErrorBox error={error} onReload={reload} />
        {error instanceof ApiError && error.code === 'stale' && (
          <p className="muted small">Your changes are still in the form. "Reload latest" lets you save them over the other person's version.</p>
        )}
      </div>
      <div className="form-actions wide">
        <button className="btn primary">Save</button>
        <button type="button" className="btn ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------- iteration card ----------

function IterationCard({ it, flags, spawned }: { it: Iteration; flags: Flag[]; spawned: Consideration[] }) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const closed = it.statusBehaviour === 'closed';
  const withdrawn = it.statusBehaviour === 'withdrawn';
  const editable = !!me && canEditIteration(me, it) && !closed;
  const canClose = !!me && (me.role === 'manager' || it.considerationOwnerId === me.id);
  const reviewsDone = it.reviewApprovedCount === it.reviewCount;
  const [closing, setClosing] = useState(false);

  const reopen = async () => {
    if (!confirm(`Reopen ${it.id}? It becomes editable again.`)) return;
    try {
      await api.post(`/api/iterations/${it.id}/reopen`, { version: it.version });
      qc.invalidateQueries({ queryKey: ['consideration', it.considerationId] });
    } catch (err) {
      setError(err);
    }
  };

  return (
    <li id={it.id} className={`iteration-card ${closed ? 'closed' : ''} ${withdrawn ? 'withdrawn' : ''}`}>
      <div className={`timeline-dot ${it.verdictBehaviour ?? 'none'}`} />
      <div className="card">
        <div className="card-head">
          <span className="iter-id">{it.id}</span>
          <span className="muted">{fmtDate(it.date)}</span>
          <span>{it.authorName}</span>
          <VerdictBadge label={it.verdictLabel} behaviour={it.verdictBehaviour} />
          <StatusBadge label={it.statusLabel} behaviour={it.statusBehaviour} />
          {closed && <span className="lock" title="Closed iterations are read-only">🔒 read-only</span>}
          {it.reviewCount > 0 && (
            <span className={`review-sum ${it.reviewApprovedCount === it.reviewCount ? 'done' : it.reviewChangesNeededCount ? 'changes' : ''}`}>
              Reviews: {it.reviewApprovedCount} of {it.reviewCount} approved
              {it.reviewChangesNeededCount > 0 && `, ${it.reviewChangesNeededCount} changes needed`}
            </span>
          )}
          <div className="spacer" />
          {canClose && !closed && !withdrawn && !editing && (
            <button
              type="button"
              className={`btn small ${reviewsDone ? 'primary' : ''}`}
              onClick={() => setClosing(true)}
              title={reviewsDone ? undefined : 'Not all reviews are approved yet'}
              disabled={!reviewsDone && me?.role !== 'manager'}
            >
              Close iteration
            </button>
          )}
          {editable && !editing && (
            <button type="button" className="btn small" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          {closed && me?.role === 'manager' && (
            <button type="button" className="btn small" onClick={reopen}>
              Reopen
            </button>
          )}
        </div>
        <ErrorBox error={error} />
        {closing && <CloseIterationForm it={it} reviewsDone={reviewsDone} onDone={() => setClosing(false)} />}
        {it.closeOverrideReason && (
          <div className="override-note">Closed by a manager without all reviews approved: {it.closeOverrideReason}</div>
        )}
        {editing ? (
          <IterationEdit it={it} onDone={() => setEditing(false)} />
        ) : (
          <div className="card-body">
            <div className="results">
              <Result label="Design input / variable changes" text={it.designInput} />
              <Result label="CAD design" text={it.cadDesign} />
              <Result label="Analytical results" text={it.analyticalResults} />
              <Result label="Simulation results" text={it.simulationResults} />
              {it.evidenceLink && (
                <div className="result">
                  <span className="field-label">Evidence</span>
                  <EvidenceLink value={it.evidenceLink} />
                </div>
              )}
              <Result label="Action / next step" text={it.nextAction} />
            </div>
            {flags.length > 0 && (
              <div className="raised-flags">
                <span className="field-label">Flags raised ({flags.length})</span>
                <FlagTable flags={flags} compact />
                {spawned
                  .filter((s) => flags.some((f) => f.id === s.originFlagId))
                  .map((s) => (
                    <div key={s.id} className="spawned">
                      ↳ led to <DomainBadge code={s.domainCode} colour={s.domainColour} /> <IdLink id={s.id} /> {s.title} (
                      <StatusBadge label={s.statusLabel} behaviour={s.statusBehaviour} />)
                    </div>
                  ))}
              </div>
            )}
            <RecordExtras entityType="iteration" entityId={it.id} readOnly={closed} />
          </div>
        )}
      </div>
    </li>
  );
}

function Result({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <div className="result">
      <span className="field-label">{label}</span>
      <Multiline text={text} />
    </div>
  );
}

function IterationEdit({ it, onDone }: { it: Iteration; onDone: () => void }) {
  const meta = useMeta();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    date: it.date, authorId: it.authorId, designInput: it.designInput, cadDesign: it.cadDesign, analyticalResults: it.analyticalResults,
    simulationResults: it.simulationResults, evidenceLink: it.evidenceLink, verdictId: it.verdictId, statusId: it.statusId, nextAction: it.nextAction,
  });
  const [version, setVersion] = useState(it.version);
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.patch(`/api/iterations/${it.id}`, { version, ...form });
      await qc.invalidateQueries({ queryKey: ['consideration', it.considerationId] });
      onDone();
    } catch (err) {
      setError(err);
    }
  };
  const reload = () => {
    const current = (error as ApiError).details?.current as Iteration | undefined;
    if (current) setVersion(current.version);
    setError(null);
    qc.invalidateQueries({ queryKey: ['consideration', it.considerationId] });
  };
  const text = (k: keyof typeof form, label: string, rows = 3) => (
    <Field label={label} wide>
      <textarea rows={rows} value={String(form[k] ?? '')} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
    </Field>
  );
  return (
    <form className="card-body grid cols-4" onSubmit={submit}>
      <Field label="Date">
        <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
      </Field>
      <Field label="Author">
        <select value={form.authorId} onChange={(e) => setForm({ ...form, authorId: Number(e.target.value) })}>
          {meta.users.filter((u) => u.active || u.id === it.authorId).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Verdict">
        <select value={form.verdictId ?? ''} onChange={(e) => setForm({ ...form, verdictId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Not yet</option>
          {meta.lookups('verdict', it.verdictId).map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Status" hint="use Close iteration to close it">
        <select value={form.statusId} onChange={(e) => setForm({ ...form, statusId: Number(e.target.value) })}>
          {meta.lookups('iteration_status', it.statusId).filter((l) => l.behaviour !== 'closed').map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </Field>
      {text('designInput', 'Design input / variable changes')}
      <Field label="CAD design (rev / file)" wide>
        <input value={form.cadDesign} onChange={(e) => setForm({ ...form, cadDesign: e.target.value })} />
      </Field>
      {text('analyticalResults', 'Analytical results')}
      {text('simulationResults', 'Simulation results')}
      <Field label="Evidence link / folder" wide>
        <input value={form.evidenceLink} onChange={(e) => setForm({ ...form, evidenceLink: e.target.value })} />
      </Field>
      <Field label="Action / next step" wide>
        <input value={form.nextAction} onChange={(e) => setForm({ ...form, nextAction: e.target.value })} />
      </Field>
      <div className="wide">
        <ErrorBox error={error} onReload={reload} />
      </div>
      <div className="form-actions wide">
        <button className="btn primary">Save</button>
        <button type="button" className="btn ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Consideration owner (or manager) closes an iteration; a manager may override pending reviews with a reason. */
function CloseIterationForm({ it, reviewsDone, onDone }: { it: Iteration; reviewsDone: boolean; onDone: () => void }) {
  const meta = useMeta();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const closedStatus = meta.lookups('iteration_status').find((l) => l.behaviour === 'closed');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.patch(`/api/iterations/${it.id}`, { version: it.version, statusId: closedStatus?.id, ...(reviewsDone ? {} : { closeOverrideReason: reason }) });
      await qc.invalidateQueries({ queryKey: ['consideration', it.considerationId] });
      onDone();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <form className="close-form" onSubmit={submit}>
      <div>
        <strong>Close {it.id}?</strong> It becomes read-only; only a manager can reopen it.
        {it.verdictLabel ? ` Verdict: ${it.verdictLabel}.` : ' No verdict has been set.'}
      </div>
      {!reviewsDone && (
        <Field label={`Not all reviews are approved (${it.reviewApprovedCount} of ${it.reviewCount}). Reason for closing anyway (manager override)`} wide>
          <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required />
        </Field>
      )}
      <ErrorBox error={error} />
      <div className="form-actions">
        <button className="btn primary">{reviewsDone ? 'Close iteration' : 'Close with override'}</button>
        <button type="button" className="btn ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
