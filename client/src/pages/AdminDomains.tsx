import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { domainColours } from '../colours';
import { useMeta } from '../hooks';
import type { Domain, Lookup, LookupCategory, Subsystem } from '../types';
import { DomainBadge, ErrorBox, Field, Section } from '../components/ui';

// Domains, sub-systems and the dropdown lists. Nothing is deleted: values are
// set inactive so old records keep showing them.

const PALETTE = ['#DDEBF7', '#E4DFEC', '#FCE4D6', '#D0EDEA', '#F8D7E3', '#E8E0CC', '#D6DCE5', '#E6F0B8', '#FAD9C1', '#CFE2F3', '#EBD3E8', '#D9D9F3'];

function useSaver() {
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['meta'] });
      return true;
    } catch (e) {
      setError(e);
      return false;
    }
  };
  return { error, run, clear: () => setError(null) };
}

export function DomainsPage() {
  const meta = useMeta();
  if (!meta.data) return null;
  return (
    <div className="admin">
      <div className="page-head">
        <h1>Domains &amp; lists</h1>
        <p className="muted">
          Add domains and sub-systems here; no code change is needed. A domain code (2-3 letters) can be changed only until its first consideration is
          created, because it is part of every ID. Nothing is deleted: set a value inactive to hide it from new entries.
        </p>
      </div>
      <AddDomain />
      {meta.domains.map((d) => (
        <DomainPanel key={d.id} d={d} />
      ))}
      <h2 className="admin-sub">Dropdown lists</h2>
      <p className="muted small">
        Labels can be renamed and new values added. Each value has a fixed meaning that the rules use (for example any iteration status meaning "closed"
        makes the iteration read-only).
      </p>
      <div className="lookup-grid">
        <LookupPanel category="verdict" title="Verdicts" />
        <LookupPanel category="iteration_status" title="Iteration status" />
        <LookupPanel category="flag_type" title="Flag types" />
        <LookupPanel category="flag_status" title="Flag status" />
        <LookupPanel category="consideration_status" title="Consideration status" />
      </div>
    </div>
  );
}

function ColourPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="colour-picker">
      {PALETTE.map((p) => (
        <button key={p} type="button" className={`swatch ${p === value.toUpperCase() ? 'on' : ''}`} style={{ background: p }} onClick={() => onChange(p)} title={p} />
      ))}
      <input type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} title="Custom colour" />
    </div>
  );
}

function AddDomain() {
  const meta = useMeta();
  const { error, run } = useSaver();
  const used = new Set(meta.domains.map((d) => d.colour.toUpperCase()));
  const [form, setForm] = useState({ code: '', name: '', ownerId: '' as number | '', colour: PALETTE.find((p) => !used.has(p)) ?? PALETTE[0] });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run(() => api.post('/api/domains', { ...form, ownerId: form.ownerId || null }));
    if (ok) setForm({ code: '', name: '', ownerId: '', colour: PALETTE.find((p) => !used.has(p) && p !== form.colour) ?? PALETTE[0] });
  };
  return (
    <Section title="Add a domain">
      <form className="grid cols-4" onSubmit={submit}>
        <Field label="Code (2-3 letters)">
          <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) })} required minLength={2} placeholder="e.g. PC" />
        </Field>
        <Field label="Name">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="e.g. Pyrolysis Chamber" />
        </Field>
        <Field label="Owner">
          <select value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">No owner yet</option>
            {meta.activeUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="field align-end">
          <button className="btn primary">Add domain</button>
        </div>
        <Field label="Colour" wide>
          <ColourPicker value={form.colour} onChange={(colour) => setForm({ ...form, colour })} />
        </Field>
        <div className="wide align-end preview-badge">
          {form.code.length >= 2 && (
            <>
              Preview: <DomainBadge code={form.code} colour={form.colour} /> first ID will be {form.code}-C01
            </>
          )}
        </div>
      </form>
      <ErrorBox error={error} />
    </Section>
  );
}

function DomainPanel({ d }: { d: Domain }) {
  const meta = useMeta();
  const { error, run } = useSaver();
  const [form, setForm] = useState({ code: d.code, name: d.name, ownerId: d.ownerId ?? ('' as number | ''), colour: d.colour, active: !!d.active });
  const [newSub, setNewSub] = useState('');
  const dirty = form.code !== d.code || form.name !== d.name || (form.ownerId || null) !== d.ownerId || form.colour !== d.colour || form.active !== !!d.active;
  const c = domainColours(form.colour);
  const subs = meta.subsystems(d.id);

  const save = () =>
    run(() =>
      api.patch(`/api/domains/${d.id}`, {
        version: d.version,
        ...(form.code !== d.code ? { code: form.code } : {}),
        name: form.name, ownerId: form.ownerId || null, colour: form.colour, active: form.active,
      }),
    );
  const addSub = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => api.post(`/api/domains/${d.id}/subsystems`, { name: newSub }))) setNewSub('');
  };
  const move = (s: Subsystem, dir: -1 | 1) => {
    const i = subs.findIndex((x) => x.id === s.id);
    const other = subs[i + dir];
    if (!other) return;
    run(async () => {
      await api.patch(`/api/subsystems/${s.id}`, { version: s.version, sortOrder: other.sortOrder });
      await api.patch(`/api/subsystems/${other.id}`, { version: other.version, sortOrder: s.sortOrder === other.sortOrder ? s.sortOrder + dir : s.sortOrder });
    });
  };

  return (
    <section className={`panel domain-panel ${d.active ? '' : 'inactive'}`} style={{ borderLeftColor: c.accent }}>
      <header className="panel-head" style={{ background: c.tint }}>
        <DomainBadge code={form.code || d.code} colour={form.colour} />
        <h2>{d.name}</h2>
        {!d.active && <span className="badge status s-withdrawn">Inactive</span>}
        <span className="muted small">{d.used ? `code fixed (in use)` : 'code can still change'}</span>
      </header>
      <div className="panel-body">
        <div className="grid cols-4">
          <Field label="Code">
            <input value={form.code} disabled={!!d.used} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) })} />
          </Field>
          <Field label="Name">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Owner" hint="the owner follows the domain">
            <select value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value ? Number(e.target.value) : '' })}>
              <option value="">No owner</option>
              {meta.users.filter((u) => u.active || u.id === d.ownerId).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="field align-end row gap">
            <label className="check">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active
            </label>
            <button type="button" className="btn primary small" disabled={!dirty} onClick={save}>
              Save domain
            </button>
          </div>
          <Field label="Colour" wide>
            <ColourPicker value={form.colour} onChange={(colour) => setForm({ ...form, colour })} />
          </Field>
        </div>

        <h3 className="admin-h3">Sub-systems</h3>
        <ul className="sub-list">
          {subs.map((s, i) => (
            <SubsystemRow key={s.id} s={s} first={i === 0} last={i === subs.length - 1} onMove={(dir) => move(s, dir)} run={run} />
          ))}
        </ul>
        <form className="row gap" onSubmit={addSub}>
          <input value={newSub} onChange={(e) => setNewSub(e.target.value)} placeholder="New sub-system name" required />
          <button className="btn small">Add sub-system</button>
        </form>
        <ErrorBox error={error} />
      </div>
    </section>
  );
}

function SubsystemRow({ s, first, last, onMove, run }: { s: Subsystem; first: boolean; last: boolean; onMove: (dir: -1 | 1) => void; run: (fn: () => Promise<unknown>) => Promise<boolean> }) {
  const [name, setName] = useState(s.name);
  return (
    <li className={s.active ? '' : 'inactive'}>
      <input value={name} onChange={(e) => setName(e.target.value)} />
      {name !== s.name && (
        <button type="button" className="btn tiny primary" onClick={() => run(() => api.patch(`/api/subsystems/${s.id}`, { version: s.version, name }))}>
          Save
        </button>
      )}
      <button type="button" className="btn tiny ghost" disabled={first} onClick={() => onMove(-1)} title="Move up">
        ▲
      </button>
      <button type="button" className="btn tiny ghost" disabled={last} onClick={() => onMove(1)} title="Move down">
        ▼
      </button>
      <label className="check small">
        <input type="checkbox" checked={!!s.active} onChange={(e) => run(() => api.patch(`/api/subsystems/${s.id}`, { version: s.version, active: e.target.checked }))} /> Active
      </label>
    </li>
  );
}

const BEHAVIOURS: Record<LookupCategory, Array<[string, string]>> = {
  verdict: [['pass', 'counts as Pass (green)'], ['conditional', 'counts as Conditional (amber)'], ['fail', 'counts as Fail (red)']],
  iteration_status: [['in_progress', 'in progress'], ['awaiting_review', 'awaiting review'], ['closed', 'closed (read-only)'], ['withdrawn', 'withdrawn']],
  flag_type: [['review', 'review (needs an outcome)'], ['fyi', 'for information'], ['action', 'action']],
  flag_status: [['open', 'open'], ['in_progress', 'in progress'], ['closed', 'closed']],
  consideration_status: [['open', 'open'], ['closed', 'closed'], ['withdrawn', 'withdrawn']],
};
const meaning = (cat: LookupCategory, b: string) => BEHAVIOURS[cat].find(([k]) => k === b)?.[1] ?? b;

function LookupPanel({ category, title }: { category: LookupCategory; title: string }) {
  const meta = useMeta();
  const { error, run } = useSaver();
  const values = (meta.data?.lookups ?? []).filter((l) => l.category === category);
  const [label, setLabel] = useState('');
  const [behaviour, setBehaviour] = useState(BEHAVIOURS[category][0][0]);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => api.post('/api/lookups', { category, label, behaviour }))) setLabel('');
  };
  const move = (l: Lookup, dir: -1 | 1) => {
    const i = values.findIndex((x) => x.id === l.id);
    const other = values[i + dir];
    if (!other) return;
    run(async () => {
      await api.patch(`/api/lookups/${l.id}`, { version: l.version, sortOrder: other.sortOrder });
      await api.patch(`/api/lookups/${other.id}`, { version: other.version, sortOrder: l.sortOrder === other.sortOrder ? l.sortOrder + dir : l.sortOrder });
    });
  };
  return (
    <Section title={title}>
      <table className="lookup-table">
        <tbody>
          {values.map((l, i) => (
            <LookupRow key={l.id} l={l} category={category} first={i === 0} last={i === values.length - 1} onMove={(d) => move(l, d)} run={run} />
          ))}
        </tbody>
      </table>
      <form className="row gap wrap" onSubmit={add}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="New value" required maxLength={60} />
        <select value={behaviour} onChange={(e) => setBehaviour(e.target.value)} title="Meaning">
          {BEHAVIOURS[category].map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <button className="btn small">Add</button>
      </form>
      <ErrorBox error={error} />
    </Section>
  );
}

function LookupRow({ l, category, first, last, onMove, run }: { l: Lookup; category: LookupCategory; first: boolean; last: boolean; onMove: (d: -1 | 1) => void; run: (fn: () => Promise<unknown>) => Promise<boolean> }) {
  const [label, setLabel] = useState(l.label);
  return (
    <tr className={l.active ? '' : 'inactive'}>
      <td>
        <input value={label} onChange={(e) => setLabel(e.target.value)} />
        {label !== l.label && (
          <button type="button" className="btn tiny primary" onClick={() => run(() => api.patch(`/api/lookups/${l.id}`, { version: l.version, label }))}>
            Save
          </button>
        )}
      </td>
      <td className="muted small">{meaning(category, l.behaviour)}</td>
      <td className="nowrap">
        <button type="button" className="btn tiny ghost" disabled={first} onClick={() => onMove(-1)} title="Move up">
          ▲
        </button>
        <button type="button" className="btn tiny ghost" disabled={last} onClick={() => onMove(1)} title="Move down">
          ▼
        </button>
      </td>
      <td className="nowrap small">
        <label className="check" title="Pre-selected on new records">
          <input type="radio" name={`default-${category}`} checked={!!l.isDefault} disabled={!l.active} onChange={() => run(() => api.patch(`/api/lookups/${l.id}`, { version: l.version, isDefault: true }))} /> default
        </label>
      </td>
      <td className="nowrap small">
        <label className="check">
          <input type="checkbox" checked={!!l.active} disabled={!!l.isDefault} onChange={(e) => run(() => api.patch(`/api/lookups/${l.id}`, { version: l.version, active: e.target.checked }))} /> active
        </label>
      </td>
    </tr>
  );
}
