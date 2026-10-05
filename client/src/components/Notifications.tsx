import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { fmtDateTime } from '../hooks';
import { recordPath } from './ui';

export interface Notification {
  id: number;
  kind: string;
  entityType: string | null;
  entityId: string | null;
  title: string;
  body: string;
  isRead: number;
  createdAt: string;
}

const APP_TITLE = 'Design Iteration Tracker';

function useOpenNotification() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return async (n: Notification) => {
    if (!n.isRead) {
      await api.post('/api/notifications/read', { ids: [n.id] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    }
    if (n.entityId) navigate(recordPath(n.entityId));
  };
}

/** Bell with unread count; the list refreshes live when a notification arrives. */
export function Bell() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const openNotification = useOpenNotification();
  const q = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ unread: number; items: Notification[] }>('/api/notifications?limit=40'),
    // Live updates arrive over the event stream; this is only a safety net.
    refetchInterval: 60_000,
  });
  const unread = q.data?.unread ?? 0;

  useEffect(() => {
    document.title = unread ? `(${unread}) ${APP_TITLE}` : APP_TITLE;
  }, [unread]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const markAll = async () => {
    await api.post('/api/notifications/read', { all: true });
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  return (
    <div className="bell-wrap" ref={ref}>
      <button
        type="button"
        className={`bell ${unread ? 'has-unread' : ''}`}
        onClick={() => setOpen(!open)}
        title={unread ? `${unread} unread notification${unread > 1 ? 's' : ''}` : 'Notifications'}
        aria-label={`Notifications, ${unread} unread`}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z" />
        </svg>
        {unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications">
          <div className="bell-head">
            <strong>Notifications</strong>
            {unread > 0 && (
              <button type="button" className="btn tiny ghost" onClick={markAll}>
                Mark all read
              </button>
            )}
          </div>
          <ul className="bell-list">
            {(q.data?.items ?? []).map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={`bell-item ${n.isRead ? '' : 'unread'}`}
                  onClick={() => {
                    setOpen(false);
                    openNotification(n);
                  }}
                >
                  <span className="bell-title">{n.title}</span>
                  {n.body && <span className="bell-body">{n.body.length > 140 ? `${n.body.slice(0, 140)}...` : n.body}</span>}
                  <span className="bell-time">{fmtDateTime(n.createdAt)}</span>
                </button>
              </li>
            ))}
            {q.data?.items.length === 0 && <li className="bell-empty">No notifications yet.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Pop-up in the corner when a notification arrives while the app is open. */
export function Toasts() {
  const [items, setItems] = useState<Notification[]>([]);
  const openNotification = useOpenNotification();
  useEffect(() => {
    const onNew = (e: Event) => {
      const n = (e as CustomEvent<Notification>).detail;
      setItems((list) => [n, ...list].slice(0, 4));
      setTimeout(() => setItems((list) => list.filter((x) => x.id !== n.id)), 8000);
    };
    window.addEventListener('dit:notification', onNew);
    return () => window.removeEventListener('dit:notification', onNew);
  }, []);
  if (!items.length) return null;
  return (
    <div className="toasts" aria-live="polite">
      {items.map((n) => (
        <div key={n.id} className="toast">
          <button
            type="button"
            className="toast-main"
            onClick={() => {
              setItems((list) => list.filter((x) => x.id !== n.id));
              openNotification(n);
            }}
          >
            <span className="bell-title">{n.title}</span>
            {n.body && <span className="bell-body">{n.body.length > 120 ? `${n.body.slice(0, 120)}...` : n.body}</span>}
          </button>
          <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => setItems((list) => list.filter((x) => x.id !== n.id))}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
