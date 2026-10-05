import { cloneElement, isValidElement, useId, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../api';
import { domainColours, verdictClass } from '../colours';

// ---------- badges ----------

export function DomainBadge({ code, colour, title }: { code: string; colour: string; title?: string }) {
  const c = domainColours(colour);
  return (
    <span className="badge domain" title={title} style={{ background: c.tint, borderColor: c.accent, color: c.text }}>
      {code}
    </span>
  );
}

export function VerdictBadge({ label, behaviour }: { label: string | null; behaviour: string | null }) {
  if (!label) return <span className="muted">-</span>;
  return <span className={`badge verdict ${verdictClass(behaviour)}`}>{label}</span>;
}

export function StatusBadge({ label, behaviour }: { label: string; behaviour: string }) {
  return <span className={`badge status s-${behaviour}`}>{label}</span>;
}

/** Left border + tint in the domain colour, for rows and cards. */
export function domainStyle(colour: string, tint = true): CSSProperties {
  const c = domainColours(colour);
  return { borderLeftColor: c.accent, ...(tint ? { background: c.tint } : {}) };
}

// ---------- links to records ----------

export function recordPath(id: string): string {
  if (/-F\d+$/.test(id)) return `/flags/${id}`;
  const m = id.match(/^(.*-C\d+)(-I\d+)?$/);
  if (m?.[2]) return `/considerations/${m[1]}#${id}`;
  return `/considerations/${id}`;
}

export function IdLink({ id, className }: { id: string | null | undefined; className?: string }) {
  if (!id) return null;
  return (
    <Link className={`idlink ${className ?? ''}`} to={recordPath(id)}>
      {id}
    </Link>
  );
}

// ---------- form pieces ----------

/** Label + control; the label is tied to the control by id so screen readers announce just the label. */
export function Field({ label, children, hint, wide }: { label: string; children: ReactElement<{ id?: string }>; hint?: ReactNode; wide?: boolean }) {
  const id = useId();
  return (
    <div className={`field ${wide ? 'wide' : ''}`}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {isValidElement(children) ? cloneElement(children, { id }) : children}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

export function ErrorBox({ error, onReload }: { error: unknown; onReload?: () => void }) {
  if (!error) return null;
  const e = error as ApiError;
  const stale = e instanceof ApiError && e.code === 'stale';
  return (
    <div className="error-box" role="alert">
      {e.message ?? String(error)}
      {stale && onReload && (
        <button type="button" className="btn small" onClick={onReload}>
          Reload latest
        </button>
      )}
    </div>
  );
}

export function Loading() {
  return <div className="loading">Loading...</div>;
}

export function Multiline({ text, empty = '-' }: { text: string | null | undefined; empty?: string }) {
  if (!text) return <span className="muted">{empty}</span>;
  return <span className="multiline">{text}</span>;
}

/** Evidence link: web links open; network paths are shown with a copy button (browsers block file:// links). */
export function EvidenceLink({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="muted">-</span>;
  if (/^https?:\/\//i.test(value)) {
    return (
      <a href={value} target="_blank" rel="noreferrer">
        {value}
      </a>
    );
  }
  return (
    <span className="path">
      <code>{value}</code>
      <button
        type="button"
        className="btn tiny"
        onClick={() => {
          navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
}

export function Section({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>{title}</h2>
        {actions && <div className="panel-actions">{actions}</div>}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}
