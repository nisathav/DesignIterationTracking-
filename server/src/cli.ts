// Manage users from the server PC, e.g. if the manager password is lost.
//   npm run user -- list
//   npm run user -- add "Name" [--role manager|designer] [--email a@b.c] [--password xxx]
//   npm run user -- reset "Name" [--password xxx]
//   npm run user -- activate "Name" | deactivate "Name"
import { loadConfig } from './config.js';
import { openDb } from './db/db.js';
import { hashPassword } from './passwords.js';
import { consoleAudit, generatePassword, insertUser, storePassword } from './services/users.js';

const [cmd, name, ...rest] = process.argv.slice(2);
const opt = (flag: string) => {
  const i = rest.indexOf(flag);
  return i >= 0 ? rest[i + 1] : undefined;
};

const usage = `Usage:
  npm run user -- list
  npm run user -- add "Name" [--role manager|designer] [--email someone@company.com] [--password xxxxxxxx]
  npm run user -- reset "Name" [--password xxxxxxxx]
  npm run user -- activate "Name"
  npm run user -- deactivate "Name"
Without --password a temporary password is generated; the person must change it at first sign-in.`;

const config = loadConfig();
const db = openDb({ file: config.dbFile });
const find = (n: string) => db.prepare('SELECT id, name, role, active FROM users WHERE name = ?').get(n) as
  { id: number; name: string; role: string; active: number } | undefined;

async function main(): Promise<number> {
  if (cmd === 'list') {
    const rows = db.prepare('SELECT name, role, email, active, password_hash IS NOT NULL AS pw, must_change_password AS mcp FROM users ORDER BY name').all() as
      Array<{ name: string; role: string; email: string | null; active: number; pw: number; mcp: number }>;
    for (const r of rows) {
      const state = !r.active ? 'inactive' : !r.pw ? 'no password' : r.mcp ? 'must change password' : 'ok';
      console.log(`${r.name.padEnd(16)} ${r.role.padEnd(10)} ${(r.email ?? '').padEnd(30)} ${state}`);
    }
    return 0;
  }
  if (!name || !['add', 'reset', 'activate', 'deactivate'].includes(cmd)) {
    console.log(usage);
    return 1;
  }
  const pw = opt('--password');
  if (pw !== undefined && pw.length < 8) {
    console.error('Password must be at least 8 characters.');
    return 1;
  }
  if (cmd === 'add') {
    const role = (opt('--role') ?? 'designer') as 'manager' | 'designer';
    if (!['manager', 'designer'].includes(role)) {
      console.error('Role must be manager or designer.');
      return 1;
    }
    const password = pw ?? generatePassword();
    const hash = await hashPassword(password);
    const id = db.transaction(() => insertUser(db, { name, email: opt('--email'), role }, hash)).immediate();
    consoleAudit(db, id, null, JSON.stringify({ name, role }));
    console.log(`Created ${name} (${role}). Temporary password: ${password}`);
    return 0;
  }
  const u = find(name);
  if (!u) {
    console.error(`No user called ${name}. Use "npm run user -- list".`);
    return 1;
  }
  if (cmd === 'reset') {
    const password = pw ?? generatePassword();
    const hash = await hashPassword(password);
    db.transaction(() => {
      storePassword(db, u.id, hash, true);
      consoleAudit(db, u.id, 'password', '(reset from console)');
    }).immediate();
    console.log(`New temporary password for ${u.name}: ${password}`);
    return 0;
  }
  const active = cmd === 'activate' ? 1 : 0;
  db.prepare('UPDATE users SET active = ?, version = version + 1 WHERE id = ?').run(active, u.id);
  if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  consoleAudit(db, u.id, 'active', String(active));
  console.log(`${u.name} is now ${active ? 'active' : 'inactive'}.`);
  return 0;
}

main()
  .then((code) => {
    db.close();
    process.exit(code);
  })
  .catch((e) => {
    console.error(e.message ?? e);
    db.close();
    process.exit(1);
  });
