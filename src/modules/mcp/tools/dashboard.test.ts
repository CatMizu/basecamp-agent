import { describe, test, expect } from '@jest/globals';
import {
  computeDashboard,
  dashboardSummary,
  toDashboardError,
  type DashboardInput,
} from './dashboard.js';
import type { MyPlateAssignment } from './basecamp-api.js';
import {
  BasecampApiError,
  BasecampAuthError,
  BasecampNotFoundError,
  BasecampRateLimitError,
} from './basecamp-api.js';
import type {
  BasecampReading,
  BasecampReadingsResponse,
} from '../../../lib/types.js';

// Fixed "now" for deterministic time math.
// Wed Apr 22 2026, 09:42 local time — same wall clock the mockup uses.
const NOW = new Date(2026, 3, 22, 9, 42, 0); // month index 3 = April

function mkAssignment(
  overrides: Partial<MyPlateAssignment> & { id: number },
): MyPlateAssignment {
  return {
    id: overrides.id,
    content: overrides.content ?? `Todo ${overrides.id}`,
    type: overrides.type ?? 'Todo',
    app_url: overrides.app_url ?? `https://3.basecamp.com/x/${overrides.id}`,
    due_on: overrides.due_on ?? null,
    starts_on: overrides.starts_on ?? null,
    completed: overrides.completed ?? false,
    bucket: overrides.bucket ?? { id: 1, name: 'Project A', app_url: '' },
    parent: overrides.parent ?? { id: 1, title: 'List', app_url: '' },
    assignees: overrides.assignees ?? [],
    comments_count: overrides.comments_count ?? 0,
    has_description: overrides.has_description ?? false,
    priority: overrides.priority ?? false,
  };
}

function mkReading(overrides: Partial<BasecampReading> & { id: number }): BasecampReading {
  return {
    id: overrides.id,
    created_at: overrides.created_at ?? NOW.toISOString(),
    updated_at: overrides.updated_at ?? NOW.toISOString(),
    section: overrides.section ?? 'inbox',
    unread_count: overrides.unread_count ?? 1,
    unread_at: overrides.unread_at ?? NOW.toISOString(),
    read_at: overrides.read_at ?? null,
    readable_sgid: overrides.readable_sgid ?? `sgid-${overrides.id}`,
    title: overrides.title ?? `Notification ${overrides.id}`,
    type: overrides.type ?? 'Recording',
    bucket_name: overrides.bucket_name ?? 'Project A',
    creator: overrides.creator ?? { id: 100, name: 'Alice' },
    content_excerpt: overrides.content_excerpt,
    app_url: overrides.app_url ?? `https://3.basecamp.com/x/note/${overrides.id}`,
  };
}

function emptyReadings(): BasecampReadingsResponse {
  return { unreads: [], reads: [], memories: [] };
}

function emptyInput(now = NOW): DashboardInput {
  return {
    overdue: [],
    dueToday: [],
    dueTomorrow: [],
    dueLaterThisWeek: [],
    dueNextWeek: [],
    open: [],
    readings: emptyReadings(),
    now,
  };
}

describe('computeDashboard', () => {
  test('all-empty inputs produce a valid zero-state payload', () => {
    const p = computeDashboard(emptyInput());
    expect(p.kpi.overdue.count).toBe(0);
    expect(p.kpi.overdue.oldestDaysLate).toBeNull();
    expect(p.kpi.dueToday.count).toBe(0);
    expect(p.kpi.dueToday.priorityCount).toBe(0);
    expect(p.kpi.unread.count).toBe(0);
    expect(p.kpi.unread.distinctProjects).toBe(0);
    expect(p.kpi.waiting.count).toBe(0);
    expect(p.kpi.waiting.oldestHoursAgo).toBeNull();
    expect(p.today).toEqual([]);
    expect(p.projects).toEqual([]);
    expect(p.upcoming).toHaveLength(7);
    expect(p.upcoming.every((d) => d.count === 0)).toBe(true);
    expect(p.waitingOnYou).toEqual([]);
    expect(p.unreadBreakdown.oldest).toBeNull();
  });

  test('overdue KPI reports count and max days late, ignoring non-todo types', () => {
    const input = emptyInput();
    input.overdue = [
      mkAssignment({ id: 1, due_on: '2026-04-19' }), // 3 days late
      mkAssignment({ id: 2, due_on: '2026-04-21' }), // 1 day late
      mkAssignment({ id: 3, due_on: '2026-04-20', type: 'CardTable::Card::Step' }), // non-todo ignored
    ];
    const p = computeDashboard(input);
    expect(p.kpi.overdue.count).toBe(2);
    expect(p.kpi.overdue.oldestDaysLate).toBe(3);
  });

  test('dueToday priorityCount intersects with open priorities', () => {
    const input = emptyInput();
    input.dueToday = [
      mkAssignment({ id: 10, due_on: '2026-04-22' }),
      mkAssignment({ id: 11, due_on: '2026-04-22' }),
    ];
    input.open = [
      mkAssignment({ id: 10, due_on: '2026-04-22', priority: true }),
      mkAssignment({ id: 11, due_on: '2026-04-22', priority: false }),
      mkAssignment({ id: 99, priority: true }),
    ];
    const p = computeDashboard(input);
    expect(p.kpi.dueToday.count).toBe(2);
    expect(p.kpi.dueToday.priorityCount).toBe(1);
    expect(p.today.find((t) => t.id === 10)?.priority).toBe(true);
    expect(p.today.find((t) => t.id === 11)?.priority).toBe(false);
  });

  test('unread KPI distinctProjects counts unique bucket_names', () => {
    const input = emptyInput();
    input.readings = {
      unreads: [
        mkReading({ id: 1, bucket_name: 'A' }),
        mkReading({ id: 2, bucket_name: 'A' }),
        mkReading({ id: 3, bucket_name: 'B' }),
      ],
      reads: [],
      memories: [],
    };
    const p = computeDashboard(input);
    expect(p.kpi.unread.count).toBe(3);
    expect(p.kpi.unread.distinctProjects).toBe(2);
  });

  test('unreadBreakdown maps section inbox → messages and reports the oldest', () => {
    const input = emptyInput();
    const h8ago = new Date(NOW.getTime() - 8 * 3600_000).toISOString();
    const h1ago = new Date(NOW.getTime() - 1 * 3600_000).toISOString();
    input.readings = {
      unreads: [
        mkReading({ id: 1, section: 'mentions', unread_at: h8ago, creator: { id: 1, name: 'Katia' }, title: '@you confirm X', bucket_name: 'EHF' }),
        mkReading({ id: 2, section: 'pings', unread_at: h1ago }),
        mkReading({ id: 3, section: 'pings' }),
        mkReading({ id: 4, section: 'chats' }),
        mkReading({ id: 5, section: 'chats' }),
        mkReading({ id: 6, section: 'chats' }),
        mkReading({ id: 7, section: 'inbox' }),
        mkReading({ id: 8, section: 'inbox' }),
      ],
      reads: [],
      memories: [],
    };
    const p = computeDashboard(input);
    expect(p.unreadBreakdown.mentions).toBe(1);
    expect(p.unreadBreakdown.pings).toBe(2);
    expect(p.unreadBreakdown.chats).toBe(3);
    expect(p.unreadBreakdown.messages).toBe(2);
    expect(p.unreadBreakdown.oldest).toMatchObject({
      title: '@you confirm X',
      creator: 'Katia',
      project: 'EHF',
      section: 'mentions',
    });
    expect(p.unreadBreakdown.oldest!.hoursAgo).toBeCloseTo(8, 1);
  });

  test('today items carry project name and app_url through; non-todo types filtered', () => {
    const input = emptyInput();
    input.dueToday = [
      mkAssignment({
        id: 42,
        content: 'Send contract',
        app_url: 'https://3.basecamp.com/x/42',
        bucket: { id: 7, name: 'Client EHF', app_url: '' },
        due_on: '2026-04-22',
      }),
      mkAssignment({ id: 43, type: 'CardTable::Card::Step', due_on: '2026-04-22' }),
    ];
    const p = computeDashboard(input);
    expect(p.today).toHaveLength(1);
    expect(p.today[0].content).toBe('Send contract');
    expect(p.today[0].projectName).toBe('Client EHF');
    expect(p.today[0].appUrl).toBe('https://3.basecamp.com/x/42');
  });

  test('projects sorted desc by openCount; urgentCount = overdue ∪ dueToday in bucket', () => {
    const input = emptyInput();
    input.open = [
      mkAssignment({ id: 1, bucket: { id: 10, name: 'EHF', app_url: '' } }),
      mkAssignment({ id: 2, bucket: { id: 10, name: 'EHF', app_url: '' } }),
      mkAssignment({ id: 3, bucket: { id: 10, name: 'EHF', app_url: '' } }),
      mkAssignment({ id: 4, bucket: { id: 20, name: 'Pocknells', app_url: '' } }),
    ];
    input.overdue = [
      mkAssignment({ id: 1, due_on: '2026-04-18', bucket: { id: 10, name: 'EHF', app_url: '' } }),
    ];
    input.dueToday = [
      mkAssignment({ id: 2, due_on: '2026-04-22', bucket: { id: 10, name: 'EHF', app_url: '' } }),
    ];
    const p = computeDashboard(input);
    expect(p.projects).toEqual([
      { id: 10, name: 'EHF', openCount: 3, urgentCount: 2 },
      { id: 20, name: 'Pocknells', openCount: 1, urgentCount: 0 },
    ]);
  });

  test('upcoming returns exactly 7 cells starting today with the correct labels and counts', () => {
    const input = emptyInput();
    input.dueToday = [mkAssignment({ id: 1, due_on: '2026-04-22' })];
    input.dueTomorrow = [mkAssignment({ id: 2, due_on: '2026-04-23' })];
    input.dueLaterThisWeek = [
      mkAssignment({ id: 3, due_on: '2026-04-24' }),
      mkAssignment({ id: 4, due_on: '2026-04-24' }),
    ];
    input.dueNextWeek = [
      mkAssignment({ id: 5, due_on: '2026-04-27' }), // Mon
      mkAssignment({ id: 6, due_on: '2026-04-28' }), // Tue
      mkAssignment({ id: 7, due_on: '2026-05-10' }), // out of 7-day window — dropped
    ];

    const p = computeDashboard(input);
    expect(p.upcoming).toHaveLength(7);
    expect(p.upcoming[0]).toMatchObject({ date: '2026-04-22', label: 'today', count: 1 });
    expect(p.upcoming[1]).toMatchObject({ date: '2026-04-23', label: 'thu', count: 1 });
    expect(p.upcoming[2]).toMatchObject({ date: '2026-04-24', label: 'fri', count: 2 });
    expect(p.upcoming[3]).toMatchObject({ date: '2026-04-25', label: 'sat', count: 0 });
    expect(p.upcoming[4]).toMatchObject({ date: '2026-04-26', label: 'sun', count: 0 });
    expect(p.upcoming[5]).toMatchObject({ date: '2026-04-27', label: 'mon', count: 1 });
    expect(p.upcoming[6]).toMatchObject({ date: '2026-04-28', label: 'tue', count: 1 });
  });

  test('upcoming priorityCount mirrors the open priorities set', () => {
    const input = emptyInput();
    input.dueTomorrow = [mkAssignment({ id: 2, due_on: '2026-04-23' })];
    input.open = [
      mkAssignment({ id: 2, priority: true, due_on: '2026-04-23' }),
    ];
    const p = computeDashboard(input);
    expect(p.upcoming[1].priorityCount).toBe(1);
  });

  test('waitingOnYou sorts oldest-first, top 5, only mentions/pings', () => {
    const input = emptyInput();
    const h = (n: number) => new Date(NOW.getTime() - n * 3600_000).toISOString();
    input.readings = {
      unreads: [
        mkReading({ id: 1, section: 'mentions', unread_at: h(8), creator: { id: 1, name: 'Katia' } }),
        mkReading({ id: 2, section: 'pings', unread_at: h(3), creator: { id: 2, name: 'Sophie' } }),
        mkReading({ id: 3, section: 'pings', unread_at: h(0.2), creator: { id: 3, name: 'Stephanie' } }),
        mkReading({ id: 4, section: 'inbox', unread_at: h(10), creator: { id: 4, name: 'Bob' } }), // filtered out
        mkReading({ id: 5, section: 'chats', unread_at: h(9), creator: { id: 5, name: 'Carol' } }), // filtered out
        mkReading({ id: 6, section: 'mentions', unread_at: h(1), creator: { id: 6, name: 'Dan' } }),
        mkReading({ id: 7, section: 'pings', unread_at: h(5), creator: { id: 7, name: 'Eve' } }),
        mkReading({ id: 8, section: 'pings', unread_at: h(6), creator: { id: 8, name: 'Fran' } }),
      ],
      reads: [],
      memories: [],
    };
    const p = computeDashboard(input);
    expect(p.waitingOnYou).toHaveLength(5);
    expect(p.waitingOnYou.map((w) => w.who)).toEqual([
      'Katia', // 8h
      'Fran',  // 6h
      'Eve',   // 5h
      'Sophie',// 3h
      'Dan',   // 1h
    ]);
    expect(p.waitingOnYou.every((w) => w.section === 'mentions' || w.section === 'pings')).toBe(true);
  });

  test('waiting severity buckets: >4h red, >30min orange, else amber', () => {
    const input = emptyInput();
    const h = (n: number) => new Date(NOW.getTime() - n * 3600_000).toISOString();
    input.readings = {
      unreads: [
        mkReading({ id: 1, section: 'mentions', unread_at: h(5) }),
        mkReading({ id: 2, section: 'pings', unread_at: h(2) }),
        mkReading({ id: 3, section: 'pings', unread_at: h(0.2) }), // 12 min
      ],
      reads: [],
      memories: [],
    };
    const p = computeDashboard(input);
    expect(p.waitingOnYou.find((w) => w.who === 'Alice' && w.hoursAgo > 4)?.severity).toBe('red');
    expect(p.waitingOnYou[1].severity).toBe('orange');
    expect(p.waitingOnYou[2].severity).toBe('amber');
  });

  test('waiting KPI count matches waitingOnYou source and oldestHoursAgo is max', () => {
    const input = emptyInput();
    const h = (n: number) => new Date(NOW.getTime() - n * 3600_000).toISOString();
    input.readings = {
      unreads: [
        mkReading({ id: 1, section: 'mentions', unread_at: h(8) }),
        mkReading({ id: 2, section: 'pings', unread_at: h(3) }),
        mkReading({ id: 3, section: 'inbox', unread_at: h(10) }), // excluded
      ],
      reads: [],
      memories: [],
    };
    const p = computeDashboard(input);
    expect(p.kpi.waiting.count).toBe(2);
    expect(p.kpi.waiting.oldestHoursAgo).toBeCloseTo(8, 1);
  });

  test('generatedAt reflects the injected now', () => {
    const p = computeDashboard(emptyInput(NOW));
    expect(p.generatedAt).toBe(NOW.toISOString());
  });
});

describe('toDashboardError', () => {
  test('rate-limit error carries retryAfterSec', () => {
    const e = toDashboardError(new BasecampRateLimitError(30));
    expect(e.error.message).toMatch(/rate limit/i);
    expect(e.error.retryAfterSec).toBe(30);
  });

  test('auth error instructs reconnect', () => {
    const e = toDashboardError(new BasecampAuthError('token rejected'));
    expect(e.error.message).toMatch(/reconnect/i);
  });

  test('api error includes status', () => {
    const e = toDashboardError(new BasecampApiError(500, 'boom'));
    expect(e.error.message).toMatch(/500/);
  });

  test('not-found error', () => {
    const e = toDashboardError(new BasecampNotFoundError());
    expect(e.error.message).toMatch(/not found/i);
  });

  test('generic error message passes through', () => {
    const e = toDashboardError(new Error('network timeout'));
    expect(e.error.message).toBe('network timeout');
  });
});

describe('dashboardSummary', () => {
  test('one-line KPI-centric text', () => {
    const p = computeDashboard(emptyInput());
    expect(dashboardSummary(p)).toMatch(/0 overdue.*0 due today.*0 unread.*0 waiting/);
  });
});
