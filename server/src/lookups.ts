import type { DB } from './db/db.js';
import { badRequest } from './errors.js';

export type LookupCategory = 'verdict' | 'iteration_status' | 'flag_status' | 'flag_type' | 'consideration_status';

/** The fixed meanings rules can depend on. Labels are free to change. */
export const behaviours: Record<LookupCategory, string[]> = {
  verdict: ['pass', 'conditional', 'fail'],
  iteration_status: ['in_progress', 'awaiting_review', 'closed', 'withdrawn'],
  flag_status: ['open', 'in_progress', 'closed'],
  flag_type: ['review', 'fyi', 'action'],
  consideration_status: ['open', 'closed', 'withdrawn'],
};

export interface Lookup {
  id: number;
  category: LookupCategory;
  label: string;
  behaviour: string;
  colour: string | null;
  sortOrder: number;
  isDefault: number;
  active: number;
  version: number;
}

const SELECT = `SELECT id, category, label, behaviour, colour, sort_order AS sortOrder,
  is_default AS isDefault, active, version FROM lookup_values`;

export function getLookup(db: DB, id: number): Lookup | undefined {
  return db.prepare(`${SELECT} WHERE id = ?`).get(id) as Lookup | undefined;
}

export function listLookups(db: DB): Lookup[] {
  return db.prepare(`${SELECT} ORDER BY category, sort_order, id`).all() as Lookup[];
}

/**
 * Validate a lookup id supplied by a client. Inactive values are refused
 * unless the record already holds that value.
 */
export function checkLookup(db: DB, category: LookupCategory, id: number, current?: number | null): Lookup {
  const l = getLookup(db, id);
  if (!l || l.category !== category) throw badRequest(`Unknown ${category.replace('_', ' ')} value`);
  if (!l.active && l.id !== current) throw badRequest(`'${l.label}' is no longer in use`);
  return l;
}

export function defaultLookup(db: DB, category: LookupCategory): Lookup {
  const l = db
    .prepare(`${SELECT} WHERE category = ? ORDER BY active DESC, is_default DESC, sort_order, id LIMIT 1`)
    .get(category) as Lookup | undefined;
  if (!l) throw new Error(`No ${category} values configured`);
  return l;
}

export function lookupByBehaviour(db: DB, category: LookupCategory, behaviour: string): Lookup {
  const l = db
    .prepare(`${SELECT} WHERE category = ? AND behaviour = ? ORDER BY active DESC, is_default DESC, sort_order, id LIMIT 1`)
    .get(category, behaviour) as Lookup | undefined;
  if (!l) throw new Error(`No ${category} value with behaviour ${behaviour}`);
  return l;
}
