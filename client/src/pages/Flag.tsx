import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { domainColours } from '../colours';
import { fmtDate, fmtDateTime, useMe, useMeta } from '../hooks';
import { reviewOutcomes, type Consideration, type Flag, type Iteration, type Me, type ReviewOutcome } from '../types';
import { RecordExtras } from '../components/RecordExtras';
import {
  DomainBadge, ErrorBox, EscalatedBadge, Field, IdLink, Loading, Multiline, ReviewBadge, Section, StatusBadge, VerdictBadge,
} from '../components/ui';

interface FlagDetail {
  flag: Flag;
  iteration: Iteration;
  resultingConsideration: Consideration | null;
}

const isManager = (me: Me) => me.role === 'manager';

export function FlagPage() {
  const { id = '' } = useParams();
  const { data: me } = useMe();
  const q = useQuery({ queryKey: ['flag', id], queryFn: () => api.get<FlagDetail>(`/api/flags/${id}`) });
  if (q.isLoading || !me) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { flag: f, iteration: it, resultingConsideration: rc } = q.data!;
  const col = domainColours(f.sourceDomainColour);
  const isAssignee = f.assignedToId === me.id;
  const isRaiser = f.raisedById === me.id;
  const isReview = f.typeBehaviour === 'review';
  const closed = f.statusBehaviour === 'closed';
  const canRespond = isAssignee || isManager(me);
  const canEditRequest = isRaiser || isManager(me);
  const canSpawn = !f.resultingConsiderationId && (isAssignee || isRaiser || isManager(me));

  return (
    <div className="flag-page">
      <section className="panel cons-header" style={{ borderTopColor: col.accent }}>
        <div className="cons-title-row" style={{ background: col.tint }}>
          <DomainBadge code={f.sourceDomainCode} colour={f.sourceDomainColour} />
          <span className="cons-id">{f.id}</span>
          <h1>
            {f.typeLabel} for {f.assignedToName}
          </h1>
          <span className="muted">affects</span>
          <DomainBadge code={f.affectedDomainCode} colour={f.affectedDomainColour} title={f.affectedDomainName} />
          <StatusBadge label={f.statusLabel} behaviour={f.statusBehaviour} />
          {isReview && <ReviewBadge outcome={f.reviewOutcome} />}
          {f.overdue && <span className="badge overdue-badge">Overdue</span>}
          {f.escalated && <EscalatedBadge />}
        </div>
        <div className="panel-body">
          <div className="target">
            <span className="field-label">What is asked / side effect</span>
            <div className="target-text multiline">{f.request}</div>
          </div>
          <dl className="facts">
            <dt>Raised by</dt>
            <dd>
              {f.raisedByName}, {fmtDate(f.dateRaised)}
            </dd>
            <dt>Due</dt>
            <dd className={f.overdue ? 'overdue-text' : ''}>{fmtDate(f.dueDate) || '-'}</dd>
            <dt>Source iteration</dt>
            <dd>
              <IdLink id={f.iterationId} /> by {it.authorName}, {fmtDate(it.date)}
            </dd>
            <dt>Consideration</dt>
            <dd>
              <IdLink id={f.considerationId} /> {f.considerationTitle}
            </dd>
            <dt>Sub-system</dt>
            <dd>{f.sourceSubsystemName}</dd>
            <dt>Source verdict</dt>
            <dd>
              <VerdictBadge label={f.sourceVerdictLabel} behaviour={f.sourceVerdictBehaviour} />
            </dd>
            <dt>Target</dt>
            <dd className="span-3">{f.sourceTargetMetric || '-'}</dd>
            <dt>Resulting consideration</dt>
            <dd>
              {rc ? (
                <>
                  <IdLink id={rc.id} /> {rc.title}
                </>
              ) : (
                '-'
              )}
            </dd>
            {f.dateClosed && (
              <>
                <dt>Closed</dt>
                <dd>{fmtDate(f.dateClosed)}</dd>
              </>
            )}
          </dl>
          {(it.designInput || it.simulationResults || it.analyticalResults) && (
            <details className="source-details">
              <summary>Source iteration details</summary>
              <div className="results">
                {it.designInput && <Res label="Design input" text={it.designInput} />}
                {it.analyticalResults && <Res label="Analytical results" text={it.analyticalResults} />}
                {it.simulationResults && <Res label="Simulation results" text={it.simulationResults} />}
                {it.cadDesign && <Res label="CAD design" text={it.cadDesign} />}
              </div>
            </details>
          )}
        </div>
      </section>

      {f.escalationReason && <EscalationPanel f={f} me={me} />}

      {canRespond ? (
        <RespondPanel f={f} closed={closed} />
      ) : (
        <Section title={isReview ? 'Review' : 'Response / outcome'}>
          {isReview && f.reviewOutcome && (
            <p>
              <ReviewBadge outcome={f.reviewOutcome} /> by {f.reviewOutcomeByName}, {fmtDateTime(f.reviewOutcomeAt)}
            </p>
          )}
          <Multiline text={f.response} empty={`Waiting for ${f.assignedToName}`} />
          {isRaiser && !closed && (
            <p className="muted small">
              {isReview ? 'The reviewer gives the outcome. ' : ''}You can close this flag once it is answered{isReview ? ' and an outcome is given' : ''}.
            </p>
          )}
          {isRaiser && <CloseButton f={f} />}
        </Section>
      )}

      <ActionsPanel f={f} rc={rc} canSpawn={canSpawn} canEditRequest={canEditRequest} me={me} />

      <section className="panel">
        <div className="panel-body">
          <RecordExtras entityType="flag" entityId={f.id} />
        </div>
      </section>
    </div>
  );
}

function Res({ label, text }: { label: string; text: string }) {
  return (
    <div className="result">
      <span className="field-label">{label}</span>
      <Multiline text={text} />
    </div>
  );
}

function useRefresh(id: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['flag', id] });
    qc.invalidateQueries({ queryKey: ['flags'] });
    qc.invalidateQueries({ queryKey: ['my-items'] });
  };
}

/** Assignee / manager: answer, give the review outcome, set status, close. */
function RespondPanel({ f, closed }: { f: Flag; closed: boolean }) {
  const meta = useMeta();
  const refresh = useRefresh(f.id);
  const isReview = f.typeBehaviour === 'review';
  const [response, setResponse] = useState(f.response);
  const [outcome, setOutcome] = useState<ReviewOutcome | ''>(f.reviewOutcome ?? '');
  const [statusId, setStatusId] = useState(f.statusId);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const closedStatus = meta.lookups('flag_status').find((l) => l.behaviour === 'closed');
  const inProgress = meta.lookups('flag_status').find((l) => l.behaviour === 'in_progress');
  // Follow the saved record (after my save, or someone else's).
  useEffect(() => {
    setResponse(f.response);
    setOutcome(f.reviewOutcome ?? '');
    setStatusId(f.statusId);
  }, [f.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (andClose: boolean) => {
    setError(null);
    setSaved(false);
    const body: Record<string, unknown> = { version: f.version, response };
    if (isReview) body.reviewOutcome = outcome || null;
    const target = andClose ? closedStatus?.id : statusId === f.statusId && f.statusBehaviour === 'open' && response && inProgress ? inProgress.id : statusId;
    if (target !== f.statusId) body.statusId = target;
    try {
      await api.patch(`/api/flags/${f.id}`, body);
      setSaved(true);
      refresh();
    } catch (err) {
      setError(err);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save(false);
  };

  return (
    <Section title={isReview ? 'Your review' : 'Your response'}>
      <form className="respond" onSubmit={submit}>
        {isReview && (
          <div className="outcome-choice" role="radiogroup" aria-label="Review outcome">
            {reviewOutcomes.map((o) => (
              <label key={o.value} className={`outcome ${o.value} ${outcome === o.value ? 'on' : ''}`}>
                <input type="radio" name="outcome" value={o.value} checked={outcome === o.value} onChange={() => setOutcome(o.value)} />
                {o.label}
              </label>
            ))}
          </div>
        )}
        <Field label={isReview ? 'Review comments' : 'Response / outcome'} wide>
          <textarea rows={4} value={response} onChange={(e) => setResponse(e.target.value)} placeholder={isReview ? 'What you checked, what you found, what must change' : 'Your answer'} />
        </Field>
        <div className="row gap wrap">
          <Field label="Status">
            <select value={statusId} onChange={(e) => setStatusId(Number(e.target.value))}>
              {meta.lookups('flag_status', f.statusId).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
          <div className="spacer" />
          <button className="btn">Save</button>
          {!closed && (
            <button type="button" className="btn primary" onClick={() => save(true)} disabled={isReview && !outcome}>
              {isReview ? 'Save and close review' : 'Save and close'}
            </button>
          )}
        </div>
        {f.reviewOutcome && (
          <p className="muted small">
            Outcome given by {f.reviewOutcomeByName}, {fmtDateTime(f.reviewOutcomeAt)}.
          </p>
        )}
        {isReview && outcome === 'changes_needed' && (
          <p className="hint-box">The iteration author and the consideration owner are notified. The iteration cannot be closed until a new review is approved.</p>
        )}
        <ErrorBox error={error} onReload={refresh} />
        {saved && <div className="ok-box">Saved. The people involved have been notified.</div>}
      </form>
    </Section>
  );
}

function CloseButton({ f }: { f: Flag }) {
  const meta = useMeta();
  const refresh = useRefresh(f.id);
  const [error, setError] = useState<unknown>(null);
  if (f.statusBehaviour === 'closed') return null;
  const closedStatus = meta.lookups('flag_status').find((l) => l.behaviour === 'closed');
  const blocked = f.typeBehaviour === 'review' && !f.reviewOutcome;
  return (
    <div className="row gap">
      <button
        type="button"
        className="btn"
        disabled={blocked}
        title={blocked ? 'Waiting for the reviewer to give an outcome' : undefined}
        onClick={async () => {
          try {
            await api.patch(`/api/flags/${f.id}`, { version: f.version, statusId: closedStatus?.id });
            refresh();
          } catch (err) {
            setError(err);
          }
        }}
      >
        Close flag
      </button>
      <ErrorBox error={error} />
    </div>
  );
}

function EscalationPanel({ f, me }: { f: Flag; me: Me }) {
  const refresh = useRefresh(f.id);
  const [resolution, setResolution] = useState('');
  const [error, setError] = useState<unknown>(null);
  const resolve = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post(`/api/flags/${f.id}/resolve-escalation`, { resolution });
      refresh();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <section className={`panel escalation ${f.escalated ? 'open' : 'resolved'}`}>
      <div className="panel-body">
        <div>
          <strong>{f.escalated ? 'Escalated to the managers' : 'Escalation resolved'}</strong> by {f.escalatedByName}, {fmtDateTime(f.escalatedAt)}
        </div>
        <div className="multiline">{f.escalationReason}</div>
        {!f.escalated && (
          <div className="resolution">
            <strong>Decision by {f.escalationResolvedByName}</strong>, {fmtDateTime(f.escalationResolvedAt)}: <span className="multiline">{f.escalationResolution}</span>
          </div>
        )}
        {f.escalated && isManager(me) && (
          <form className="row gap" onSubmit={resolve}>
            <input className="grow" value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Your decision / guidance" required />
            <button className="btn primary small">Resolve escalation</button>
          </form>
        )}
        <ErrorBox error={error} />
      </div>
    </section>
  );
}

function ActionsPanel({ f, rc, canSpawn, canEditRequest, me }: { f: Flag; rc: Consideration | null; canSpawn: boolean; canEditRequest: boolean; me: Me }) {
  const [mode, setMode] = useState<'none' | 'spawn' | 'edit' | 'escalate'>('none');
  const canEscalate = !f.escalated && f.statusBehaviour !== 'closed' && (f.assignedToId === me.id || f.raisedById === me.id || isManager(me));
  return (
    <Section title="Next steps">
      <div className="row gap wrap">
        {canSpawn && (
          <button type="button" className={`btn ${mode === 'spawn' ? 'on' : ''}`} onClick={() => setMode(mode === 'spawn' ? 'none' : 'spawn')}>
            Create consideration from this flag
          </button>
        )}
        {rc && rc.statusBehaviour === 'open' && (
          <Link className="btn" to={`/new?consideration=${rc.id}`}>
            Log iteration on {rc.id}
          </Link>
        )}
        <Link className="btn" to={`/new?consideration=${f.considerationId}`}>
          Log iteration on {f.considerationId}
        </Link>
        {canEditRequest && f.statusBehaviour !== 'closed' && (
          <button type="button" className={`btn ${mode === 'edit' ? 'on' : ''}`} onClick={() => setMode(mode === 'edit' ? 'none' : 'edit')}>
            Edit request / reassign
          </button>
        )}
        {canEscalate && (
          <button type="button" className={`btn warn ${mode === 'escalate' ? 'on' : ''}`} onClick={() => setMode(mode === 'escalate' ? 'none' : 'escalate')}>
            Escalate to manager
          </button>
        )}
      </div>
      {mode === 'spawn' && <SpawnForm f={f} onDone={() => setMode('none')} />}
      {mode === 'edit' && <EditRequestForm f={f} onDone={() => setMode('none')} />}
      {mode === 'escalate' && <EscalateForm f={f} onDone={() => setMode('none')} />}
    </Section>
  );
}

function SpawnForm({ f, onDone }: { f: Flag; onDone: () => void }) {
  const meta = useMeta();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    domainId: f.affectedDomainId,
    subsystemId: '' as number | '',
    title: '',
    targetMetric: '',
    ownerId: '' as number | '',
    notes: `From flag ${f.id}: ${f.request}`,
  });
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post<{ consideration: Consideration }>(`/api/flags/${f.id}/consideration`, {
        domainId: form.domainId, subsystemId: form.subsystemId || undefined, title: form.title, targetMetric: form.targetMetric,
        ownerId: form.ownerId || undefined, notes: form.notes,
      });
      qc.invalidateQueries();
      onDone();
      navigate(`/considerations/${res.consideration.id}`);
    } catch (err) {
      setError(err);
    }
  };
  return (
    <form className="grid cols-4 subform" onSubmit={submit}>
      <Field label="Domain">
        <select value={form.domainId} onChange={(e) => setForm({ ...form, domainId: Number(e.target.value), subsystemId: '' })}>
          {meta.activeDomains.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code} - {d.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Sub-system">
        <select value={form.subsystemId} onChange={(e) => setForm({ ...form, subsystemId: e.target.value ? Number(e.target.value) : '' })} required>
          <option value="">Choose...</option>
          {meta.subsystemsOf(form.domainId).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Owner" hint="defaults to the domain owner">
        <select value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value ? Number(e.target.value) : '' })}>
          <option value="">Domain owner</option>
          {meta.activeUsers.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </Field>
      <div />
      <Field label="Title" wide>
        <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={200} />
      </Field>
      <Field label="Requirement / target metric" wide>
        <input value={form.targetMetric} onChange={(e) => setForm({ ...form, targetMetric: e.target.value })} />
      </Field>
      <Field label="Notes" wide>
        <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </Field>
      <div className="wide">
        <ErrorBox error={error} />
        <div className="form-actions">
          <button className="btn primary">Create consideration</button>
          <span className="muted small">Its origin is set to {f.id}, and the flag records the new consideration.</span>
        </div>
      </div>
    </form>
  );
}

function EditRequestForm({ f, onDone }: { f: Flag; onDone: () => void }) {
  const meta = useMeta();
  const refresh = useRefresh(f.id);
  const [form, setForm] = useState({ typeId: f.typeId, assignedToId: f.assignedToId, affectedDomainId: f.affectedDomainId, request: f.request, dueDate: f.dueDate ?? '' });
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.patch(`/api/flags/${f.id}`, { version: f.version, ...form, dueDate: form.dueDate || null });
      refresh();
      onDone();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <form className="grid cols-4 subform" onSubmit={submit}>
      <Field label="Type">
        <select value={form.typeId} onChange={(e) => setForm({ ...form, typeId: Number(e.target.value) })}>
          {meta.lookups('flag_type', f.typeId).map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Assigned to">
        <select value={form.assignedToId} onChange={(e) => setForm({ ...form, assignedToId: Number(e.target.value) })}>
          {meta.users.filter((u) => u.active || u.id === f.assignedToId).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Affected domain">
        <select value={form.affectedDomainId} onChange={(e) => setForm({ ...form, affectedDomainId: Number(e.target.value) })}>
          {meta.domains.filter((d) => d.active || d.id === f.affectedDomainId).map((d) => (
            <option key={d.id} value={d.id}>
              {d.code}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Due date">
        <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
      </Field>
      <Field label="What is asked / side effect" wide>
        <textarea rows={3} value={form.request} onChange={(e) => setForm({ ...form, request: e.target.value })} required />
      </Field>
      <div className="wide">
        <ErrorBox error={error} onReload={refresh} />
        <div className="form-actions">
          <button className="btn primary">Save request</button>
          <button type="button" className="btn ghost" onClick={onDone}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}

function EscalateForm({ f, onDone }: { f: Flag; onDone: () => void }) {
  const refresh = useRefresh(f.id);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post(`/api/flags/${f.id}/escalate`, { reason });
      refresh();
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err : new Error(String(err)));
    }
  };
  return (
    <form className="subform" onSubmit={submit}>
      <Field label="Why does a manager need to step in?" wide>
        <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required placeholder="e.g. disagreement on the target, decision outside my authority, blocked by another team" />
      </Field>
      <ErrorBox error={error} />
      <div className="form-actions">
        <button className="btn warn">Escalate</button>
        <span className="muted small">All managers are notified straight away.</span>
      </div>
    </form>
  );
}
