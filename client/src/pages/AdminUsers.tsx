import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { fmtDate, useMe } from '../hooks';
import { ErrorBox, Field, Section } from '../components/ui';

interface AdminUser {
  id: number;
  name: string;
  email: string | null;
  role: 'manager' | 'designer';
  active: number;
  mustChangePassword: number;
  hasPassword: number;
  createdAt: string;
  version: number;
}

/** Shown once after creating a user or resetting a password. */
function TempPassword({ name, password, onClose }: { name: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="ok-box temp-password">
      <div>
        Temporary password for <strong>{name}</strong>: <code className="pw">{password}</code>
        <button
          type="button"
          className="btn tiny"
          onClick={() => navigator.clipboard?.writeText(password).then(() => setCopied(true))}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="small">Give it to {name} in person. It is shown only now; they must choose their own password when they sign in.</div>
      <button type="button" className="btn tiny ghost" onClick={onClose}>
        Done
      </button>
    </div>
  );
}

export function UsersPage() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<AdminUser[]>('/api/users') });
  const [issued, setIssued] = useState<{ name: string; password: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [form, setForm] = useState({ name: '', email: '', role: 'designer', password: '' });
  const [editing, setEditing] = useState<number | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['users'] });
    qc.invalidateQueries({ queryKey: ['meta'] });
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.post<{ user: AdminUser; temporaryPassword: string }>('/api/users', {
        name: form.name, email: form.email || null, role: form.role, password: form.password || undefined,
      });
      setIssued({ name: res.user.name, password: res.temporaryPassword });
      setForm({ name: '', email: '', role: 'designer', password: '' });
      refresh();
    } catch (err) {
      setError(err);
    }
  };

  const reset = async (u: AdminUser) => {
    if (!confirm(`Give ${u.name} a new temporary password? They will be signed out everywhere.`)) return;
    setError(null);
    try {
      const res = await api.post<{ temporaryPassword: string }>(`/api/users/${u.id}/password`, {});
      setIssued({ name: u.name, password: res.temporaryPassword });
      refresh();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div className="admin">
      <div className="page-head">
        <h1>Users</h1>
        <p className="muted">Everyone can read everything. Managers can also manage users, domains and lists.</p>
      </div>
      {issued && <TempPassword {...issued} onClose={() => setIssued(null)} />}
      <ErrorBox error={error} />

      <Section title="Add a user">
        <form className="grid cols-5" onSubmit={create}>
          <Field label="Name (used to sign in)">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={80} />
          </Field>
          <Field label="Email (optional)">
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Role">
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="designer">Designer</option>
              <option value="manager">Manager</option>
            </select>
          </Field>
          <Field label="Temporary password" hint="leave blank to generate one">
            <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={8} autoComplete="off" />
          </Field>
          <div className="field align-end">
            <button className="btn primary">Add user</button>
          </div>
        </form>
      </Section>

      <Section title={`Team (${users.data?.length ?? 0})`}>
        <div className="table-wrap">
          <table className="list">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Sign-in</th>
                <th>Added</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.data?.map((u) =>
                editing === u.id ? (
                  <UserEditRow key={u.id} u={u} onDone={() => { setEditing(null); refresh(); }} />
                ) : (
                  <tr key={u.id} className={u.active ? '' : 'inactive'}>
                    <td className="strong">
                      {u.name}
                      {u.id === me?.id && <span className="muted"> (you)</span>}
                    </td>
                    <td>{u.email ?? <span className="muted">-</span>}</td>
                    <td>{u.role === 'manager' ? 'Manager' : 'Designer'}</td>
                    <td>
                      {!u.active ? (
                        <span className="badge status s-withdrawn">Inactive</span>
                      ) : !u.hasPassword ? (
                        <span className="badge status s-in_progress">No password</span>
                      ) : u.mustChangePassword ? (
                        <span className="badge status s-awaiting_review">Temporary password</span>
                      ) : (
                        <span className="badge status s-open">Active</span>
                      )}
                    </td>
                    <td className="muted">{fmtDate(u.createdAt.slice(0, 10))}</td>
                    <td className="nowrap right">
                      <button type="button" className="btn tiny" onClick={() => setEditing(u.id)}>
                        Edit
                      </button>{' '}
                      <button type="button" className="btn tiny" onClick={() => reset(u)} disabled={!u.active}>
                        Reset password
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          Users are never deleted: set them inactive so their history stays. Lost the manager password? On the server PC run{' '}
          <code>npm run user -- reset "Name"</code>.
        </p>
      </Section>
    </div>
  );
}

function UserEditRow({ u, onDone }: { u: AdminUser; onDone: () => void }) {
  const [form, setForm] = useState({ name: u.name, email: u.email ?? '', role: u.role, active: !!u.active });
  const [error, setError] = useState<unknown>(null);
  const save = async () => {
    setError(null);
    try {
      await api.patch(`/api/users/${u.id}`, { version: u.version, name: form.name, email: form.email || null, role: form.role, active: form.active });
      onDone();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <tr className="editing">
      <td>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </td>
      <td>
        <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </td>
      <td>
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as AdminUser['role'] })}>
          <option value="designer">Designer</option>
          <option value="manager">Manager</option>
        </select>
      </td>
      <td>
        <label className="check">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active
        </label>
      </td>
      <td colSpan={2} className="right">
        <ErrorBox error={error} />
        <button type="button" className="btn tiny primary" onClick={save}>
          Save
        </button>{' '}
        <button type="button" className="btn tiny ghost" onClick={onDone}>
          Cancel
        </button>
      </td>
    </tr>
  );
}
