import type { DB } from './db.js';
import { nowIso } from '../time.js';

// Initial set-up taken from the Setup and Lists tabs of the Excel tracker.
// No considerations, iterations or flags are created: the tracker starts empty.

const users: Array<[name: string, role: 'manager' | 'designer']> = [
  ['Oscar', 'manager'],
  ['Nilan', 'designer'],
  ['Nisath', 'designer'],
  ['Kulunu', 'designer'],
  ['Upul', 'designer'],
  ['Sajith', 'designer'],
];

const domains: Array<{ code: string; name: string; owner: string; colour: string; subsystems: string[] }> = [
  { code: 'SH', name: 'Showerhead', owner: 'Nisath', colour: '#DDEBF7',
    subsystems: ['Showerhead', 'Showerhead Thermal System'] },
  { code: 'CK', name: 'Cooling Chuck + Floating Ring + Seal Ring', owner: 'Nilan', colour: '#E4DFEC',
    subsystems: ['Cooling Chuck', 'Floating Ring', 'Seal Ring'] },
  { code: 'DC', name: 'Total Deposition Chamber', owner: 'Kulunu', colour: '#FCE4D6',
    subsystems: ['Deposition Chamber', 'Chamber Top Flange'] },
  { code: 'SL', name: 'System Layout', owner: 'Upul', colour: '#D0EDEA',
    subsystems: ['Deposition Chamber', 'Vacuum Transfer Module', 'EFEM', 'Pyrolysis Chamber'] },
];

// [category, label, behaviour, colour, isDefault]
const lookups: Array<[string, string, string, string | null, boolean]> = [
  ['verdict', 'Pass', 'pass', '#C6EFCE', false],
  ['verdict', 'Conditional Pass', 'conditional', '#FFEB9C', false],
  ['verdict', 'Fail', 'fail', '#FFC7CE', false],
  ['iteration_status', 'In progress', 'in_progress', null, false],
  ['iteration_status', 'Awaiting review', 'awaiting_review', null, true],
  ['iteration_status', 'Closed', 'closed', null, false],
  ['iteration_status', 'Withdrawn', 'withdrawn', null, false],
  ['flag_type', 'Review', 'review', null, true],
  ['flag_type', 'FYI', 'fyi', null, false],
  ['flag_type', 'Action', 'action', null, false],
  ['flag_status', 'Open', 'open', null, true],
  ['flag_status', 'In progress', 'in_progress', null, false],
  ['flag_status', 'Closed', 'closed', null, false],
  ['consideration_status', 'Open', 'open', null, true],
  ['consideration_status', 'Closed', 'closed', null, false],
  ['consideration_status', 'Withdrawn', 'withdrawn', null, false],
];

export function seed(db: DB): void {
  const at = nowIso();
  const userId = new Map<string, number>();
  const insUser = db.prepare('INSERT INTO users (name, role, created_at) VALUES (?, ?, ?)');
  for (const [name, role] of users) userId.set(name, Number(insUser.run(name, role, at).lastInsertRowid));

  const insDomain = db.prepare(
    'INSERT INTO domains (code, name, owner_id, colour, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const insSub = db.prepare('INSERT INTO subsystems (domain_id, name, sort_order) VALUES (?, ?, ?)');
  const insFollow = db.prepare(
    "INSERT INTO follows (user_id, entity_type, entity_id, created_at) VALUES (?, 'domain', ?, ?)");
  domains.forEach((d, i) => {
    const ownerId = userId.get(d.owner)!;
    const id = Number(insDomain.run(d.code, d.name, ownerId, d.colour, i + 1, at).lastInsertRowid);
    d.subsystems.forEach((s, j) => insSub.run(id, s, j + 1));
    insFollow.run(ownerId, String(id), at);
  });

  const insLookup = db.prepare(
    'INSERT INTO lookup_values (category, label, behaviour, colour, sort_order, is_default) VALUES (?, ?, ?, ?, ?, ?)');
  const order = new Map<string, number>();
  for (const [cat, label, beh, colour, def] of lookups) {
    const n = (order.get(cat) ?? 0) + 1;
    order.set(cat, n);
    insLookup.run(cat, label, beh, colour, n, def ? 1 : 0);
  }
}
