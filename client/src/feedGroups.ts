import type { FeedItem } from './types';

// Turns the raw activity feed (one row per audited change) into what the
// home page shows: days, then one topic per consideration, each holding a
// short list of merged actions ("approved and closed SH-C01-I02-F1").

export type Tone = 'ok' | 'bad' | 'warn' | 'esc' | 'closed' | 'log' | 'new' | 'note';

export interface Action {
  key: string;
  at: string;
  userName: string;
  /** Verbs in the order they happened, e.g. ['approved', 'closed']. */
  verbs: string[];
  /** Records the verbs apply to, e.g. ['SH-C01', 'SH-C01-I01']. */
  ids: string[];
  /** Words after the ids, e.g. "for Nisath". */
  suffix?: string;
  tone: Tone;
  quote?: string;
  verdict?: { label: string; behaviour: string | null } | null;
  statusLabel?: string;
  isNew: boolean;
}

export interface Topic {
  key: string;
  considerationId: string;
  title: string;
  domainCode: string | null;
  domainColour: string | null;
  actions: Action[]; // newest first
  latestAt: string;
  people: string[];
  newCount: number;
}

export interface Day {
  key: string;
  label: string;
  topics: Topic[];
}

const MERGE_WINDOW_MS = 10 * 60_000;

/** One feed row in plain words, before merging. */
function toAction(i: FeedItem, lastVisit: string | null): Action | null {
  const base = { key: String(i.id), at: i.at, userName: i.userName ?? 'Tracker', ids: [i.entityId], isNew: !!lastVisit && i.at > lastVisit };
  const to = i.to ?? '';
  const from = i.from ?? '';
  switch (i.event) {
    case 'consideration_created':
      return {
        ...base, verbs: ['created'], tone: 'new',
        suffix: [i.originFlagId ? `from flag ${i.originFlagId}` : '', i.ownerName ? `(owner ${i.ownerName})` : ''].filter(Boolean).join(' ') || undefined,
      };
    case 'consideration_status':
    case 'iteration_status':
    case 'flag_status': {
      if (to === 'Closed') return { ...base, verbs: ['closed'], tone: 'closed' };
      if (from === 'Closed') return { ...base, verbs: ['reopened'], tone: 'warn' };
      if (to === 'Withdrawn') return { ...base, verbs: ['withdrew'], tone: 'closed' };
      if (to === 'In progress') return { ...base, verbs: ['started'], tone: 'log' };
      return { ...base, verbs: [`set to ${to}`], tone: 'log' };
    }
    case 'iteration_logged':
      return {
        ...base, verbs: ['logged'], tone: i.verdictBehaviour === 'fail' ? 'bad' : 'log',
        verdict: i.verdictLabel ? { label: i.verdictLabel, behaviour: i.verdictBehaviour ?? null } : null,
        statusLabel: i.statusLabel?.toLowerCase(), suffix: i.authorName && i.authorName !== i.userName ? `for ${i.authorName}` : undefined,
      };
    case 'iteration_verdict':
      return { ...base, verbs: [`set verdict ${to || 'none'} on`], tone: to === 'Fail' ? 'bad' : to === 'Pass' ? 'ok' : 'warn' };
    case 'flag_raised': {
      const type = (i.typeLabel ?? '').toLowerCase();
      const verb = type === 'review' ? `asked ${i.assignedToName} to review` : type === 'fyi' ? `sent ${i.assignedToName} an FYI` : `gave ${i.assignedToName} an action`;
      return { ...base, verbs: [verb], tone: 'warn', quote: i.text, suffix: i.dueDate ? `(due ${shortDate(i.dueDate)})` : undefined };
    }
    case 'flag_answered':
      return { ...base, verbs: ['answered'], tone: 'note', quote: to };
    case 'flag_review':
      if (to === 'Changes needed') return { ...base, verbs: ['requested changes on'], tone: 'bad' };
      if (to === 'Approved with comments') return { ...base, verbs: ['approved with comments'], tone: 'ok' };
      if (to === 'Approved') return { ...base, verbs: ['approved'], tone: 'ok' };
      return { ...base, verbs: ['cleared the review outcome of'], tone: 'warn' };
    case 'flag_assigned':
      return { ...base, verbs: ['reassigned'], suffix: `to ${to}`, tone: 'warn' };
    case 'flag_escalated':
      return { ...base, verbs: ['escalated'], suffix: 'to the managers', tone: 'esc', quote: to };
    case 'flag_escalation_resolved':
      return { ...base, verbs: ['resolved the escalation on'], tone: 'esc', quote: to };
    case 'comment_added':
      return { ...base, verbs: ['commented on'], tone: 'note', quote: i.text };
    default:
      return null;
  }
}

const TONE_RANK: Tone[] = ['bad', 'esc', 'ok', 'warn', 'new', 'log', 'closed', 'note'];
const strongest = (a: Tone, b: Tone) => (TONE_RANK.indexOf(a) <= TONE_RANK.indexOf(b) ? a : b);

/**
 * Merge oldest-to-newest actions of one person that happen within a few
 * minutes: several verbs on the same record ("approved and closed F1"), or
 * the same verb on several records ("closed SH-C01, I01 and I02").
 */
function merge(actions: Action[]): Action[] {
  const out: Action[] = [];
  for (const a of actions) {
    const prev = out[out.length - 1];
    const close = prev && prev.userName === a.userName && Math.abs(Date.parse(a.at) - Date.parse(prev.at)) <= MERGE_WINDOW_MS;
    const sameRecord = close && prev.ids.length === 1 && a.ids[0] === prev.ids[0] && !a.quote && !prev.verbs.some((v) => v.startsWith('asked') || v.startsWith('sent') || v.startsWith('gave'));
    const sameVerb = close && a.verbs.length === 1 && prev.verbs.length === 1 && a.verbs[0] === prev.verbs[0] && !a.quote && !prev.quote;
    if (sameRecord) {
      for (const v of a.verbs) if (!prev.verbs.includes(v)) prev.verbs.push(v);
      prev.at = a.at;
      prev.tone = strongest(prev.tone, a.tone);
      prev.isNew ||= a.isNew;
      prev.suffix ??= a.suffix;
    } else if (sameVerb) {
      for (const id of a.ids) if (!prev.ids.includes(id)) prev.ids.push(id);
      prev.at = a.at;
      prev.isNew ||= a.isNew;
    } else {
      out.push({ ...a, verbs: [...a.verbs], ids: [...a.ids] });
    }
  }
  // "started" is the automatic Open -> In progress when someone answers; it adds nothing next to another verb.
  for (const a of out) if (a.verbs.length > 1) a.verbs = a.verbs.filter((v) => v !== 'started');
  return out;
}

function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso: string, now = new Date()) {
  const d = new Date(iso);
  const fmt = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(iso) === dayKey(now.toISOString())) return `Today · ${fmt}`;
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return `Yesterday · ${fmt}`;
  return d.getFullYear() === now.getFullYear() ? fmt : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function shortDate(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Feed rows (newest first) -> days -> topics -> merged actions. */
export function groupFeed(items: FeedItem[], lastVisit: string | null): Day[] {
  const days: Day[] = [];
  const byDay = new Map<string, Map<string, { topic: Topic; raw: Action[] }>>();
  for (const item of items) {
    const action = toAction(item, lastVisit);
    if (!action) continue;
    const dk = dayKey(item.at);
    let topics = byDay.get(dk);
    if (!topics) {
      topics = new Map();
      byDay.set(dk, topics);
      days.push({ key: dk, label: dayLabel(item.at), topics: [] });
    }
    const cid = item.considerationId ?? item.entityId;
    let entry = topics.get(cid);
    if (!entry) {
      entry = {
        topic: {
          key: `${dk}:${cid}`, considerationId: cid, title: item.considerationTitle ?? '', domainCode: item.domainCode, domainColour: item.domainColour,
          actions: [], latestAt: item.at, people: [], newCount: 0,
        },
        raw: [],
      };
      topics.set(cid, entry);
      days[days.length - 1].topics.push(entry.topic);
    }
    entry.raw.push(action);
    if (!entry.topic.people.includes(action.userName)) entry.topic.people.push(action.userName);
  }
  for (const topics of byDay.values()) {
    for (const { topic, raw } of topics.values()) {
      topic.actions = merge([...raw].reverse()).reverse();
      topic.newCount = topic.actions.filter((a) => a.isNew).length;
    }
  }
  return days;
}

/** Record id shortened inside its consideration: SH-C01-I02-F1 -> I02-F1. */
export function shortId(id: string, considerationId: string): string {
  return id.startsWith(`${considerationId}-`) ? id.slice(considerationId.length + 1) : id;
}
