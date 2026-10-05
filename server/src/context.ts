import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { DB } from './db/db.js';
import type { Config } from './config.js';
import { nowIso } from './time.js';

export interface SessionUser {
  id: number;
  name: string;
  email: string | null;
  role: 'manager' | 'designer';
  mustChangePassword: boolean;
}

export interface NotificationOut {
  id: number;
  userId: number;
  kind: string;
  entityType: string | null;
  entityId: string | null;
  title: string;
  body: string;
  isRead: number;
  createdAt: string;
}

export interface ActivityOut {
  entityType: string;
  entityId: string;
  event: string | null;
  considerationId: string | null;
}

/** In-process pub/sub used by the live (SSE) stream and the mailer. */
export class Bus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0);
  }
}

export interface Services {
  db: DB;
  bus: Bus;
  config: Config;
}

export type EntityType = 'consideration' | 'iteration' | 'flag' | 'comment' | 'attachment' | 'domain' | 'subsystem' | 'user' | 'lookup';

export interface AuditEntry {
  action: 'create' | 'update' | 'comment' | 'attach' | 'reopen' | 'link';
  entityType: EntityType;
  entityId: string | number;
  domainId?: number | null;
  considerationId?: string | null;
  field?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  /** Set for changes that appear in the activity feed. */
  event?: string | null;
}

export interface NotifyInput {
  kind: string;
  entityType: 'consideration' | 'iteration' | 'flag' | null;
  entityId: string | null;
  title: string;
  body?: string;
}

const asText = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
};

/** Everything a write needs; collects side effects to publish after commit. */
export class WriteCtx {
  readonly batchId = randomUUID();
  readonly at = nowIso();
  readonly notifications: NotificationOut[] = [];
  readonly activity: ActivityOut[] = [];
  private notified = new Set<string>();

  constructor(
    readonly db: DB,
    readonly user: SessionUser,
  ) {}

  audit(e: AuditEntry): void {
    this.db
      .prepare(
        `INSERT INTO audit_log (batch_id, at, user_id, action, entity_type, entity_id, domain_id,
           consideration_id, field, old_value, new_value, event)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.batchId, this.at, this.user.id, e.action, e.entityType, String(e.entityId), e.domainId ?? null,
        e.considerationId ?? null, e.field ?? null, asText(e.oldValue), asText(e.newValue), e.event ?? null,
      );
    if (e.event || ['consideration', 'iteration', 'flag'].includes(e.entityType) || e.action === 'comment') {
      const key = `${e.entityType}:${e.entityId}:${e.event ?? ''}`;
      if (!this.activity.some((a) => `${a.entityType}:${a.entityId}:${a.event ?? ''}` === key)) {
        this.activity.push({
          entityType: e.entityType, entityId: String(e.entityId), event: e.event ?? null,
          considerationId: e.considerationId ?? null,
        });
      }
    }
  }

  /**
   * Record one audit row per changed field. `fields` maps field name to
   * [old, new] already converted to the text shown in the history.
   */
  auditChanges(
    base: Omit<AuditEntry, 'action' | 'field' | 'oldValue' | 'newValue' | 'event'>,
    fields: Record<string, [unknown, unknown]>,
    events: Record<string, string> = {},
  ): void {
    for (const [field, [o, n]] of Object.entries(fields)) {
      if (asText(o) === asText(n)) continue;
      this.audit({ ...base, action: 'update', field, oldValue: o, newValue: n, event: events[field] ?? null });
    }
  }

  /** Notify users (never the person making the change; once per entity per save). */
  notify(userIds: Iterable<number>, n: NotifyInput): void {
    const ins = this.db.prepare(
      `INSERT INTO notifications (user_id, kind, entity_type, entity_id, title, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const active = this.db.prepare('SELECT active FROM users WHERE id = ?');
    for (const uid of new Set(userIds)) {
      if (uid === this.user.id) continue;
      const key = `${uid}:${n.entityType}:${n.entityId}`;
      if (this.notified.has(key)) continue;
      const u = active.get(uid) as { active: number } | undefined;
      if (!u?.active) continue;
      this.notified.add(key);
      const id = Number(ins.run(uid, n.kind, n.entityType, n.entityId, n.title, n.body ?? '', this.at).lastInsertRowid);
      this.notifications.push({
        id, userId: uid, kind: n.kind, entityType: n.entityType, entityId: n.entityId,
        title: n.title, body: n.body ?? '', isRead: 0, createdAt: this.at,
      });
    }
  }

  follow(userId: number, entityType: 'consideration' | 'domain', entityId: string | number): void {
    this.db
      .prepare('INSERT OR IGNORE INTO follows (user_id, entity_type, entity_id, created_at) VALUES (?, ?, ?, ?)')
      .run(userId, entityType, String(entityId), this.at);
  }

  /** Active managers. */
  managers(): number[] {
    return this.db.prepare("SELECT id FROM users WHERE role = 'manager' AND active = 1").pluck().all() as number[];
  }

  /** Active followers of a consideration and of its domain. */
  followers(considerationId: string, domainId: number): number[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT f.user_id AS id FROM follows f JOIN users u ON u.id = f.user_id AND u.active = 1
         WHERE (f.entity_type = 'consideration' AND f.entity_id = ?)
            OR (f.entity_type = 'domain' AND f.entity_id = ?)`,
      )
      .all(considerationId, String(domainId)) as { id: number }[];
    return rows.map((r) => r.id);
  }
}

/**
 * Run `fn` in a BEGIN IMMEDIATE transaction (one writer at a time, so ID
 * generation is race-free), then publish notifications and activity.
 */
export function write<T>(svc: Services, user: SessionUser, fn: (ctx: WriteCtx) => T): T {
  const ctx = new WriteCtx(svc.db, user);
  const result = svc.db.transaction(() => fn(ctx)).immediate();
  for (const n of ctx.notifications) svc.bus.emit('notification', n);
  if (ctx.activity.length) svc.bus.emit('activity', { by: user.id, items: ctx.activity });
  return result;
}
