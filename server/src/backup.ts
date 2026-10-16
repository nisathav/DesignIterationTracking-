import fs from 'node:fs';
import path from 'node:path';
import type { Services } from './context.js';
import { now, nowIso, today } from './time.js';

// Nightly copy of the database (safe while the app runs, via SQLite's backup
// API) into ./backups, plus a mirror of uploaded files. Database copies older
// than KEEP_DAYS are deleted.

export const KEEP_DAYS = 30;

export interface BackupInfo {
  file: string;
  size: number;
  at: string;
}

const NAME = /^tracker-(\d{4}-\d{2}-\d{2})(?:-(\d{4}))?\.db$/;

export function listBackups(svc: Services): BackupInfo[] {
  const dir = path.resolve(svc.config.backupDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => NAME.test(f))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { file: f, size: st.size, at: st.mtime.toISOString() };
    })
    .sort((a, b) => b.file.localeCompare(a.file));
}

export function lastBackupDay(svc: Services): string | null {
  const b = listBackups(svc)[0];
  return b ? b.file.match(NAME)![1] : null;
}

export async function runBackup(svc: Services): Promise<BackupInfo> {
  const dir = path.resolve(svc.config.backupDir);
  fs.mkdirSync(dir, { recursive: true });
  const d = today();
  let file = `tracker-${d}.db`;
  if (fs.existsSync(path.join(dir, file))) {
    const t = now();
    file = `tracker-${d}-${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}.db`;
  }
  const target = path.join(dir, file);
  await svc.db.backup(target);

  // Uploaded files are never changed or deleted, so copying new ones is enough.
  const uploads = path.resolve(svc.config.uploadDir);
  if (fs.existsSync(uploads)) {
    const mirror = path.join(dir, 'uploads');
    fs.mkdirSync(mirror, { recursive: true });
    for (const f of fs.readdirSync(uploads)) {
      const dest = path.join(mirror, f);
      if (!fs.existsSync(dest)) fs.copyFileSync(path.join(uploads, f), dest);
    }
  }

  // Keep KEEP_DAYS days of database copies.
  const cutoff = new Date(now());
  cutoff.setDate(cutoff.getDate() - KEEP_DAYS);
  const cutoffDay = cutoff.toISOString().slice(0, 10);
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(NAME);
    if (m && m[1] < cutoffDay) fs.rmSync(path.join(dir, f), { force: true });
  }
  return { file, size: fs.statSync(target).size, at: nowIso() };
}
