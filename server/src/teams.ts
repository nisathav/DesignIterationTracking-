import type { DB } from './db/db.js';
import type { Services, TeamsEvent, TeamsPost } from './context.js';
import { recordPath } from './mailer.js';
import { nowIso } from './time.js';

// Posts alerts to one Teams channel through a Teams "Workflows" webhook
// ("Post to a channel when a webhook request is received"). Each card
// @mentions the people concerned by their work email, so Teams notifies
// them personally, and has an "Open in tracker" button.

export const TEAMS_EVENTS: Array<{ key: TeamsEvent; label: string }> = [
  { key: 'flag_assigned', label: 'A flag (review, FYI, action) is assigned or reassigned: mentions the assignee' },
  { key: 'review_outcome', label: 'A review is approved or comes back "Changes needed": mentions the author, owner and raiser' },
  { key: 'flag_closed', label: 'A flag is answered and closed: mentions the person who raised it' },
  { key: 'escalation', label: 'A flag is escalated or the escalation is resolved: mentions the managers / the people involved' },
  { key: 'overdue', label: 'A flag is 3 days overdue: mentions the assignee and the managers' },
  { key: 'iteration_failed', label: 'An iteration is closed with verdict Fail: mentions the managers' },
];

export interface TeamsSettings {
  enabled: boolean;
  webhookUrl: string;
  /** Address colleagues use to open the tracker, for the card button, e.g. http://192.168.1.25:8080 */
  appUrl: string;
  events: Record<TeamsEvent, boolean>;
}

export interface TeamsStatus {
  at: string;
  ok: boolean;
  message: string;
}

const KEY = 'teams';
const STATUS_KEY = 'teams_last_result';

export function defaultTeamsSettings(appUrl: string): TeamsSettings {
  return {
    enabled: false,
    webhookUrl: '',
    appUrl,
    events: Object.fromEntries(TEAMS_EVENTS.map((e) => [e.key, true])) as Record<TeamsEvent, boolean>,
  };
}

export function getTeamsSettings(db: DB, appUrl: string): TeamsSettings {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').pluck().get(KEY) as string | undefined;
  const base = defaultTeamsSettings(appUrl);
  if (!row) return base;
  const saved = JSON.parse(row) as Partial<TeamsSettings>;
  return { ...base, ...saved, events: { ...base.events, ...(saved.events ?? {}) } };
}

export function saveTeamsSettings(db: DB, s: TeamsSettings): void {
  db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .run(KEY, JSON.stringify(s), nowIso());
}

export function getTeamsStatus(db: DB): TeamsStatus | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').pluck().get(STATUS_KEY) as string | undefined;
  return row ? (JSON.parse(row) as TeamsStatus) : null;
}

function setStatus(db: DB, status: TeamsStatus) {
  db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .run(STATUS_KEY, JSON.stringify(status), status.at);
}

/** Sends the JSON body to the webhook. Replaced in tests. */
export type TeamsSender = (url: string, body: unknown) => Promise<void>;

export const fetchSender: TeamsSender = async (url, body) => {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    const code = err.cause?.code ?? (err.name === 'TimeoutError' ? 'no answer within 15 s' : err.message);
    throw new Error(`Could not reach Teams (${code}). Check that this PC has internet access and that the workflow address is complete.`);
  }
  if (!res.ok) {
    throw new Error(res.status === 404 || res.status === 401
      ? `Teams answered ${res.status}: the workflow address is wrong or the workflow was turned off.`
      : `Teams answered ${res.status} ${res.statusText}`);
  }
};

let sender: TeamsSender = fetchSender;
export function setTeamsSender(s: TeamsSender | null): void {
  sender = s ?? fetchSender;
}

interface Person {
  id: number;
  name: string;
  email: string | null;
}

/** Adaptive Card with @mentions, as a Teams Workflows webhook expects it. */
export function buildCard(post: TeamsPost, people: Person[], appUrl: string) {
  const withEmail = people.filter((p) => p.email);
  const mentionText = people.map((p) => (p.email ? `<at>${p.name}</at>` : `**${p.name}**`)).join(', ');
  const text = post.text.includes('{mentions}') ? post.text.replace('{mentions}', mentionText) : `${mentionText ? `${mentionText}: ` : ''}${post.text}`;
  const body: unknown[] = [
    { type: 'TextBlock', text: post.title, weight: 'Bolder', size: 'Medium', wrap: true },
    { type: 'TextBlock', text, wrap: true },
  ];
  if (post.quote) body.push({ type: 'TextBlock', text: post.quote.length > 600 ? `${post.quote.slice(0, 600)}...` : post.quote, wrap: true, isSubtle: true, spacing: 'Small' });
  if (post.facts?.length) body.push({ type: 'FactSet', facts: post.facts.map(([title, value]) => ({ title, value })) });
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body,
          actions: [{ type: 'Action.OpenUrl', title: 'Open in tracker', url: `${appUrl.replace(/\/$/, '')}${recordPath(post.entityId)}` }],
          msteams: {
            width: 'Full',
            entities: withEmail.map((p) => ({ type: 'mention', text: `<at>${p.name}</at>`, mentioned: { id: p.email, name: p.name } })),
          },
        },
      },
    ],
  };
}

function peopleFor(db: DB, ids: number[]): Person[] {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  return db.prepare(`SELECT id, name, email FROM users WHERE active = 1 AND id IN (${unique.map(() => '?').join(',')}) ORDER BY name`)
    .all(...unique) as Person[];
}

/** Post one card now (used by the listener and by "Send test message"). */
export async function postToTeams(db: DB, settings: TeamsSettings, post: TeamsPost): Promise<void> {
  const card = buildCard(post, peopleFor(db, post.mention), settings.appUrl);
  try {
    await sender(settings.webhookUrl, card);
    setStatus(db, { at: nowIso(), ok: true, message: `Posted: ${post.title}` });
  } catch (e) {
    setStatus(db, { at: nowIso(), ok: false, message: (e as Error).message });
    throw e;
  }
}

/**
 * Listen for alerts queued by saves. Sending happens in the background: a
 * slow or unreachable Teams never delays or breaks a save.
 */
export function startTeams(svc: Services, log: (msg: string) => void): void {
  svc.bus.on('teams', (post: TeamsPost) => {
    const settings = getTeamsSettings(svc.db, svc.config.appUrl);
    if (!settings.enabled || !settings.webhookUrl || !settings.events[post.event]) return;
    postToTeams(svc.db, settings, post).catch((e: Error) => log(`Teams alert failed: ${e.message}`));
  });
}
