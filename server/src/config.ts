import fs from 'node:fs';
import path from 'node:path';

export interface SmtpConfig {
  host: string;
  port: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  from: string;
}

export interface Config {
  host: string;
  port: number;
  /** SQLite file. ':memory:' in tests. */
  dbFile: string;
  uploadDir: string;
  backupDir: string;
  /** Base URL used in email links, e.g. http://192.168.1.20:8080 */
  appUrl: string;
  sessionDays: number;
  maxUploadMb: number;
  smtp?: SmtpConfig;
}

export const defaults: Config = {
  host: '0.0.0.0',
  port: 8080,
  dbFile: './data/tracker.db',
  uploadDir: './data/uploads',
  backupDir: './backups',
  appUrl: 'http://localhost:8080',
  sessionDays: 14,
  maxUploadMb: 50,
};

/** Defaults, overridden by ./config.json if present, then by PORT / HOST env vars. */
export function loadConfig(file = path.resolve('config.json')): Config {
  let fromFile: Partial<Config> = {};
  if (fs.existsSync(file)) fromFile = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cfg: Config = { ...defaults, ...fromFile };
  if (process.env.PORT) cfg.port = Number(process.env.PORT);
  if (process.env.HOST) cfg.host = process.env.HOST;
  if (cfg.smtp && !cfg.smtp.host) delete cfg.smtp;
  return cfg;
}
