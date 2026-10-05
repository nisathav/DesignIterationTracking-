import type { DB } from './db/db.js';

// Record IDs are built from running numbers kept in the counters table.
// nextSeq must run inside a write transaction (BEGIN IMMEDIATE), so two users
// saving at the same time are serialised by SQLite and can never get the same
// number. Counters only go up, so an ID is never reused, even when a record is
// withdrawn.

export const scopes = {
  consideration: (domainId: number) => `C:${domainId}`,
  iteration: (considerationId: string) => `I:${considerationId}`,
  flag: (iterationId: string) => `F:${iterationId}`,
};

export function nextSeq(db: DB, scope: string): number {
  if (!db.inTransaction) throw new Error('nextSeq must be called inside a transaction');
  const row = db
    .prepare(
      `INSERT INTO counters (scope, value) VALUES (?, 1)
       ON CONFLICT(scope) DO UPDATE SET value = value + 1
       RETURNING value`,
    )
    .get(scope) as { value: number };
  return row.value;
}

/** The number the next record in this scope will get (for "will be ..." previews). */
export function peekSeq(db: DB, scope: string): number {
  const row = db.prepare('SELECT value FROM counters WHERE scope = ?').get(scope) as { value: number } | undefined;
  return (row?.value ?? 0) + 1;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export const formatId = {
  consideration: (domainCode: string, seq: number) => `${domainCode}-C${pad2(seq)}`,
  iteration: (considerationId: string, seq: number) => `${considerationId}-I${pad2(seq)}`,
  flag: (iterationId: string, seq: number) => `${iterationId}-F${seq}`,
};
