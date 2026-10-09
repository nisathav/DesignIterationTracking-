import { describe, expect, it } from 'vitest';
import { groupFeed, shortId } from './feedGroups';
import type { FeedItem } from './types';

const base = { domainId: 1, domainCode: 'SH', domainColour: '#DDEBF7', considerationId: 'SH-C01', considerationTitle: 'Showerhead temperature uniformity' };
let n = 0;
const ev = (at: string, user: string, event: string, entityType: FeedItem['entityType'], entityId: string, extra: Partial<FeedItem> = {}): FeedItem => ({
  id: ++n, at, event, userId: 1, userName: user, entityType, entityId, ...base, ...extra,
});

// The events from the screenshot, newest first as the API returns them.
const items: FeedItem[] = [
  ev('2026-10-09T08:50:02Z', 'Nisath', 'flag_status', 'flag', 'SH-C01-I02-F1', { from: 'Open', to: 'Closed' }),
  ev('2026-10-09T08:50:01Z', 'Nisath', 'flag_review', 'flag', 'SH-C01-I02-F1', { from: null, to: 'Approved' }),
  ev('2026-10-06T10:40:03Z', 'Oscar', 'iteration_status', 'iteration', 'SH-C01-I02', { from: 'Awaiting review', to: 'Closed' }),
  ev('2026-10-06T10:39:30Z', 'Oscar', 'iteration_status', 'iteration', 'SH-C01-I01', { from: 'In progress', to: 'Closed' }),
  ev('2026-10-06T10:39:00Z', 'Oscar', 'consideration_status', 'consideration', 'SH-C01', { from: 'Open', to: 'Closed' }),
  ev('2026-10-06T09:05:00Z', 'Nisath', 'comment_added', 'flag', 'SH-C01-I02-F1', { text: 'everything seems ok. i will keep this integrated to the design' }),
  ev('2026-10-06T08:20:00Z', 'Oscar', 'flag_raised', 'flag', 'SH-C01-I02-F1', { typeLabel: 'Review', assignedToName: 'Nisath', text: 'reached the optimization for the thickness and RTD sensor placement' }),
  ev('2026-10-06T08:18:00Z', 'Oscar', 'iteration_logged', 'iteration', 'SH-C01-I02', { verdictLabel: 'Pass', verdictBehaviour: 'pass', statusLabel: 'Awaiting review', authorName: 'Oscar' }),
];

describe('activity feed grouping', () => {
  const days = groupFeed(items, '2026-10-08T00:00:00Z');

  it('groups by day, then by consideration', () => {
    expect(days).toHaveLength(2);
    expect(days.map((d) => d.topics.map((t) => t.considerationId))).toEqual([['SH-C01'], ['SH-C01']]);
  });

  it('merges several verbs on one record and one verb on several records', () => {
    const [today, earlier] = days;
    expect(today.topics[0].actions.map((a) => [a.userName, a.verbs, a.ids])).toEqual([
      ['Nisath', ['approved', 'closed'], ['SH-C01-I02-F1']],
    ]);
    expect(earlier.topics[0].actions.map((a) => [a.userName, a.verbs.join(' + '), a.ids.join(' ')])).toEqual([
      ['Oscar', 'closed', 'SH-C01 SH-C01-I01 SH-C01-I02'],
      ['Nisath', 'commented on', 'SH-C01-I02-F1'],
      ['Oscar', 'asked Nisath to review', 'SH-C01-I02-F1'],
      ['Oscar', 'logged', 'SH-C01-I02'],
    ]);
  });

  it('marks what is new since the last visit', () => {
    expect(days[0].topics[0].newCount).toBe(1); // one merged line: approved and closed
    expect(days[0].topics[0].actions[0]).toMatchObject({ isNew: true, tone: 'ok' });
    expect(days[1].topics[0].newCount).toBe(0);
  });

  it('drops the automatic "started" next to an answer', () => {
    const d = groupFeed([
      ev('2026-10-09T10:00:01Z', 'Nilan', 'flag_status', 'flag', 'SH-C01-I02-F2', { from: 'Open', to: 'In progress' }),
      ev('2026-10-09T10:00:00Z', 'Nilan', 'flag_answered', 'flag', 'SH-C01-I02-F2', { to: 'Gap is fine' }),
    ], null);
    expect(d[0].topics[0].actions[0]).toMatchObject({ verbs: ['answered'], quote: 'Gap is fine' });
  });

  it('shortens ids inside their consideration', () => {
    expect(shortId('SH-C01-I02-F1', 'SH-C01')).toBe('I02-F1');
    expect(shortId('SH-C01', 'SH-C01')).toBe('SH-C01');
  });
});
