/** @jest-environment jsdom */
import { describe, test, expect } from '@jest/globals';
import { render } from './render.js';
import type {
  DashboardPayload,
  DashboardErrorPayload,
  DashboardUpcomingDay,
} from '../../../../../lib/types.js';

function emptyUpcoming(): DashboardUpcomingDay[] {
  const labels = ['today', 'thu', 'fri', 'sat', 'sun', 'mon', 'tue'];
  return labels.map((label, i) => ({
    date: `2026-04-${22 + i}`,
    label,
    count: 0,
    priorityCount: 0,
  }));
}

function makePayload(overrides: Partial<DashboardPayload> = {}): DashboardPayload {
  return {
    generatedAt: '2026-04-22T09:42:00.000Z',
    kpi: {
      overdue: { count: 0, oldestDaysLate: null },
      dueToday: { count: 0, priorityCount: 0 },
      unread: { count: 0, distinctProjects: 0 },
      waiting: { count: 0, oldestHoursAgo: null },
    },
    today: [],
    unreadBreakdown: {
      mentions: 0,
      pings: 0,
      chats: 0,
      messages: 0,
      oldest: null,
    },
    projects: [],
    upcoming: emptyUpcoming(),
    waitingOnYou: [],
    ...overrides,
  };
}

describe('render', () => {
  test('renders four KPI cards with their values and labels', () => {
    const root = document.createElement('div');
    render(
      root,
      makePayload({
        kpi: {
          overdue: { count: 3, oldestDaysLate: 3 },
          dueToday: { count: 2, priorityCount: 2 },
          unread: { count: 8, distinctProjects: 4 },
          waiting: { count: 3, oldestHoursAgo: 8 },
        },
      }),
    );
    const cards = root.querySelectorAll('[data-section="kpi"]');
    expect(cards).toHaveLength(4);
    const values = Array.from(cards).map(
      (c) => c.querySelector('.kpi-value')!.textContent,
    );
    expect(values).toEqual(['3', '2', '8', '3']);
    expect(root.textContent).toMatch(/Overdue/);
    expect(root.textContent).toMatch(/Due today/);
    expect(root.textContent).toMatch(/Unread/);
    expect(root.textContent).toMatch(/waiting/i);
  });

  test('KPI context strings reflect oldest / priority / distinctProjects', () => {
    const root = document.createElement('div');
    render(
      root,
      makePayload({
        kpi: {
          overdue: { count: 2, oldestDaysLate: 5 },
          dueToday: { count: 1, priorityCount: 1 },
          unread: { count: 4, distinctProjects: 2 },
          waiting: { count: 2, oldestHoursAgo: 3 },
        },
      }),
    );
    expect(root.textContent).toMatch(/5 days/);
    expect(root.textContent).toMatch(/priority/i);
    expect(root.textContent).toMatch(/2 projects/);
    expect(root.textContent).toMatch(/3h/);
  });

  test('today list shows one row per item; priority rows get a star', () => {
    const root = document.createElement('div');
    render(
      root,
      makePayload({
        today: [
          {
            id: 1,
            content: 'Prep Loom',
            appUrl: 'https://3.basecamp.com/x/1',
            priority: true,
            projectName: 'MVL',
            dueLabel: '2026-04-22',
          },
          {
            id: 2,
            content: 'Send draft',
            appUrl: 'https://3.basecamp.com/x/2',
            priority: false,
            projectName: 'EHF',
            dueLabel: '2026-04-22',
          },
        ],
      }),
    );
    const rows = root.querySelectorAll('[data-section="today"] .t-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].classList.contains('priority')).toBe(true);
    expect(rows[0].querySelector('.star')).not.toBeNull();
    expect(rows[1].querySelector('.star')).toBeNull();
    expect(rows[0].textContent).toContain('Prep Loom');
    expect(rows[0].textContent).toContain('MVL');
  });

  test('today empty state renders when there are zero items', () => {
    const root = document.createElement('div');
    render(root, makePayload());
    const todaySection = root.querySelector('[data-section="today"]');
    expect(todaySection).not.toBeNull();
    expect(todaySection!.textContent).toMatch(/nothing|caught up|clear/i);
  });

  test('unread stacked bar has one segment per non-zero section', () => {
    const root = document.createElement('div');
    render(
      root,
      makePayload({
        unreadBreakdown: {
          mentions: 1,
          pings: 2,
          chats: 3,
          messages: 0, // should not produce a segment
          oldest: null,
        },
      }),
    );
    const stack = root.querySelector('[data-section="unread"] .unread-stack')!;
    const segments = stack.querySelectorAll('.seg');
    expect(segments).toHaveLength(3);
    expect(segments[0].classList.contains('mentions')).toBe(true);
    expect(segments[1].classList.contains('pings')).toBe(true);
    expect(segments[2].classList.contains('chats')).toBe(true);
  });

  test('unread oldest row renders creator + project + hoursAgo when present', () => {
    const root = document.createElement('div');
    render(
      root,
      makePayload({
        unreadBreakdown: {
          mentions: 1,
          pings: 0,
          chats: 0,
          messages: 0,
          oldest: {
            title: '@you confirm',
            hoursAgo: 8,
            creator: 'Katia',
            project: 'EHF',
            section: 'mentions',
          },
        },
      }),
    );
    const foot = root.querySelector('[data-section="unread"] .unread-foot')!;
    expect(foot.textContent).toMatch(/8h/);
    expect(foot.textContent).toContain('Katia');
    expect(foot.textContent).toContain('EHF');
  });

  test('project rows render sorted as given with urgent tag when urgentCount > 0', () => {
    const root = document.createElement('div');
    render(
      root,
      makePayload({
        projects: [
          { id: 1, name: 'EHF', openCount: 7, urgentCount: 3 },
          { id: 2, name: 'BREEAM', openCount: 4, urgentCount: 1 },
          { id: 3, name: 'Pocknells', openCount: 2, urgentCount: 0 },
        ],
      }),
    );
    const rows = root.querySelectorAll('[data-section="projects"] .proj-row');
    expect(rows).toHaveLength(3);
    expect(rows[0].querySelector('.proj-name')!.textContent).toBe('EHF');
    expect(rows[0].querySelector('.urgent-tag')).not.toBeNull();
    expect(rows[2].querySelector('.urgent-tag')).toBeNull();
  });

  test('upcoming always renders exactly 7 .day cells; today gets today label styling', () => {
    const root = document.createElement('div');
    const upcoming = emptyUpcoming();
    upcoming[0].count = 2;
    upcoming[0].priorityCount = 1;
    upcoming[2].count = 3;
    render(root, makePayload({ upcoming }));
    const days = root.querySelectorAll('[data-section="upcoming"] .day');
    expect(days).toHaveLength(7);
    expect(days[0].querySelector('.day-label')!.textContent?.toLowerCase()).toBe('today');
    expect(days[0].querySelector('.day-count')!.textContent).toContain('2');
    expect(days[2].querySelector('.day-count')!.textContent).toContain('3');
  });

  test('waiting rows render who/what/hoursAgo/severity-dot', () => {
    const root = document.createElement('div');
    render(
      root,
      makePayload({
        waitingOnYou: [
          {
            who: 'Katia',
            what: 'confirm BREEAM credit count',
            projectName: 'EHF Client Chat',
            section: 'mentions',
            hoursAgo: 8,
            severity: 'red',
            appUrl: 'https://3.basecamp.com/x/1',
            readableSgid: 'sg1',
          },
          {
            who: 'Sophie',
            what: 'onboarding flow review',
            projectName: 'EHF Client Chat',
            section: 'pings',
            hoursAgo: 3,
            severity: 'orange',
            appUrl: 'https://3.basecamp.com/x/2',
            readableSgid: 'sg2',
          },
          {
            who: 'Stephanie',
            what: 'repo merge decision',
            projectName: 'MVL Team Chat',
            section: 'pings',
            hoursAgo: 0.2,
            severity: 'amber',
            appUrl: 'https://3.basecamp.com/x/3',
            readableSgid: 'sg3',
          },
        ],
      }),
    );
    const rows = root.querySelectorAll('[data-section="waiting"] .wait-row');
    expect(rows).toHaveLength(3);
    expect(rows[0].querySelector('.wait-who')!.textContent).toBe('Katia');
    expect(rows[0].querySelector('.sev-dot')!.classList.contains('red')).toBe(true);
    expect(rows[1].querySelector('.sev-dot')!.classList.contains('orange')).toBe(true);
    expect(rows[2].querySelector('.sev-dot')!.classList.contains('amber')).toBe(true);
  });

  test('error payload renders only an error card and no widget sections', () => {
    const root = document.createElement('div');
    const err: DashboardErrorPayload = {
      error: { message: 'Basecamp rate limit hit.', retryAfterSec: 30 },
      generatedAt: '2026-04-22T09:42:00.000Z',
    };
    render(root, err);
    expect(root.querySelector('[data-section="error"]')).not.toBeNull();
    expect(root.textContent).toContain('Basecamp rate limit hit.');
    expect(root.textContent).toContain('30');
    expect(root.querySelector('[data-section="kpi"]')).toBeNull();
    expect(root.querySelector('[data-section="today"]')).toBeNull();
    expect(root.querySelector('[data-section="upcoming"]')).toBeNull();
  });

  test('escapes HTML special chars in rendered content (no live <script>)', () => {
    const root = document.createElement('div');
    render(
      root,
      makePayload({
        today: [
          {
            id: 1,
            content: '<script>alert(1)</script>',
            appUrl: 'https://3.basecamp.com/x/1',
            priority: false,
            projectName: '<img>',
            dueLabel: '2026-04-22',
          },
        ],
      }),
    );
    expect(root.querySelector('script')).toBeNull();
    expect(root.textContent).toContain('<script>alert(1)</script>');
  });

  test('neuters non-http(s) hrefs in today item links', () => {
    const root = document.createElement('div');
    render(
      root,
      makePayload({
        today: [
          {
            id: 1,
            content: 'x',
            appUrl: 'javascript:alert(1)',
            priority: false,
            projectName: 'A',
            dueLabel: '2026-04-22',
          },
        ],
      }),
    );
    const link = root.querySelector<HTMLAnchorElement>('[data-section="today"] a');
    expect(link?.getAttribute('href')).toBe('#');
  });

  test('re-rendering replaces prior content (no accumulation)', () => {
    const root = document.createElement('div');
    render(
      root,
      makePayload({
        today: [
          {
            id: 1,
            content: 'first',
            appUrl: 'https://3.basecamp.com/x/1',
            priority: false,
            projectName: 'A',
            dueLabel: '2026-04-22',
          },
        ],
      }),
    );
    render(
      root,
      makePayload({
        today: [
          {
            id: 2,
            content: 'second',
            appUrl: 'https://3.basecamp.com/x/2',
            priority: false,
            projectName: 'B',
            dueLabel: '2026-04-22',
          },
        ],
      }),
    );
    const rows = root.querySelectorAll('[data-section="today"] .t-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('second');
    expect(rows[0].textContent).not.toContain('first');
  });
});
