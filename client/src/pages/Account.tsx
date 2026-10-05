import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, signOut } from '../api';
import { useMe } from '../hooks';
import { ErrorBox, Field } from '../components/ui';

export function LoginPage() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/login', { name, password });
      await qc.resetQueries();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="center-card" onSubmit={submit}>
      <h1>Design Iteration Tracker</h1>
      <Field label="Name">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" required />
      </Field>
      <Field label="Password">
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      </Field>
      <ErrorBox error={error} />
      <button className="btn primary" disabled={busy}>
        Sign in
      </button>
      <p className="muted small">Forgot your password? Ask the manager to reset it.</p>
    </form>
  );
}

/** First run only: no manager has a password yet. */
export function SetupPage({ managerName }: { managerName: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState(managerName);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError(new Error('The two passwords do not match'));
    try {
      await api.post('/api/setup', { name, password });
      await qc.resetQueries();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <form className="center-card" onSubmit={submit}>
      <h1>First-time setup</h1>
      <p>Choose the manager's password. The manager can then add users and reset passwords.</p>
      <Field label="Manager name">
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field label="Password (at least 8 characters)">
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required autoComplete="new-password" />
      </Field>
      <Field label="Repeat password">
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
      </Field>
      <ErrorBox error={error} />
      <button className="btn primary">Save and sign in</button>
    </form>
  );
}

export function ChangePasswordPage({ forced = false }: { forced?: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) return setError(new Error('The two passwords do not match'));
    try {
      await api.post('/api/auth/password', { currentPassword: forced ? undefined : current, newPassword: password });
      setDone(true);
      await qc.invalidateQueries({ queryKey: ['me'] });
      if (forced) navigate('/');
    } catch (err) {
      setError(err);
    }
  };
  return (
    <form className={forced ? 'center-card' : 'panel panel-body narrow'} onSubmit={submit}>
      <h1>{forced ? `Welcome, ${me?.name}` : 'Change password'}</h1>
      {forced && <p>You signed in with a temporary password. Please choose your own password to continue.</p>}
      {!forced && (
        <Field label="Current password">
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
        </Field>
      )}
      <Field label="New password (at least 8 characters)">
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required autoComplete="new-password" />
      </Field>
      <Field label="Repeat new password">
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
      </Field>
      <ErrorBox error={error} />
      {done && !forced && <div className="ok-box">Password changed. Your other sessions were signed out.</div>}
      <div className="row gap">
        <button className="btn primary">Save password</button>
        {forced && (
          <button type="button" className="btn ghost" onClick={signOut}>
            Sign out
          </button>
        )}
      </div>
    </form>
  );
}
