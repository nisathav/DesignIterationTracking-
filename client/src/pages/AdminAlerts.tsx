import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { fmtDateTime, useMeta } from '../hooks';
import { ErrorBox, Field, Section } from '../components/ui';

interface TeamsSettings {
  enabled: boolean;
  webhookUrl: string;
  appUrl: string;
  events: Record<string, boolean>;
}
interface TeamsInfo {
  settings: TeamsSettings;
  events: Array<{ key: string; label: string }>;
  lastResult: { at: string; ok: boolean; message: string } | null;
}

/** Manager-only: post flag alerts to a Teams channel, @mentioning the people concerned. */
export function AlertsPage() {
  const meta = useMeta();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['teams-settings'], queryFn: () => api.get<TeamsInfo>('/api/admin/teams') });
  const [form, setForm] = useState<TeamsSettings | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState('');
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (q.data && !form) setForm({ ...q.data.settings, appUrl: q.data.settings.appUrl.includes('localhost') ? window.location.origin : q.data.settings.appUrl });
  }, [q.data, form]);

  if (!q.data || !form) return null;
  const noEmail = meta.activeUsers.filter((u) => !u.email);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved('');
    try {
      const res = await api.put<TeamsInfo>('/api/admin/teams', form);
      qc.setQueryData(['teams-settings'], res);
      setForm(res.settings);
      setSaved('Saved.');
    } catch (err) {
      setError(err);
    }
  };
  const test = async () => {
    setError(null);
    setSaved('');
    setTesting(true);
    try {
      await api.put('/api/admin/teams', form);
      await api.post('/api/admin/teams/test');
      setSaved('Test message sent. Check the Teams channel.');
      qc.invalidateQueries({ queryKey: ['teams-settings'] });
    } catch (err) {
      setError(err);
      qc.invalidateQueries({ queryKey: ['teams-settings'] });
    } finally {
      setTesting(false);
    }
  };

  const last = q.data.lastResult;
  return (
    <div className="admin">
      <div className="page-head">
        <h1>Teams alerts</h1>
        <p className="muted">
          Post flags to one Teams channel. Each message @mentions the person it is for, so they get a Teams notification, and has an
          "Open in tracker" button. Alerts in the app (bell) and email work as before.
        </p>
      </div>

      <Section title="1. Create the channel workflow (once)">
        <ol className="steps">
          <li>In Teams, open the channel to use (e.g. "Design tracker"), click <b>⋯</b> next to the channel name, then <b>Workflows</b>.</li>
          <li>
            Choose the template <b>Post to a channel when a webhook request is received</b>, give it a name such as "Design Iteration Tracker", and
            confirm the team and channel.
          </li>
          <li>Teams shows a long web address (it starts with <code>https://</code>). Copy it and paste it below.</li>
        </ol>
        <p className="muted small">
          The tracker PC needs internet access to reach Teams. Nothing is opened from the internet to the PC. If Teams cannot be reached, the
          tracker keeps working and the error shows below.
        </p>
      </Section>

      <Section title="2. Settings">
        <form className="teams-form" onSubmit={save}>
          <label className="check big">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Post alerts to Teams
          </label>
          <Field label="Teams workflow address" wide>
            <input value={form.webhookUrl} onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })} placeholder="https://...logic.azure.com/workflows/..." autoComplete="off" />
          </Field>
          <Field label="Tracker address for the Open in tracker button" hint="the address colleagues type in their browser" wide>
            <input value={form.appUrl} onChange={(e) => setForm({ ...form, appUrl: e.target.value })} placeholder="http://192.168.1.25:8080" required />
          </Field>
          <div className="field">
            <span className="field-label">Post when</span>
            {q.data.events.map((ev) => (
              <label key={ev.key} className="check">
                <input type="checkbox" checked={form.events[ev.key] ?? true} onChange={(e) => setForm({ ...form, events: { ...form.events, [ev.key]: e.target.checked } })} /> {ev.label}
              </label>
            ))}
          </div>
          <ErrorBox error={error} />
          {saved && <div className="ok-box">{saved}</div>}
          <div className="form-actions">
            <button className="btn primary">Save</button>
            <button type="button" className="btn" onClick={test} disabled={!form.webhookUrl || testing}>
              {testing ? 'Sending...' : 'Send test message'}
            </button>
          </div>
          {last && (
            <p className={`small ${last.ok ? 'ok-text' : 'overdue-text'}`}>
              Last message to Teams, {fmtDateTime(last.at)}: {last.ok ? 'delivered' : 'failed'}. {last.message}
            </p>
          )}
        </form>
      </Section>

      <Section title="3. Work email for each person">
        <p>
          Teams mentions use the person's work email (their Microsoft 365 sign-in). Set it in <Link to="/admin/users">Users</Link>.
        </p>
        {noEmail.length ? (
          <p className="hint-box">
            No email yet for: <b>{noEmail.map((u) => u.name).join(', ')}</b>. They are named in the message but not @mentioned.
          </p>
        ) : (
          <p className="ok-text small">Everyone has an email address.</p>
        )}
      </Section>
    </div>
  );
}
