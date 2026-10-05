import os from 'node:os';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const { app } = await buildApp({ config, logger: true });

await app.listen({ host: config.host, port: config.port });

const addresses = Object.values(os.networkInterfaces())
  .flat()
  .filter((a) => a && a.family === 'IPv4' && !a.internal)
  .map((a) => `http://${a!.address}:${config.port}`);
app.log.info(`Design Iteration Tracker is running. Colleagues can connect at: ${addresses.join(', ') || `port ${config.port}`}`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    app.close().then(() => process.exit(0));
  });
}
