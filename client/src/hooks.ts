import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { Domain, Lookup, LookupCategory, Me, Meta, Subsystem, User } from './types';

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/api/auth/me'), retry: false, staleTime: 60_000 });
}

/** Domains, sub-systems, users and lookups, with convenience lookups. */
export function useMeta() {
  const q = useQuery({ queryKey: ['meta'], queryFn: () => api.get<Meta>('/api/meta'), staleTime: 60_000 });
  const helpers = useMemo(() => {
    const m = q.data;
    const domains = m?.domains ?? [];
    const users = m?.users ?? [];
    const lookups = m?.lookups ?? [];
    const subsystems = m?.subsystems ?? [];
    return {
      domains,
      activeDomains: domains.filter((d) => d.active),
      users,
      activeUsers: users.filter((u) => u.active),
      domain: (id: number | null | undefined): Domain | undefined => domains.find((d) => d.id === id),
      user: (id: number | null | undefined): User | undefined => users.find((u) => u.id === id),
      subsystemsOf: (domainId: number | null | undefined, includeId?: number): Subsystem[] =>
        subsystems.filter((s) => s.domainId === domainId && (s.active || s.id === includeId)),
      lookups: (category: LookupCategory, includeId?: number | null): Lookup[] =>
        lookups.filter((l) => l.category === category && (l.active || l.id === includeId)),
      lookupDefault: (category: LookupCategory): Lookup | undefined => {
        const list = lookups.filter((l) => l.category === category && l.active);
        return list.find((l) => l.isDefault) ?? list[0];
      },
      isFollowing: (entityType: 'consideration' | 'domain', entityId: string | number) =>
        !!m?.follows.some((f) => f.entityType === entityType && f.entityId === String(entityId)),
    };
  }, [q.data]);
  return { ...q, ...helpers };
}

/**
 * Live updates: when anyone saves, refresh what is on screen.
 * Notifications are handled by the bell (stage 3) via the same stream.
 */
export function useLiveUpdates(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      es = new EventSource('/api/stream');
      es.addEventListener('activity', () => {
        // Coalesce bursts of events into one refresh.
        clearTimeout(timer);
        timer = setTimeout(() => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' }), 300);
      });
      es.addEventListener('notification', () => qc.invalidateQueries({ queryKey: ['notifications'] }));
      es.onerror = () => {
        es?.close();
        retry = setTimeout(connect, 5000);
      };
    };
    connect();
    return () => {
      es?.close();
      clearTimeout(retry);
      clearTimeout(timer);
    };
  }, [enabled, qc]);
}

export const today = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '';

export const daysSince = (iso: string | null | undefined) =>
  iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null;
