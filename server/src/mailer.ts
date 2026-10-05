import nodemailer from 'nodemailer';
import type { NotificationOut, Services } from './context.js';

/** Link to a record in the web app, e.g. /considerations/SH-C01#SH-C01-I02. */
export function recordPath(id: string | null): string {
  if (!id) return '/';
  if (/-F\d+$/.test(id)) return `/flags/${id}`;
  const m = id.match(/^(.*-C\d+)(-I\d+)?$/);
  return m?.[2] ? `/considerations/${m[1]}#${id}` : `/considerations/${id}`;
}

/**
 * Email every in-app notification to the user, when SMTP is configured in
 * config.json and the user has an email address. Failures are logged and
 * never affect the app.
 */
export function startMailer(svc: Services, log: (msg: string) => void): void {
  const smtp = svc.config.smtp;
  if (!smtp) return;
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure ?? false,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
  const base = svc.config.appUrl.replace(/\/$/, '');
  svc.bus.on('notification', (n: NotificationOut) => {
    const email = svc.db.prepare('SELECT email FROM users WHERE id = ? AND active = 1').pluck().get(n.userId) as string | null;
    if (!email) return;
    const link = `${base}${recordPath(n.entityId)}`;
    transport
      .sendMail({
        from: smtp.from,
        to: email,
        subject: `[Tracker] ${n.title}`,
        text: `${n.title}\n\n${n.body ? `${n.body}\n\n` : ''}Open: ${link}\n`,
      })
      .catch((e: Error) => log(`Email to ${email} failed: ${e.message}`));
  });
  log(`Email notifications enabled via ${smtp.host}:${smtp.port}`);
}
