import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api';
import { today, useMe, useMeta } from '../hooks';
import type { Consideration, Flag, Iteration } from '../types';
import { DomainBadge, ErrorBox, Field, IdLink, recordPath } from '../components/ui';

interface FlagDraft {
  key: number;
  typeId: number | '';
  request: string;
  assignedToId: number | '';
  affectedDomainId: number | '';
  affectedTouched: boolean;
  dueDate: string;
}

const emptyCons = {
  domainId: '' as number | '',
  subsystemId: '' as number | '',
  title: '',
  targetMetric: '',
  ownerId: '' as number | '',
  ownerTouched: false,
  originFlagId: '',
  notes: '',
};

const emptyIter = {
  considerationId: '',
  designInput: '',
  cadDesign: '',
  analyticalResults: '',
  simulationResults: '',
  evidenceLink: '',
  verdictId: '' as number | '',
  statusId: '' as number | '',
  nextAction: '',
};

let flagKey = 1;
const newFlag = (typeId: number | ''): FlagDraft => ({
  key: flagKey++, typeId, request: '', assignedToId: '', affectedDomainId: '', affectedTouched: false, dueDate: '',
});

const num = (v: string) => (v === '' ? '' : Number(v));

export function NewEntryPage() {
  const meta = useMeta();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const presetConsideration = params.get('consideration') ?? '';
  const presetOrigin = params.get('origin') ?? '';

  const [date, setDate] = useState(today());
  const [authorId, setAuthorId] = useState<number | ''>(me?.id ?? '');
  const [consOn, setConsOn] = useState(!!presetOrigin || !presetConsideration);
  const [cons, setCons] = useState({ ...emptyCons, originFlagId: presetOrigin });
  const [iterOn, setIterOn] = useState(true);
  const [iter, setIter] = useState({ ...emptyIter, considerationId: presetConsideration });
  const [flags, setFlags] = useState<FlagDraft[]>([]);
  const [flagSource, setFlagSource] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ considerationId: string | null; iterationId: string | null; flagIds: string[] } | null>(null);

  // Re-apply presets when arriving from "Add iteration" / "Create consideration from flag".
  useEffect(() => {
    if (presetConsideration) {
      setConsOn(false);
      setIterOn(true);
      setIter((s) => ({ ...s, considerationId: presetConsideration }));
    }
  }, [presetConsideration]);

  const originFlag = useQuery({
    queryKey: ['flag', presetOrigin],
    queryFn: () => api.get<{ flag: Flag }>(`/api/flags/${presetOrigin}`),
    enabled: !!presetOrigin,
  });
  useEffect(() => {
    const f = originFlag.data?.flag;
    if (f) {
      setConsOn(true);
      setCons((s) => ({ ...s, originFlagId: f.id, domainId: s.domainId || f.affectedDomainId }));
    }
  }, [originFlag.data]);

  // Defaults that depend on loaded data.
  useEffect(() => {
    if (me && authorId === '') setAuthorId(me.id);
  }, [me, authorId]);
  useEffect(() => {
    if (!meta.data) return;
    setIter((s) => (s.statusId === '' ? { ...s, statusId: meta.lookupDefault('iteration_status')?.id ?? '' } : s));
  }, [meta.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Owner defaults to the domain owner until changed by hand; sub-system resets when the domain changes.
  const setDomain = (domainId: number | '') => {
    setCons((s) => ({
      ...s,
      domainId,
      subsystemId: '',
      ownerId: s.ownerTouched ? s.ownerId : meta.domain(domainId === '' ? null : domainId)?.ownerId ?? '',
    }));
  };
  useEffect(() => {
    if (cons.domainId !== '' && cons.ownerId === '' && !cons.ownerTouched) {
      const owner = meta.domain(cons.domainId)?.ownerId;
      if (owner) setCons((s) => ({ ...s, ownerId: owner }));
    }
  }, [cons.domainId, cons.ownerId, cons.ownerTouched, meta]);

  const openConsiderations = useQuery({
    queryKey: ['considerations', 'open-for-entry'],
    queryFn: () => api.get<Consideration[]>(`/api/considerations${qs({ statusBehaviour: 'open', sort: 'id', limit: 2000 })}`),
  });
  const iterationsForFlags = useQuery({
    queryKey: ['iterations', 'for-flags'],
    queryFn: () => api.get<Iteration[]>(`/api/iterations${qs({ statusBehaviour: 'in_progress,awaiting_review,closed', sort: 'id', dir: 'desc', limit: 1000 })}`),
    enabled: flags.length > 0 && !iterOn,
  });

  // "Will be ..." ID previews. The server assigns the real IDs when saving.
  const flagSourceId = iterOn ? '' : flagSource;
  const next = useQuery({
    queryKey: ['nextIds', cons.domainId, consOn, iter.considerationId, flagSourceId],
    queryFn: () =>
      api.get<{ consideration?: string; iteration?: string; flag?: string }>(
        `/api/ids/next${qs({
          domainId: consOn && cons.domainId !== '' ? cons.domainId : undefined,
          considerationId: iter.considerationId || undefined,
          iterationId: flagSourceId || undefined,
        })}`,
      ),
    enabled: (consOn && cons.domainId !== '') || !!iter.considerationId || !!flagSourceId,
  });
  const preview = useMemo(() => {
    const c = consOn ? next.data?.consideration ?? null : null;
    const i = iterOn ? (iter.considerationId ? next.data?.iteration ?? null : c ? `${c}-I01` : null) : null;
    let flagIds: Array<string | null> = flags.map(() => null);
    if (iterOn && i) flagIds = flags.map((_, n) => `${i}-F${n + 1}`);
    else if (!iterOn && next.data?.flag) {
      const m = next.data.flag.match(/^(.*-F)(\d+)$/);
      if (m) flagIds = flags.map((_, n) => `${m[1]}${Number(m[2]) + n}`);
    }
    return { c, i, flagIds };
  }, [next.data, consOn, iterOn, iter.considerationId, flags]);

  const selectedConsideration = openConsiderations.data?.find((c) => c.id === iter.considerationId);

  const updateFlag = (key: number, patch: Partial<FlagDraft>) =>
    setFlags((fs) => fs.map((f) => (f.key === key ? { ...f, ...patch } : f)));

  const pickAssignee = (f: FlagDraft, userId: number | '') => {
    const owned = meta.activeDomains.find((d) => d.ownerId === userId);
    updateFlag(f.key, { assignedToId: userId, ...(f.affectedTouched || !owned ? {} : { affectedDomainId: owned.id }) });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!consOn && !iterOn && !flags.length) return setError(new Error('Nothing to save: fill in at least one section.'));
    if (iterOn && !consOn && !iter.considerationId) return setError(new Error('Choose the consideration for this iteration, or create a new one.'));
    if (flags.length && !iterOn && !flagSource) return setError(new Error('Flags need a source iteration: log one above or pick an existing one.'));
    const body: Record<string, unknown> = {};
    if (consOn) {
      body.consideration = {
        domainId: cons.domainId || undefined,
        subsystemId: cons.subsystemId || undefined,
        title: cons.title,
        targetMetric: cons.targetMetric,
        ownerId: cons.ownerId || undefined,
        originFlagId: cons.originFlagId.trim() || undefined,
        notes: cons.notes,
      };
    }
    if (iterOn) {
      body.iteration = {
        considerationId: iter.considerationId || undefined,
        date,
        authorId: authorId || undefined,
        designInput: iter.designInput,
        cadDesign: iter.cadDesign,
        analyticalResults: iter.analyticalResults,
        simulationResults: iter.simulationResults,
        evidenceLink: iter.evidenceLink,
        verdictId: iter.verdictId || null,
        statusId: iter.statusId || undefined,
        nextAction: iter.nextAction,
      };
    }
    body.flags = flags.map((f) => ({
      iterationId: iterOn ? undefined : flagSource,
      typeId: f.typeId || undefined,
      request: f.request,
      assignedToId: f.assignedToId || undefined,
      affectedDomainId: f.affectedDomainId || undefined,
      dueDate: f.dueDate || null,
      dateRaised: date,
    }));
    setSaving(true);
    try {
      const res = await api.post<{ considerationId: string | null; iterationId: string | null; flagIds: string[] }>('/api/entries', body);
      setResult(res);
      // Like the Excel form: keep the date and name, clear the rest.
      setCons({ ...emptyCons });
      setIter({ ...emptyIter, statusId: meta.lookupDefault('iteration_status')?.id ?? '' });
      setFlags([]);
      setFlagSource('');
      setConsOn(false);
      qc.invalidateQueries();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  if (!meta.data) return null;
  const domainOf = (id: number | '') => (id === '' ? undefined : meta.domain(id));
  const consDomain = domainOf(cons.domainId);
  const groupedConsiderations = meta.domains
    .map((d) => ({ d, items: (openConsiderations.data ?? []).filter((c) => c.domainId === d.id) }))
    .filter((g) => g.items.length);

  return (
    <form className="entry" onSubmit={submit}>
      <div className="page-head">
        <h1>New entry</h1>
        <p className="muted">One save can create a consideration, log an iteration and raise any number of flags. Leave a section off to skip it.</p>
      </div>

      {result && (
        <div className="ok-box">
          Saved:{' '}
          {[result.considerationId, result.iterationId, ...result.flagIds].filter(Boolean).map((id) => (
            <IdLink key={id} id={id} />
          ))}
          <button type="button" className="btn tiny ghost" onClick={() => setResult(null)}>
            Dismiss
          </button>
        </div>
      )}

      <section className="panel">
        <div className="panel-body grid cols-4">
          <Field label="Date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="Your name (author / raised by)">
            <select value={authorId} onChange={(e) => setAuthorId(num(e.target.value))}>
              {meta.activeUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      {/* ---------- 1. consideration ---------- */}
      <section className={`panel entry-section ${consOn ? '' : 'off'}`} style={consDomain && consOn ? { borderLeftColor: consDomain.colour } : undefined}>
        <header className="panel-head">
          <label className="toggle">
            <input type="checkbox" checked={consOn} onChange={(e) => setConsOn(e.target.checked)} />
            <h2>1. New consideration</h2>
          </label>
          <span className="muted small">only if the design target is not in the list yet</span>
          {consOn && preview.c && <span className="will-be">will be {preview.c}</span>}
        </header>
        {consOn && (
          <div className="panel-body grid cols-4">
            <Field label="Domain">
              <select value={cons.domainId} onChange={(e) => setDomain(num(e.target.value))} required>
                <option value="">Choose...</option>
                {meta.activeDomains.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code} - {d.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Sub-system">
              <select value={cons.subsystemId} onChange={(e) => setCons({ ...cons, subsystemId: num(e.target.value) })} required disabled={cons.domainId === ''}>
                <option value="">{cons.domainId === '' ? 'Choose a domain first' : 'Choose...'}</option>
                {meta.subsystemsOf(cons.domainId === '' ? null : cons.domainId).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Owner" hint="defaults to the domain owner">
              <select value={cons.ownerId} onChange={(e) => setCons({ ...cons, ownerId: num(e.target.value), ownerTouched: true })}>
                <option value="">Domain owner</option>
                {meta.activeUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Origin flag" hint="blank = root consideration">
              <input value={cons.originFlagId} onChange={(e) => setCons({ ...cons, originFlagId: e.target.value.toUpperCase() })} placeholder="e.g. SH-C01-I02-F1" />
            </Field>
            <Field label="Title" wide>
              <input value={cons.title} onChange={(e) => setCons({ ...cons, title: e.target.value })} required maxLength={200} />
            </Field>
            <Field label="Requirement / target metric" wide>
              <input value={cons.targetMetric} onChange={(e) => setCons({ ...cons, targetMetric: e.target.value })} maxLength={2000} placeholder="e.g. Faceplate temperature non-uniformity < 2 K" />
            </Field>
            <Field label="Notes" wide>
              <textarea rows={2} value={cons.notes} onChange={(e) => setCons({ ...cons, notes: e.target.value })} />
            </Field>
            {originFlag.data && (
              <div className="wide origin-note">
                From flag <IdLink id={originFlag.data.flag.id} />: {originFlag.data.flag.request}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ---------- 2. iteration ---------- */}
      <section className={`panel entry-section ${iterOn ? '' : 'off'}`} style={selectedConsideration && iterOn ? { borderLeftColor: selectedConsideration.domainColour } : undefined}>
        <header className="panel-head">
          <label className="toggle">
            <input type="checkbox" checked={iterOn} onChange={(e) => setIterOn(e.target.checked)} />
            <h2>2. Iteration</h2>
          </label>
          {iterOn && preview.i && <span className="will-be">will be {preview.i}</span>}
        </header>
        {iterOn && (
          <div className="panel-body grid cols-4">
            <Field label="Consideration" wide>
              <select value={iter.considerationId} onChange={(e) => setIter({ ...iter, considerationId: e.target.value })}>
                <option value="">{consOn ? 'The new consideration above' : 'Choose...'}</option>
                {groupedConsiderations.map(({ d, items }) => (
                  <optgroup key={d.id} label={`${d.code} - ${d.name}`}>
                    {items.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.id} - {c.title}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
            <div className="wide target-hint">
              {selectedConsideration && (
                <>
                  <DomainBadge code={selectedConsideration.domainCode} colour={selectedConsideration.domainColour} /> {selectedConsideration.subsystemName} -{' '}
                  <strong>Target:</strong> {selectedConsideration.targetMetric || <span className="muted">none set</span>}
                </>
              )}
            </div>
            <Field label="Design input / variable changes" wide>
              <textarea rows={3} value={iter.designInput} onChange={(e) => setIter({ ...iter, designInput: e.target.value })} />
            </Field>
            <Field label="CAD design (rev / file)" wide>
              <input value={iter.cadDesign} onChange={(e) => setIter({ ...iter, cadDesign: e.target.value })} />
            </Field>
            <Field label="Analytical results" wide>
              <textarea rows={3} value={iter.analyticalResults} onChange={(e) => setIter({ ...iter, analyticalResults: e.target.value })} />
            </Field>
            <Field label="Simulation results" wide>
              <textarea rows={3} value={iter.simulationResults} onChange={(e) => setIter({ ...iter, simulationResults: e.target.value })} />
            </Field>
            <Field label="Evidence link / folder" wide>
              <input value={iter.evidenceLink} onChange={(e) => setIter({ ...iter, evidenceLink: e.target.value })} placeholder="\\server\share\project\... or http://..." />
            </Field>
            <Field label="Verdict">
              <select value={iter.verdictId} onChange={(e) => setIter({ ...iter, verdictId: num(e.target.value) })}>
                <option value="">Not yet</option>
                {meta.lookups('verdict').map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select value={iter.statusId} onChange={(e) => setIter({ ...iter, statusId: num(e.target.value) })}>
                {meta.lookups('iteration_status').map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Action / next step" wide>
              <input value={iter.nextAction} onChange={(e) => setIter({ ...iter, nextAction: e.target.value })} />
            </Field>
          </div>
        )}
      </section>

      {/* ---------- 3. flags ---------- */}
      <section className="panel entry-section">
        <header className="panel-head">
          <h2>3. Flags</h2>
          <span className="muted small">ask for a review, inform someone, or hand over a side effect (one line per person)</span>
        </header>
        <div className="panel-body">
          {flags.length > 0 && !iterOn && (
            <Field label="Source iteration">
              <select value={flagSource} onChange={(e) => setFlagSource(e.target.value)} required>
                <option value="">Choose...</option>
                {(iterationsForFlags.data ?? []).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.id} - {i.considerationTitle}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {flags.length > 0 && (
            <table className="flag-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Type</th>
                  <th>What is asked / side effect</th>
                  <th>Assign to</th>
                  <th>Affected domain</th>
                  <th>Due</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {flags.map((f, n) => {
                  const ad = domainOf(f.affectedDomainId);
                  return (
                    <tr key={f.key} style={ad ? { boxShadow: `inset 4px 0 0 ${ad.colour}` } : undefined}>
                      <td className="nowrap mono muted">{preview.flagIds[n] ?? `F${n + 1}`}</td>
                      <td>
                        <select value={f.typeId} onChange={(e) => updateFlag(f.key, { typeId: num(e.target.value) })}>
                          {meta.lookups('flag_type').map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="grow">
                        <textarea rows={2} value={f.request} onChange={(e) => updateFlag(f.key, { request: e.target.value })} required />
                      </td>
                      <td>
                        <select value={f.assignedToId} onChange={(e) => pickAssignee(f, num(e.target.value))} required>
                          <option value="">Choose...</option>
                          {meta.activeUsers.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select value={f.affectedDomainId} onChange={(e) => updateFlag(f.key, { affectedDomainId: num(e.target.value), affectedTouched: true })} required>
                          <option value="">Choose...</option>
                          {meta.activeDomains.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.code}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input type="date" value={f.dueDate} onChange={(e) => updateFlag(f.key, { dueDate: e.target.value })} />
                      </td>
                      <td>
                        <button type="button" className="btn tiny ghost" onClick={() => setFlags(flags.filter((x) => x.key !== f.key))} title="Remove">
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <button type="button" className="btn small" onClick={() => setFlags([...flags, newFlag(meta.lookupDefault('flag_type')?.id ?? '')])}>
            + Add flag
          </button>
        </div>
      </section>

      <ErrorBox error={error} />
      <div className="form-actions">
        <button className="btn primary" disabled={saving}>
          {saving ? 'Saving...' : 'Save entry'}
        </button>
        {presetConsideration && (
          <Link to={recordPath(presetConsideration)} className="btn ghost">
            Back to {presetConsideration}
          </Link>
        )}
      </div>
    </form>
  );
}
