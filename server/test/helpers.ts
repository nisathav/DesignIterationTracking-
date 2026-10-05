import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../src/app.js';
import { defaults } from '../src/config.js';
import { openDb, type DB } from '../src/db/db.js';
import type { Services } from '../src/context.js';
import { hashPassword } from '../src/passwords.js';

export const PASSWORD = 'test-password';

let cachedHash: string | null = null;

export interface TestApp {
  app: FastifyInstance;
  svc: Services;
  db: DB;
  /** Signed-in client for a seeded user (Oscar, Nilan, Nisath, Kulunu, Upul, Sajith). */
  as(name: string): Promise<Client>;
  userId(name: string): number;
  domainId(code: string): number;
  subsystemId(code: string, name: string): number;
  lookupId(category: string, label: string): number;
  close(): Promise<void>;
}

export interface Res<T = any> {
  status: number;
  body: T;
}

export interface Client {
  cookie: string;
  get<T = any>(url: string): Promise<Res<T>>;
  post<T = any>(url: string, payload?: unknown): Promise<Res<T>>;
  patch<T = any>(url: string, payload?: unknown): Promise<Res<T>>;
  put<T = any>(url: string, payload?: unknown): Promise<Res<T>>;
  del<T = any>(url: string): Promise<Res<T>>;
}

export function client(app: FastifyInstance, cookie = ''): Client {
  const call = async (method: InjectOptions['method'], url: string, payload?: unknown) => {
    const res = await app.inject({ method, url, payload: payload as InjectOptions['payload'], headers: cookie ? { cookie } : {} });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  };
  return {
    cookie,
    get: (u) => call('GET', u),
    post: (u, p) => call('POST', u, p ?? {}),
    patch: (u, p) => call('PATCH', u, p ?? {}),
    put: (u, p) => call('PUT', u, p ?? {}),
    del: (u) => call('DELETE', u),
  };
}

export async function login(app: FastifyInstance, name: string, password = PASSWORD): Promise<Client> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { name, password } });
  if (res.statusCode !== 200) throw new Error(`login ${name} failed: ${res.body}`);
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie!;
  return client(app, raw.split(';')[0]);
}

/** Fresh in-memory database with the seed data and a known password for every user. */
export async function makeApp(opts: { passwords?: boolean; file?: string } = {}): Promise<TestApp> {
  const db = openDb({ file: opts.file ?? ':memory:' });
  if (opts.passwords !== false) {
    cachedHash ??= await hashPassword(PASSWORD);
    db.prepare('UPDATE users SET password_hash = ?').run(cachedHash);
  }
  const { app, svc } = await buildApp({ config: { ...defaults, dbFile: ':memory:', uploadDir: '/tmp/dit-test-uploads' }, db });
  await app.ready();
  const clients = new Map<string, Client>();
  return {
    app, svc, db,
    async as(name) {
      if (!clients.has(name)) clients.set(name, await login(app, name));
      return clients.get(name)!;
    },
    userId: (name) => db.prepare('SELECT id FROM users WHERE name = ?').pluck().get(name) as number,
    domainId: (code) => db.prepare('SELECT id FROM domains WHERE code = ?').pluck().get(code) as number,
    subsystemId: (code, name) =>
      db.prepare('SELECT s.id FROM subsystems s JOIN domains d ON d.id = s.domain_id WHERE d.code = ? AND s.name = ?').pluck().get(code, name) as number,
    lookupId: (category, label) =>
      db.prepare('SELECT id FROM lookup_values WHERE category = ? AND label = ?').pluck().get(category, label) as number,
    async close() {
      await app.close();
      db.close();
    },
  };
}

/** Body for a new consideration in a domain (first sub-system by default). */
export function newConsideration(t: TestApp, code: string, extra: Record<string, unknown> = {}) {
  const subs: Record<string, string> = { SH: 'Showerhead', CK: 'Cooling Chuck', DC: 'Deposition Chamber', SL: 'EFEM' };
  return {
    domainId: t.domainId(code),
    subsystemId: t.subsystemId(code, subs[code]),
    title: `${code} consideration`,
    targetMetric: 'Temperature uniformity < 2 K',
    ...extra,
  };
}
