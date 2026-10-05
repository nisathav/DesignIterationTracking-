// Child process used by ids.test.ts: opens the same database file as the test
// and creates considerations + iterations as fast as it can.
import { openDb } from '../../src/db/db.js';
import { Bus, write } from '../../src/context.js';
import { defaults } from '../../src/config.js';
import { createConsideration, createIteration } from '../../src/services/records.js';

const [file, countArg, considerationId] = process.argv.slice(2);
const db = openDb({ file, seed: false });
const svc = { db, bus: new Bus(), config: defaults };
const user = { ...(db.prepare("SELECT id, name, email, role FROM users WHERE name = 'Oscar'").get() as any), mustChangePassword: false };
const domainId = db.prepare("SELECT id FROM domains WHERE code = 'SH'").pluck().get() as number;
const subsystemId = db.prepare('SELECT id FROM subsystems WHERE domain_id = ? ORDER BY id LIMIT 1').pluck().get(domainId) as number;

const out: string[] = [];
for (let i = 0; i < Number(countArg); i++) {
  out.push(write(svc, user, (ctx) => createConsideration(ctx, { domainId, subsystemId, title: `p${process.pid}-${i}`, targetMetric: '', notes: '' })));
  out.push(write(svc, user, (ctx) => createIteration(ctx, {
    considerationId, designInput: '', cadDesign: '', analyticalResults: '', simulationResults: '', evidenceLink: '', nextAction: '',
  })));
}
db.close();
process.stdout.write(JSON.stringify(out));
