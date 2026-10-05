import os from 'node:os';
import path from 'node:path';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { issueInitialPasswords, writePasswordSheet } from './services/users.js';
import { startMailer } from './mailer.js';
import { startScheduler } from './scheduler.js';

const config = loadConfig();
const { app, svc } = await buildApp({ config, logger: true });

// First start: every seeded user gets a temporary password, shown once here
// and saved next to the database. Each person changes it at first sign-in.
const issued = await issueInitialPasswords(svc.db);
if (issued.length) {
  const file = writePasswordSheet(path.dirname(path.resolve(config.dbFile)), issued, 'Temporary passwords');
  console.log('\nTemporary passwords (each person must change theirs at first sign-in):');
  for (const u of issued) console.log(`  ${u.name.padEnd(16)} ${u.password}`);
  console.log(`Saved to ${file}. Delete that file once everyone has signed in.\n`);
}

await app.listen({ host: config.host, port: config.port });
startMailer(svc, (m) => app.log.info(m));
const stopScheduler = startScheduler(svc, (m) => app.log.info(m));

const addresses = Object.values(os.networkInterfaces())
  .flat()
  .filter((a) => a && a.family === 'IPv4' && !a.internal)
  .map((a) => `http://${a!.address}:${config.port}`);
app.log.info(`Design Iteration Tracker is running. Colleagues can connect at: ${addresses.join(', ') || `port ${config.port}`}`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    stopScheduler();
    app.close().then(() => process.exit(0));
  });
}
